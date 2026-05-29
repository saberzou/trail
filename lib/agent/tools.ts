import { promises as dns } from "node:dns";
import net from "node:net";
import { Readability } from "@mozilla/readability";
import { tool } from "ai";
import * as cheerio from "cheerio";
import { JSDOM } from "jsdom";
import { Agent } from "undici";
import { z } from "zod";

type Fetch = typeof fetch;

export function makeWebSearchTool(opts: {
  provider: "brave" | "tavily";
  apiKey: string;
  fetch?: Fetch;
}) {
  const f = opts.fetch ?? fetch;
  return tool({
    description:
      "Search the web. Returns top results with title, url, description.",
    inputSchema: z.object({ query: z.string().min(1) }),
    execute: async ({ query }) => {
      if (opts.provider === "brave") {
        const r = await f(
          `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8`,
          {
            headers: {
              "X-Subscription-Token": opts.apiKey,
              Accept: "application/json",
            },
          },
        );
        if (!r.ok) throw new Error(`brave ${r.status}`);
        const j = (await r.json()) as {
          web?: {
            results?: Array<{
              title: string;
              url: string;
              description: string;
            }>;
          };
        };
        return {
          results: (j.web?.results ?? [])
            .slice(0, 8)
            .map(({ title, url, description }) => ({
              title,
              url,
              description,
            })),
        };
      }
      const r = await f("https://api.tavily.com/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ api_key: opts.apiKey, query, max_results: 8 }),
      });
      if (!r.ok) throw new Error(`tavily ${r.status}`);
      const j = (await r.json()) as {
        results?: Array<{ title: string; url: string; content: string }>;
      };
      return {
        results: (j.results ?? []).map(({ title, url, content }) => ({
          title,
          url,
          description: content,
        })),
      };
    },
  });
}

// ---------------------------------------------------------------------------
// fetch_url — SSRF-hardened
// ---------------------------------------------------------------------------

export type LookupAddress = { address: string; family: number };
export type LookupAllFn = (host: string) => Promise<LookupAddress[]>;

const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 10_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024;

const defaultLookupAll: LookupAllFn = async (host) => {
  // The `all: true` form returns every resolved record so we can reject if any
  // of them point at a blocked range. `dns.lookup` already returns
  // `{ address, family }` records — no transform needed.
  return dns.lookup(host, { all: true });
};

/**
 * Return true when an IPv4 literal falls inside a CIDR range we refuse to
 * connect to from the agent (loopback, link-local, RFC1918, CGNAT, broadcast).
 */
export function isBlockedIPv4(address: string): boolean {
  if (!net.isIPv4(address)) return false;
  const [a, b] = address.split(".").map((n) => Number.parseInt(n, 10));
  if (a === 10) return true; //          10.0.0.0/8
  if (a === 127) return true; //         127.0.0.0/8 loopback
  if (a === 0) return true; //           0.0.0.0/8
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; //   192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  return false;
}

/**
 * Expand a normalized lowercase IPv6 literal into its eight 16-bit groups,
 * returning numbers. Handles `::` zero-compression. Returns null if the input
 * doesn't parse as 8 groups. Embedded IPv4 (e.g. `::ffff:a.b.c.d`) is *not*
 * decoded here — call sites handle that form separately.
 */
function expandIPv6Groups(lower: string): number[] | null {
  // Reject embedded-v4 form; callers handle it.
  if (/\d+\.\d+\.\d+\.\d+/.test(lower)) return null;
  const dc = lower.indexOf("::");
  let left: string[];
  let right: string[];
  if (dc === -1) {
    left = lower.split(":");
    right = [];
  } else {
    left = lower.slice(0, dc) === "" ? [] : lower.slice(0, dc).split(":");
    right = lower.slice(dc + 2) === "" ? [] : lower.slice(dc + 2).split(":");
  }
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  const zeros: string[] = Array.from({ length: missing }, () => "0");
  const groups = [...left, ...zeros, ...right];
  if (groups.length !== 8) return null;
  const parsed: number[] = [];
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    parsed.push(Number.parseInt(g, 16));
  }
  return parsed;
}

/**
 * Return true when an IPv6 literal is loopback, link-local, ULA, multicast,
 * 6to4-tunneled toward a blocked v4 range, NAT64, an IPv4-mapped form of a
 * blocked v4 range, or the documentation prefix.
 */
