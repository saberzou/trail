import { describe, expect, it } from "vitest";
import {
  cacheKey,
  cspAllowsFraming,
  frameAncestorsAllows,
  framingAllowed,
  parseFrameAncestors,
  splitCspPolicies,
  validateUrl,
  xfoBlocks,
} from "./renderer-parse.mjs";

const APP_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];

describe("validateUrl", () => {
  it("accepts http and https URLs", () => {
    expect(validateUrl("http://example.com")).toBe("http://example.com/");
    expect(validateUrl("https://example.com/path?q=1#frag")).toBe(
      "https://example.com/path?q=1#frag",
    );
  });

  it("rejects non-http(s) schemes", () => {
    expect(validateUrl("javascript:alert(1)")).toBeNull();
    expect(validateUrl("file:///etc/passwd")).toBeNull();
    expect(validateUrl("ftp://ftp.example.com")).toBeNull();
    expect(validateUrl("data:text/html,<x>")).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(validateUrl("")).toBeNull();
    expect(validateUrl("not a url")).toBeNull();
    expect(validateUrl(undefined)).toBeNull();
    expect(validateUrl(null)).toBeNull();
    expect(validateUrl(42)).toBeNull();
  });
});

describe("cacheKey", () => {
  it("is stable for the same input", () => {
    const k1 = cacheKey("https://example.com", { width: 1280, height: 720 });
    const k2 = cacheKey("https://example.com", { width: 1280, height: 720 });
    expect(k1).toBe(k2);
    expect(k1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when URL changes", () => {
    const k1 = cacheKey("https://example.com", { width: 1280, height: 720 });
    const k2 = cacheKey("https://example.org", { width: 1280, height: 720 });
    expect(k1).not.toBe(k2);
  });

  it("changes when viewport changes", () => {
    const k1 = cacheKey("https://example.com", { width: 1280, height: 720 });
    const k2 = cacheKey("https://example.com", { width: 1920, height: 1080 });
    expect(k1).not.toBe(k2);
  });
});

describe("splitCspPolicies", () => {
  it("returns empty for empty or non-string input", () => {
    expect(splitCspPolicies("")).toEqual([]);
    expect(splitCspPolicies(undefined)).toEqual([]);
    expect(splitCspPolicies(null)).toEqual([]);
  });

  it("splits comma-joined multi-header CSP into individual policies", () => {
    const merged =
      "default-src 'self'; frame-ancestors 'none', script-src 'self'";
    const policies = splitCspPolicies(merged);
    expect(policies).toHaveLength(2);
    expect(policies[0]).toContain("frame-ancestors 'none'");
    expect(policies[1]).toContain("script-src 'self'");
  });
});

describe("parseFrameAncestors", () => {
  it("returns null when the directive is absent", () => {
    expect(parseFrameAncestors("default-src 'self'")).toBeNull();
  });

  it("returns sources when present", () => {
    expect(
      parseFrameAncestors("frame-ancestors 'self' https://example.com"),
    ).toEqual(["'self'", "https://example.com"]);
  });

  it("returns empty array for 'frame-ancestors' with no sources (CSP blocks all)", () => {
    expect(parseFrameAncestors("frame-ancestors")).toEqual([]);
  });

  it("is case-insensitive on directive name", () => {
    expect(parseFrameAncestors("FRAME-ANCESTORS 'self'")).toEqual(["'self'"]);
  });
});

describe("frameAncestorsAllows", () => {
  it("returns null when directive is absent", () => {
    expect(frameAncestorsAllows("default-src 'self'", APP_ORIGINS)).toBeNull();
  });

  it("returns true for '*'", () => {
    expect(frameAncestorsAllows("frame-ancestors *", APP_ORIGINS)).toBe(true);
  });

  it("returns true for 'self'", () => {
    expect(frameAncestorsAllows("frame-ancestors 'self'", APP_ORIGINS)).toBe(
      true,
    );
  });

  it("returns false for 'none'", () => {
    expect(frameAncestorsAllows("frame-ancestors 'none'", APP_ORIGINS)).toBe(
      false,
    );
  });

  it("returns false when sources list is empty (e.g. 'frame-ancestors;')", () => {
    expect(frameAncestorsAllows("frame-ancestors ", APP_ORIGINS)).toBe(false);
  });

  it("returns true when an explicit origin matches one of appOrigins", () => {
    expect(
      frameAncestorsAllows(
        "frame-ancestors http://localhost:3000",
        APP_ORIGINS,
      ),
    ).toBe(true);
  });

  it("returns false when origins are listed but none match", () => {
    expect(
      frameAncestorsAllows(
        "frame-ancestors https://other.example",
        APP_ORIGINS,
      ),
    ).toBe(false);
  });
});

describe("cspAllowsFraming — most-restrictive across multiple policies", () => {
  it("returns true when no policies are present", () => {
    expect(cspAllowsFraming("", APP_ORIGINS)).toBe(true);
  });

  it("returns true when no policy mentions frame-ancestors", () => {
    expect(cspAllowsFraming("default-src 'self'", APP_ORIGINS)).toBe(true);
  });

  it("blocks when any single policy denies framing", () => {
    const merged =
      "default-src 'self'; frame-ancestors 'self', frame-ancestors 'none'";
    expect(cspAllowsFraming(merged, APP_ORIGINS)).toBe(false);
  });

  it("allows when all framing policies allow", () => {
    const merged = "frame-ancestors *, frame-ancestors 'self'";
    expect(cspAllowsFraming(merged, APP_ORIGINS)).toBe(true);
  });
});

describe("xfoBlocks", () => {
  it("returns false for missing or empty header", () => {
    expect(xfoBlocks(undefined)).toBe(false);
    expect(xfoBlocks(null)).toBe(false);
    expect(xfoBlocks("")).toBe(false);
  });

  it("blocks on DENY", () => {
    expect(xfoBlocks("DENY")).toBe(true);
    expect(xfoBlocks("deny")).toBe(true);
  });

  it("blocks on SAMEORIGIN (cross-origin embedding never matches)", () => {
    expect(xfoBlocks("SAMEORIGIN")).toBe(true);
  });

  it("allows non-standard values (ALLOW-FROM, ALLOWALL)", () => {
    expect(xfoBlocks("ALLOW-FROM https://example.com")).toBe(false);
    expect(xfoBlocks("ALLOWALL")).toBe(false);
  });
});

describe("framingAllowed (XFO + CSP combined)", () => {
  function fakeHeaders(map) {
    return {
      get: (name) => map[name.toLowerCase()] ?? null,
    };
  }

  it("allows when neither header is set", () => {
    expect(framingAllowed(fakeHeaders({}), APP_ORIGINS)).toBe(true);
  });

  it("blocks on XFO DENY", () => {
    expect(
      framingAllowed(fakeHeaders({ "x-frame-options": "DENY" }), APP_ORIGINS),
    ).toBe(false);
  });

  it("blocks on CSP frame-ancestors 'none'", () => {
    expect(
      framingAllowed(
        fakeHeaders({
          "content-security-policy": "frame-ancestors 'none'",
        }),
        APP_ORIGINS,
      ),
    ).toBe(false);
  });

  it("allows when CSP frame-ancestors includes 'self' (sidecar runs on same loopback host)", () => {
    expect(
      framingAllowed(
        fakeHeaders({
          "content-security-policy": "frame-ancestors 'self'",
        }),
        APP_ORIGINS,
      ),
    ).toBe(true);
  });
});
