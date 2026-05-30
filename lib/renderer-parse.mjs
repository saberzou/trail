// trail-renderer pure helpers — extracted so they are unit-testable
// without booting Playwright. Plain JS so vitest can import them
// directly (no .ts loader needed for the sidecar runtime).

import { createHash } from "node:crypto";

/**
 * Validate and normalize a URL string. Returns the normalized URL on
 * success, or null if the input is missing, malformed, or uses a
 * non-http(s) scheme (javascript:, file://, ftp://, ...).
 */
export function validateUrl(input) {
  if (typeof input !== "string") return null;
  try {
    const u = new URL(input);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Stable sha256 cache key for (url, viewport). Same input → same key;
 * any change to URL or viewport size produces a different key.
 */
export function cacheKey(url, viewport) {
  const hash = createHash("sha256");
  hash.update(`${url}:${viewport.width}x${viewport.height}`);
  return hash.digest("hex");
}

/**
 * Split a raw CSP header value into individual policies. Node's fetch
 * merges multiple `Content-Security-Policy` headers into one
 * comma-joined string; commas WITHIN a single policy don't occur in
 * any standard directive (frame-ancestors, default-src etc. all use
 * whitespace-separated source lists), so splitting on `,` is safe.
 */
export function splitCspPolicies(cspHeader) {
  if (typeof cspHeader !== "string" || cspHeader.length === 0) return [];
  return cspHeader
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

/**
 * Parse a single CSP policy string into an array of sources for the
 * `frame-ancestors` directive. Returns null when the directive is
 * absent (CSP silent on framing) or an array (possibly empty) of
 * lowercase source tokens when present.
 */
export function parseFrameAncestors(policy) {
  if (typeof policy !== "string") return null;
  const directives = policy.split(";").map((d) => d.trim());
  for (const d of directives) {
    if (!/^frame-ancestors\b/i.test(d)) continue;
    const parts = d.split(/\s+/).slice(1);
    return parts.map((p) => p.toLowerCase());
  }
  return null;
}

/**
 * Decide whether a single CSP policy permits framing by any of
 * `appOrigins`. Returns:
 *   - null when the policy has no frame-ancestors directive
 *   - true when frame-ancestors lists `*`, `'self'`, or a matching origin
 *   - false otherwise (including `'none'`, empty list)
 *
 * `'self'` is treated as a match because the sidecar always runs on
 * the same host as the app (loopback) — if the upstream considers
 * itself "self", our app is its same-origin embedder when proxied.
 * For first-party tiles this is consistent with browser behavior.
 */
export function frameAncestorsAllows(policy, appOrigins) {
  const sources = parseFrameAncestors(policy);
  if (sources === null) return null;
  if (sources.length === 0) return false; // empty list blocks everyone
  for (const src of sources) {
    if (src === "*" || src === "'self'") return true;
    if (src === "'none'") return false;
    for (const origin of appOrigins) {
      if (src === origin.toLowerCase()) return true;
    }
  }
  return false;
}

/**
 * Apply most-restrictive semantics across a merged multi-header CSP.
 * Returns:
 *   - true when EVERY policy that mentions frame-ancestors allows it,
 *     OR when no policy mentions frame-ancestors at all
 *   - false when ANY policy that mentions frame-ancestors denies it
 */
export function cspAllowsFraming(cspHeader, appOrigins) {
  const policies = splitCspPolicies(cspHeader);
  if (policies.length === 0) return true;
  for (const p of policies) {
    const allowed = frameAncestorsAllows(p, appOrigins);
    if (allowed === false) return false;
  }
  // No policy explicitly denied → allowed (either none mentioned
  // frame-ancestors, or every mention permitted us).
  return true;
}

/**
 * Decide whether an X-Frame-Options header blocks framing for our
 * (cross-origin) app. `DENY` and `SAMEORIGIN` both block, since the
 * sidecar fetches upstream pages — those are never same-origin to
 * our loopback app. `ALLOWALL` (non-standard) and `ALLOW-FROM`
 * (deprecated) are treated as allow for simplicity.
 */
export function xfoBlocks(xfoHeader) {
  if (typeof xfoHeader !== "string" || xfoHeader.length === 0) return false;
  const v = xfoHeader.toUpperCase().trim();
  if (v.includes("DENY")) return true;
  if (v.includes("SAMEORIGIN")) return true;
  return false;
}

/**
 * Top-level "is this URL iframeable in our app?" — combines XFO and
 * CSP frame-ancestors. `headers` should be a Headers-like object
 * with a `.get(name)` method.
 */
export function framingAllowed(headers, appOrigins) {
  const xfo = headers.get("x-frame-options");
  if (xfoBlocks(xfo)) return false;
  const csp = headers.get("content-security-policy");
  if (csp && !cspAllowsFraming(csp, appOrigins)) return false;
  return true;
}