export function isBlockedIPv6(address: string): boolean {
  if (!net.isIPv6(address)) return false;
  const lower = address.toLowerCase();
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  // fc00::/7 unique-local
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
  // fe80::/10 link-local
  if (lower.startsWith("fe8") || lower.startsWith("fe9")) return true;
  if (lower.startsWith("fea") || lower.startsWith("feb")) return true;
  // ff00::/8 multicast
  if (lower.startsWith("ff")) return true;
  // 2001:db8::/32 documentation prefix (defensive)
  if (lower.startsWith("2001:db8:") || lower.startsWith("2001:db8::")) {
    return true;
  }
  // ::ffff:a.b.c.d  →  delegate to v4 check
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped && isBlockedIPv4(mapped[1])) return true;
  // ::ffff:HHHH:HHHH form (hex-encoded mapped v4)
  const mappedHex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const hi = Number.parseInt(mappedHex[1], 16);
    const lo = Number.parseInt(mappedHex[2], 16);
    const a = (hi >> 8) & 0xff;
    const b = hi & 0xff;
    const c = (lo >> 8) & 0xff;
    const d = lo & 0xff;
    if (isBlockedIPv4(`${a}.${b}.${c}.${d}`)) return true;
  }
  // 2002::/16 6to4 — the next 32 bits encode the v4 address that the tunnel
  // exits to. If that v4 is blocked, refuse the 6to4 literal. We expand `::`
  // ourselves so forms like "2002:0a00::" (6to4 of 10.0.0.0) match.
  if (lower.startsWith("2002:")) {
    const groups = expandIPv6Groups(lower);
    if (groups && groups.length >= 3) {
      const hi = groups[1];
      const lo = groups[2];
      const a = (hi >> 8) & 0xff;
      const b = hi & 0xff;
      const c = (lo >> 8) & 0xff;
      const d = lo & 0xff;
      if (isBlockedIPv4(`${a}.${b}.${c}.${d}`)) return true;
    }
  }
  // 64:ff9b::/96 NAT64 — the well-known translation prefix. We block the
  // whole /96 (and the synonym `64:ff9b::w.x.y.z` form) defensively: making
  // the agent reach into a NAT64 gateway is almost never legitimate for
  // user-supplied URLs, and decoding the embedded v4 is brittle.
  if (lower.startsWith("64:ff9b:") || lower.startsWith("64:ff9b::")) {
    return true;
  }
  return false;
}

export function isBlockedAddress(address: string): boolean {
  return isBlockedIPv4(address) || isBlockedIPv6(address);
}

async function assertSafeUrl(
  url: URL,
  lookup: LookupAllFn,
): Promise<LookupAddress> {
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("blocked: non-http(s) protocol");
  }
  // Strip brackets from IPv6 literal hosts.
  const host = url.hostname.replace(/^\[(.*)\]$/, "$1");
  // Reject hostnames that already are literal blocked IPs (skip DNS).
  if (net.isIP(host) && isBlockedAddress(host)) {
    throw new Error("blocked: private address");
  }
  const addrs = net.isIP(host)
    ? [{ address: host, family: net.isIPv6(host) ? 6 : 4 }]
    : await lookup(host);
  if (addrs.length === 0) {
    throw new Error("blocked: no DNS records");
  }
  for (const a of addrs) {
    if (isBlockedAddress(a.address)) {
      throw new Error("blocked: private address");
    }
  }
  // Pin the first resolved address (the dispatcher will use this on connect).
  return addrs[0];
}

// Headers that carry credentials and MUST be dropped across cross-origin
// redirects. Lowercased; we'll compare case-insensitively. `www-authenticate`
// is a response header, so it never appears on the outbound request and is
// intentionally omitted.
const CREDENTIAL_HEADERS = new Set([
  "authorization",
  "cookie",
  "proxy-authorization",
]);

function stripCredentialHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (!CREDENTIAL_HEADERS.has(k.toLowerCase())) out[k] = v;
  }
  return out;
}

async function readCappedBody(
  res: Response,
  cap: number,
  signal?: AbortSignal,
): Promise<string> {
  // Fast path: if the server told us the length and it's too big, bail before
  // pulling any bytes.
  const declared = res.headers.get("content-length");
  if (declared && Number.parseInt(declared, 10) > cap) {
    throw new Error("blocked: response body exceeds 2MB cap");
  }
  if (!res.body) {
    return await res.text();
  }
  const reader = res.body.getReader();

  // Race each read against the abort signal so a slow streaming server
  // within the cap can't hold past the timeout. When the signal fires we
  // cancel the reader with the signal's reason and throw it.
  const abortError = (): Error => {
    const reason = signal?.reason;
    return reason instanceof Error
      ? reason
      : new Error(typeof reason === "string" ? reason : "aborted");
  };
  const racingRead = (): Promise<ReadableStreamReadResult<Uint8Array>> => {
    if (!signal) return reader.read();
    if (signal.aborted) {
      return Promise.reject(abortError());
    }
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        signal.removeEventListener("abort", onAbort);
        reader.cancel(abortError()).catch(() => {});
        reject(abortError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
      reader.read().then(
        (r) => {
          signal.removeEventListener("abort", onAbort);
          resolve(r);
        },
        (e) => {
          signal.removeEventListener("abort", onAbort);
          reject(e);
        },
      );
    });
  };

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await racingRead();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > cap) {
        try {
          await reader.cancel();
        } catch {
          // ignore cancellation errors
        }
        throw new Error("blocked: response body exceeds 2MB cap");
      }
      chunks.push(value);
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder("utf-8").decode(merged);
}

