/**
 * Heuristic auth-wall detector.
 *
 * Returns true when a URL strongly looks like a login / SSO surface that's
 * useless to iframe or screenshot — the capture is just a blank page or a
 * login form. Callers ship those as `link` tiles (open-in-tab) instead.
 *
 * Deliberately HIGH-PRECISION: we only flag unambiguous sign-in surfaces
 * (known IdP hosts, `login.`/`signin.`/`accounts.` subdomains, and explicit
 * `/login`-style path segments). We do NOT flag generic `/account` pages,
 * `app.` / `my.` subdomains, or content *about* login (e.g. a `/wiki/Login`
 * article) — those preview fine, and a false positive would needlessly
 * downgrade a good tile to a bare link.
 */

// Identity-provider hosts whose pages are sign-in by nature.
const AUTH_HOST_SUFFIXES = [
  "okta.com",
  "auth0.com",
  "onelogin.com",
  "pingidentity.com",
  "microsoftonline.com",
  "appleid.apple.com",
];

// First DNS label that signals a dedicated sign-in host (login.example.com).
const AUTH_FIRST_LABELS = new Set([
  "login",
  "signin",
  "sign-in",
  "accounts",
  "auth",
  "sso",
  "idp",
  "oauth",
]);

// A path segment that names a sign-in route.
const LOGIN_SEGMENTS = new Set([
  "login",
  "signin",
  "sign-in",
  "sign_in",
  "log-in",
  "log_in",
  "auth",
  "oauth",
  "oauth2",
  "sso",
  "saml",
  "wp-login.php",
]);

// If the path starts with one of these, it's content (an article/doc), so we
// don't treat a nested "login" segment as a real sign-in route.
const CONTENT_PREFIXES = new Set([
  "wiki",
  "blog",
  "news",
  "article",
  "articles",
  "docs",
  "doc",
  "help",
  "support",
  "kb",
]);

export function looksAuthWalled(rawUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }

  const host = u.hostname.toLowerCase();
  if (AUTH_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))) {
    return true;
  }
  if (AUTH_FIRST_LABELS.has(host.split(".")[0])) {
    return true;
  }

  const segments = u.pathname.toLowerCase().split("/").filter(Boolean);
  if (segments.length === 0) return false;
  if (CONTENT_PREFIXES.has(segments[0])) return false;
  return segments.some((s) => LOGIN_SEGMENTS.has(s));
}
