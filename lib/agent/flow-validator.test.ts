// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  type FlowPlan,
  type FlowStep,
  normalizeText,
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
});
