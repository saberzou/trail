// trail-renderer — local Playwright sidecar.
//
// Trust model: binds 127.0.0.1 only. Any process on the local machine
// can reach this; there is no auth header beyond that. For single-user,
// Mac, local-first this is the same boundary as $HOME access. CORS is
// restricted to the trail app's loopback origin.

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";

const PORT = Number(process.env.TRAIL_RENDERER_PORT ?? 3001);
const HOST = "127.0.0.1";
const APP_PORT = Number(process.env.TRAIL_APP_PORT ?? 3000);
const CACHE_DIR = path.join(os.homedir(), ".trail", "cache", "screenshots");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SHOT_TIMEOUT_MS = 15_000;
const PROBE_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 16 * 1024;
const ALLOWED_ORIGINS = new Set([
  `http://localhost:${APP_PORT}`,
  `http://127.0.0.1:${APP_PORT}`,
]);

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
  }
}

function isAllowedOrigin(req) {
  const origin = req.headers.origin;
  // Browser-less callers (curl from the same box) won't send Origin — accept
  // those too, since loopback is the trust boundary.
  if (!origin) return true;
  return ALLOWED_ORIGINS.has(origin);
}

function sendJson(res, status, body) {
  const buf = Buffer.from(JSON.stringify(body));
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Length", String(buf.length));
  res.end(buf);
}

async function readJsonBody(req) {
  let received = 0;
  const chunks = [];
  for await (const chunk of req) {
    received += chunk.length;
    if (received > MAX_BODY_BYTES) {
      throw new Error("body-too-large");
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("invalid-json");
  }
}

function validateUrl(input) {
  if (typeof input !== "string") return null;
  try {
    const u = new URL(input);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

function cacheKey(url, viewport) {
  const hash = createHash("sha256");
  hash.update(`${url}:${viewport.width}x${viewport.height}`);
  return hash.digest("hex");
}

function streamFile(res, filePath, size) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Length", String(size));
  res.setHeader("Cache-Control", "private, max-age=86400");
  createReadStream(filePath).pipe(res);
}

/**
 * Parse a CSP header value and decide whether the response can be framed by
 * our app origin. Returns null when no frame-ancestors directive is present
 * (i.e. CSP is silent on framing, defer to other signals).
 */
function frameAncestorsAllows(cspValue, appOrigins) {
  const directives = cspValue.split(";").map((d) => d.trim());
  for (const d of directives) {
    if (!/^frame-ancestors\b/i.test(d)) continue;
    const sources = d.split(/\s+/).slice(1);
    if (sources.length === 0) return false; // empty → blocks everyone
    for (const src of sources) {
      const s = src.toLowerCase();
      if (s === "*" || s === "'self'") return true;
      for (const origin of appOrigins) {
        if (s === origin) return true;
      }
    }
    return false;
  }
  return null;
}

async function handleScreenshot(req, res, browser) {
  if (!isAllowedOrigin(req)) {
    sendJson(res, 403, { error: "forbidden-origin" });
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, 400, { error: "invalid-body", message: String(err.message) });
    return;
  }
  const url = validateUrl(body.url);
  if (!url) {
    sendJson(res, 400, { error: "invalid-url" });
    return;
  }
  const viewport = {
    width: Math.max(320, Math.min(3840, Number(body.viewport?.width) || 1280)),
    height: Math.max(240, Math.min(2160, Number(body.viewport?.height) || 720)),
  };
  const key = cacheKey(url, viewport);
  const file = path.join(CACHE_DIR, `${key}.png`);

  applyCors(req, res);

  try {
    const st = await stat(file);
    if (Date.now() - st.mtimeMs < CACHE_TTL_MS) {
      streamFile(res, file, st.size);
      return;
    }
  } catch {
    // cache miss — fall through
  }

  const context = await browser.newContext({ viewport });
  try {
    const page = await context.newPage();
    await page.goto(url, { timeout: SHOT_TIMEOUT_MS, waitUntil: "load" });
    const png = await page.screenshot({ fullPage: false, type: "png" });
    await writeFile(file, png);
    res.statusCode = 200;
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Length", String(png.length));
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.end(png);
  } catch (err) {
    sendJson(res, 500, {
      error: "screenshot-failed",
      message: String(err?.message ?? err),
    });
  } finally {
    await context.close().catch(() => {});
  }
}

async function handleProbe(req, res) {
  if (!isAllowedOrigin(req)) {
    sendJson(res, 403, { error: "forbidden-origin" });
    return;
  }
  let body;
  try {
    body = await readJsonBody(req);
  } catch (err) {
    sendJson(res, 400, { error: "invalid-body", message: String(err.message) });
    return;
  }
  const url = validateUrl(body.url);
  if (!url) {
    sendJson(res, 400, { error: "invalid-url" });
    return;
  }

  applyCors(req, res);

  const appOrigins = [...ALLOWED_ORIGINS].map((o) => o.toLowerCase());
  try {
    const r = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    let iframeable = true;
    const xfo = r.headers.get("x-frame-options");
    if (xfo) {
      const v = xfo.toUpperCase();
      if (v.includes("DENY") || v.includes("SAMEORIGIN")) iframeable = false;
    }
    const csp = r.headers.get("content-security-policy");
    if (csp) {
      const allowed = frameAncestorsAllows(csp, appOrigins);
      if (allowed === false) iframeable = false;
    }
    sendJson(res, 200, { iframeable });
  } catch (err) {
    sendJson(res, 200, {
      iframeable: false,
      error: String(err?.message ?? err),
    });
  }
}

function handleHealth(req, res) {
  applyCors(req, res);
  sendJson(res, 200, { ok: true, browser: "chromium" });
}

function handleOptions(req, res) {
  applyCors(req, res);
  res.statusCode = 204;
  res.end();
}

async function makeHandler(browser) {
  return async (req, res) => {
    try {
      const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
      const method = req.method || "GET";

      if (method === "OPTIONS") {
        handleOptions(req, res);
        return;
      }
      if (method === "GET" && url.pathname === "/health") {
        handleHealth(req, res);
        return;
      }
      if (method === "POST" && url.pathname === "/screenshot") {
        await handleScreenshot(req, res, browser);
        return;
      }
      if (method === "POST" && url.pathname === "/probe") {
        await handleProbe(req, res);
        return;
      }
      sendJson(res, 404, { error: "not-found" });
    } catch (err) {
      console.error("[trail-renderer] unhandled", err);
      try {
        sendJson(res, 500, {
          error: "internal",
          message: String(err?.message ?? err),
        });
      } catch {
        // already responded
      }
    }
  };
}

async function main() {
  await mkdir(CACHE_DIR, { recursive: true });
  // Launch chromium BEFORE listen() so the first /screenshot call doesn't pay
  // for cold-start (~1-2s) and time out the caller's probe.
  const browser = await chromium.launch({ headless: true });
  const handler = await makeHandler(browser);
  const server = http.createServer(handler);

  server.listen(PORT, HOST, () => {
    console.log(`[trail-renderer] listening on http://${HOST}:${PORT}`);
  });

  const shutdown = async (sig) => {
    console.log(`[trail-renderer] ${sig} — shutting down`);
    await new Promise((resolve) => server.close(() => resolve()));
    await browser.close().catch(() => {});
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[trail-renderer] fatal", err);
  process.exit(1);
});
