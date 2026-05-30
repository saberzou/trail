// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  type FlowPlan,
  type FlowStep,
  normalizeText,
  urlKey,
  validateFlowPlan,
} from "./flow-validator";

function step(overrides: Partial<FlowStep> = {}): FlowStep {
  return {
    id: "s1",
    title: "Step 1",
    url: "https://example.com",
    instruction: "Do the thing.",
    sourceQuote: "verbatim quote",
    sourceUrl: "https://example.com",
    requires: [],
    optional: false,
    requiresLogin: false,
    ...overrides,
  };
}

function plan(
  steps: FlowStep[],
  intent: "task" | "explore" = "task",
): FlowPlan {
  return { intent, title: "Test plan", steps };
}

describe("normalizeText", () => {
  it("lower-cases, NFC-normalizes, and collapses whitespace", () => {
    expect(normalizeText("Hello  World")).toBe("hello world");
    expect(normalizeText("  A\n\nB\tC  ")).toBe("a b c");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeText("")).toBe("");
  });
});

describe("validateFlowPlan", () => {
  it("case 1: verbatim match passes", () => {
    const pages = new Map([["https://a", "Step one: file the form."]]);
    const p = plan([
      step({ sourceQuote: "file the form", sourceUrl: "https://a" }),
    ]);
    expect(validateFlowPlan(p, pages)).toEqual({ ok: true });
  });

  it("case 2: whitespace-collapsed match passes", () => {
    const pages = new Map([
      ["https://a", "Step  one:\n\nfile\tthe\nform now."],
    ]);
    const p = plan([
      step({ sourceQuote: "file the form now", sourceUrl: "https://a" }),
    ]);
    expect(validateFlowPlan(p, pages)).toEqual({ ok: true });
  });

  it("case 3: case-insensitive match passes", () => {
    const pages = new Map([["https://a", "File The Form Online"]]);
    const p = plan([
      step({ sourceQuote: "FILE THE FORM ONLINE", sourceUrl: "https://a" }),
    ]);
    expect(validateFlowPlan(p, pages)).toEqual({ ok: true });
  });

  it("case 4: NFC vs NFD unicode matches via normalization", () => {
    // The source has the precomposed é (U+00E9). The quote is the same
    // character expressed as e + combining acute (U+0065 U+0301). NFC
    // normalization folds both to the precomposed form.
    const precomposed = "café au lait";
    const decomposed = "café au lait";
    const pages = new Map([["https://a", precomposed]]);
    const p = plan([step({ sourceQuote: decomposed, sourceUrl: "https://a" })]);
    expect(validateFlowPlan(p, pages)).toEqual({ ok: true });
  });

  it("case 5: HTML entities are NOT decoded (known limitation)", () => {
    // Source text has literal `&` (Readability decodes entities). Quote
    // has `&amp;` — these intentionally do NOT match. The validator's
    // job is to confirm the model quoted decoded text.
    const pages = new Map([["https://a", "Smith & Jones LLP"]]);
    const p = plan([
      step({ sourceQuote: "Smith &amp; Jones", sourceUrl: "https://a" }),
    ]);
    const result = validateFlowPlan(p, pages);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].kind).toBe("quote-not-in-source");
    }
  });

  it("case 6: missing sourceUrl reports missing-source-url", () => {
    const pages = new Map([["https://a", "anything"]]);
    const p = plan([
      step({
        id: "step-a",
        sourceQuote: "anything",
        sourceUrl: "",
      }),
    ]);
    const result = validateFlowPlan(p, pages);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        { kind: "missing-source-url", stepId: "step-a" },
      ]);
    }
  });

  it("case 7: sourceUrl not in fetchedPages reports source-not-fetched", () => {
    const pages = new Map([["https://a", "anything"]]);
    const p = plan([
      step({
        id: "step-b",
        sourceQuote: "anything",
        sourceUrl: "https://b",
      }),
    ]);
    const result = validateFlowPlan(p, pages);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        {
          kind: "source-not-fetched",
          stepId: "step-b",
          sourceUrl: "https://b",
        },
      ]);
    }
  });

  it("case 8: quote not in source text reports quote-not-in-source", () => {
    const pages = new Map([["https://a", "what is actually here"]]);
    const p = plan([
      step({
        id: "step-c",
        sourceQuote: "completely different text",
        sourceUrl: "https://a",
      }),
    ]);
    const result = validateFlowPlan(p, pages);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatchObject({
        kind: "quote-not-in-source",
        stepId: "step-c",
        sourceUrl: "https://a",
      });
    }
  });

  it("case 9: empty quote reports quote-empty", () => {
    const pages = new Map([["https://a", "anything"]]);
    const p = plan([
      step({
        id: "step-d",
        sourceQuote: "   ",
        sourceUrl: "https://a",
      }),
    ]);
    const result = validateFlowPlan(p, pages);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toEqual([
        { kind: "quote-empty", stepId: "step-d" },
      ]);
    }
  });

  it("case 10: multiple fetched pages, quote in second page passes", () => {
    const pages = new Map([
      ["https://a", "irrelevant text on page A"],
      ["https://b", "the quoted phrase lives on page B"],
    ]);
    const p = plan([
      step({
        id: "step-x",
        sourceQuote: "the quoted phrase",
        sourceUrl: "https://b",
      }),
    ]);
    expect(validateFlowPlan(p, pages)).toEqual({ ok: true });
  });

  it("case 11: explore intent skips quote validation entirely", () => {
    const pages = new Map<string, string>();
    const p = plan(
      [
        step({ sourceQuote: "", sourceUrl: "" }),
        step({
          id: "s2",
          sourceQuote: "anything",
          sourceUrl: "https://never-fetched",
        }),
      ],
      "explore",
    );
    expect(validateFlowPlan(p, pages)).toEqual({ ok: true });
  });

  it("collects multiple errors instead of short-circuiting", () => {
    const pages = new Map([["https://a", "page text"]]);
    const p = plan([
      step({ id: "s1", sourceQuote: "", sourceUrl: "https://a" }),
      step({ id: "s2", sourceQuote: "page text", sourceUrl: "" }),
      step({ id: "s3", sourceQuote: "not here", sourceUrl: "https://a" }),
    ]);
    const result = validateFlowPlan(p, pages);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(3);
      expect(result.errors.map((e) => e.kind).sort()).toEqual([
        "missing-source-url",
        "quote-empty",
        "quote-not-in-source",
      ]);
    }
  });

  it("emits BOTH quote-empty AND missing-source-url for a step that lacks both", () => {
    const pages = new Map([["https://a", "anything"]]);
    const p = plan([
      step({ id: "step-broken", sourceQuote: "", sourceUrl: "" }),
    ]);
    const result = validateFlowPlan(p, pages);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Both errors must be reported so the agent can fix both in one
      // retry instead of bouncing twice on the same step.
      const kinds = result.errors
        .filter((e) => "stepId" in e && e.stepId === "step-broken")
        .map((e) => e.kind)
        .sort();
      expect(kinds).toEqual(["missing-source-url", "quote-empty"]);
    }
  });

  it("quote longer than the fetched text reports quote-not-in-source (no crash)", () => {
    const pages = new Map([["https://a", "tiny."]]);
    const p = plan([
      step({
        id: "step-long",
        sourceQuote: "this quote is dramatically longer than the page content",
        sourceUrl: "https://a",
      }),
    ]);
    const result = validateFlowPlan(p, pages);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0]).toMatchObject({
        kind: "quote-not-in-source",
        stepId: "step-long",
      });
    }
  });

  it("collects all four error kinds across different steps in one pass", () => {
    const pages = new Map([["https://a", "page text"]]);
    const p = plan([
      // quote-empty
      step({ id: "s1", sourceQuote: "", sourceUrl: "https://a" }),
      // missing-source-url
      step({ id: "s2", sourceQuote: "page text", sourceUrl: "" }),
      // source-not-fetched
      step({ id: "s3", sourceQuote: "page text", sourceUrl: "https://b" }),
      // quote-not-in-source
      step({ id: "s4", sourceQuote: "not here", sourceUrl: "https://a" }),
    ]);
    const result = validateFlowPlan(p, pages);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.map((e) => e.kind).sort()).toEqual([
        "missing-source-url",
        "quote-empty",
        "quote-not-in-source",
        "source-not-fetched",
      ]);
    }
  });

  it("URL key normalization: trailing slash + #fragment + host case all match", () => {
    const pages = new Map([["https://example.com/foo", "the canonical text"]]);
    const p = plan([
      step({
        id: "s-url",
        sourceQuote: "the canonical text",
        sourceUrl: "https://EXAMPLE.com/foo/#section",
      }),
    ]);
    expect(validateFlowPlan(p, pages)).toEqual({ ok: true });
  });

  it("URL key normalization: query string IS significant (not stripped)", () => {
    // Two URLs differing only in ?q= are NOT the same page semantically —
    // think a search results page vs the home page. We deliberately do
    // not normalize the query.
    const pages = new Map([["https://example.com/?q=foo", "results for foo"]]);
    const p = plan([
      step({
        id: "s-q",
        sourceQuote: "results for foo",
        sourceUrl: "https://example.com/?q=bar",
      }),
    ]);
    const result = validateFlowPlan(p, pages);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors[0].kind).toBe("source-not-fetched");
    }
  });
});

describe("urlKey", () => {
  it("strips fragment", () => {
    expect(urlKey("https://example.com/x#anchor")).toBe(
      "https://example.com/x",
    );
  });
  it("collapses trailing slash on non-root paths", () => {
    expect(urlKey("https://example.com/a/b/")).toBe("https://example.com/a/b");
  });
  it("preserves the bare root slash", () => {
    expect(urlKey("https://example.com/")).toBe("https://example.com/");
  });
  it("lowercases the host", () => {
    expect(urlKey("https://EXAMPLE.com/Foo")).toBe("https://example.com/Foo");
  });
  it("preserves path case", () => {
    // Some servers serve case-sensitive paths (notably nginx + Unix).
    // We must not lowercase the path or we'd cause spurious miss/hit.
    expect(urlKey("https://example.com/CASE")).toContain("/CASE");
  });
  it("falls through on malformed input", () => {
    expect(urlKey("not-a-url")).toBe("not-a-url");
    expect(urlKey("")).toBe("");
  });
});
