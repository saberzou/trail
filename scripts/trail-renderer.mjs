// trail-renderer — local Playwright sidecar.
//
// Trust model: binds 127.0.0.1 only. Any process on the local machine
// can reach this; there is no auth header beyond that. For single-user,
// Mac, local-first this is the same boundary as $HOME access. CORS is
// restricted to the trail app's loopback origin.

import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { chromium } from "playwright";
import {
  cacheKey,
  framingAllowed,
  validateUrl,
} from "../lib/renderer-parse.mjs";

const PORT = Number(process.env.TRAIL_RENDERER_PORT ?? 3001);
const HOST = "127.0.0.1";
const APP_PORT = Number(process.env.TRAIL_APP_PORT ?? 3000);
const CACHE_DIR = path.join(os.homedir(), ".trail", "cache", "screenshots");
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SHOT_TIMEOUT_MS = 15_000;
const SCREENSHOT_TIMEOUT_MS = 5_000;
const PROBE_TIMEOUT_MS = 10_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;
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

function streamFile(res, filePath, size) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Content-Length", String(size));
  res.setHeader("Cache-Control", "private, max-age=86400");
  createReadStream(filePath).pipe(res);
}

async function handleScreenshot(req, res, browser) {
  // CORS goes first — even on early-exit error paths the browser needs
  // these headers, otherwise it surfaces "CORS error" instead of the
  // real status code.
  applyCors(req, res);
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

  try {
    const st = await stat(file);
    const delta = Date.now() - st.mtimeMs;
    // Require a non-negative delta too — a future-dated mtime (clock
    // skew, restored backup) would otherwise look fresh forever.
    if (delta >= 0 && delta < CACHE_TTL_MS) {
      streamFile(res, file, st.size);
      return;
    }
  } catch {
    // cache miss — fall through
  }

  // Declared outside the try so the `finally` block can guard against
  // `newContext` itself throwing (browser closed mid-request).
  let context;
  try {
    context = await browser.newContext({ viewport });
    const page = await context.newPage();
    await page.goto(url, { timeout: SHOT_TIMEOUT_MS, waitUntil: "load" });
    const png = await page.screenshot({
      fullPage: false,
      type: "png",
      timeout: SCREENSHOT_TIMEOUT_MS,
    });
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
    if (context) await context.close().catch(() => {});
  }
}

async function handleProbe(req, res) {
  applyCors(req, res);
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

  const appOrigins = [...ALLOWED_ORIGINS].map((o) => o.toLowerCase());
  try {
    const r = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    const iframeable = framingAllowed(r.headers, appOrigins);
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
      // Dispatcher-level CORS so every response (including 404 and
      // unhandled errors) carries the right headers.
      applyCors(req, res);
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
    // Force-exit safety net: if server.close or browser.close hang
    // (e.g. SIGTERM landed during a 15s page.goto) we bail rather
    // than ignore the signal forever.
    const timer = setTimeout(() => {
      console.error("[trail-renderer] shutdown timeout — force-exiting");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    timer.unref();
    try {
      await new Promise((resolve) => server.close(() => resolve()));
      await browser.close().catch(() => {});
    } finally {
      clearTimeout(timer);
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("[trail-renderer] fatal", err);
  process.exit(1);
});