type MakeFetchUrlToolOpts = {
  fetch?: Fetch;
  lookup?: LookupAllFn;
  timeoutMs?: number;
  maxBodyBytes?: number;
  maxRedirects?: number;
  /**
   * Initial request headers to send on the first hop. Lets callers/tests
   * inject credentials so we can verify they're stripped on cross-origin
   * redirects. Defaults are merged on top so the test can override `accept`
   * etc. if needed.
   */
  initialHeaders?: Record<string, string>;
};

export function makeFetchUrlTool(opts: MakeFetchUrlToolOpts = {}) {
  const f = opts.fetch ?? fetch;
  const lookup = opts.lookup ?? defaultLookupAll;
  const timeoutMs = opts.timeoutMs ?? FETCH_TIMEOUT_MS;
  const cap = opts.maxBodyBytes ?? MAX_BODY_BYTES;
  const maxRedirects = opts.maxRedirects ?? MAX_REDIRECTS;
  const initialHeaders = opts.initialHeaders;

  return tool({
    description: "Fetch a URL and extract its main readable content.",
    inputSchema: z.object({ url: z.string().url() }),
    execute: async ({ url }) => {
      let currentUrl: URL;
      try {
        currentUrl = new URL(url);
      } catch {
        throw new Error("blocked: invalid URL");
      }

      let headers: Record<string, string> = {
        "user-agent": "Mozilla/5.0 TrailBot/1.0",
        accept: "text/html,application/xhtml+xml",
        ...(initialHeaders ?? {}),
      };
      const signal = AbortSignal.timeout(timeoutMs);

      let finalResponse: Response | null = null;
      let finalUrl = currentUrl;
      // The dispatcher used for the most recent hop. We keep it alive past
      // the loop so `readCappedBody` can drain the final body stream — undici
      // `Agent.close()` aborts in-flight requests, so closing mid-stream
      // truncates the body. Prior hops' dispatchers are closed inside the
      // loop as soon as the next hop's URL is validated.
      let dispatcher: Agent | undefined;

      try {
        for (let hop = 0; hop <= maxRedirects; hop++) {
          const pinned = await assertSafeUrl(currentUrl, lookup);

          // Close the dispatcher from the previous hop now that we've
          // validated the next URL — its body (a 3xx response) has already
          // been read by the time we got here.
          if (dispatcher) {
            await dispatcher.close().catch(() => {});
            dispatcher = undefined;
          }

          // Build an IP-pinned dispatcher so DNS rebinding can't swap the
          // hostname to a private address between our resolve and connect.
          dispatcher = new Agent({
            connect: {
              lookup: (
                _host: string,
                _options: unknown,
                cb: (
                  err: NodeJS.ErrnoException | null,
                  address: string,
                  family: number,
                ) => void,
              ) => {
                cb(null, pinned.address, pinned.family);
              },
            },
          });

          const res = await f(currentUrl.toString(), {
            method: "GET",
            headers,
            redirect: "manual",
            signal,
            // Node's fetch (undici-backed) accepts a `dispatcher` on init.
            // The browser `fetch` type doesn't include it, but we're a server
            // tool — cast through.
            ...({ dispatcher } as { dispatcher: unknown }),
          });

          if (res.status >= 300 && res.status < 400) {
            const loc = res.headers.get("location");
            if (!loc) {
              throw new Error(`fetch ${res.status} without location`);
            }
            if (hop >= maxRedirects) {
              throw new Error("blocked: too many redirects");
            }
            const next = new URL(loc, currentUrl);
            const sameOrigin = next.origin === currentUrl.origin;
            if (!sameOrigin) {
              headers = stripCredentialHeaders(headers);
            }
            currentUrl = next;
            continue;
          }

          if (!res.ok) {
            throw new Error(`fetch ${res.status}`);
          }
          finalResponse = res;
          finalUrl = currentUrl;
          break;
        }

        if (!finalResponse) {
          // Loop ended without a non-redirect response — treat as redirect cap.
          throw new Error("blocked: too many redirects");
        }

        const html = await readCappedBody(finalResponse, cap, signal);
        const dom = new JSDOM(html, { url: finalUrl.toString() });
        const article = new Readability(dom.window.document).parse();
        if (article?.textContent) {
          return {
            title: article.title || finalUrl.toString(),
            text: article.textContent.slice(0, 4000),
          };
        }
        const $ = cheerio.load(html);
        $("script, style, noscript").remove();
        return {
          title: $("title").text() || finalUrl.toString(),
          text: $("body").text().replace(/\s+/g, " ").slice(0, 4000),
        };
      } finally {
        // Body has been fully drained (or we're erroring out); safe to close.
        await dispatcher?.close().catch(() => {});
      }
    },
  });
}
