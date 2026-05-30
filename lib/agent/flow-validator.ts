/**
 * Flow validator for the master agent.
 *
 * The agent emits a `FlowPlan` via the `build_flow` tool. For "task" intent,
 * every step must carry a `sourceQuote` that appears verbatim (modulo
 * whitespace, NFC, and case) inside the text the agent actually fetched
 * during this run. That fetched-page corpus is supplied as a Map keyed by
 * the URL exactly as `fetch_url` was called with.
 *
 * For "explore" intent we skip quote validation (the canvas is meant to be a
 * loose set of useful pages, not a grounded task plan), but the rest of the
 * shape still has to be sensible — that's enforced by the Zod schema at the
 * tool boundary, not here.
 *
 * Known limitation: this validator does NOT decode HTML entities. The agent
 * sees Readability-parsed text from `fetch_url`, so it should quote decoded
 * text. A quote containing `&amp;` will fail to match a source containing a
 * literal `&`, which is the desired (strict) behavior — encoded quotes are
 * a sign the model is fabricating from the raw HTML it didn't actually see.
 */

export type FlowStep = {
  id: string;
  title: string;
  url: string;
  instruction: string;
  sourceQuote: string;
  sourceUrl: string;
  requires: string[];
  optional: boolean;
  requiresLogin: boolean;
};

export type FlowPlan = {
  intent: "task" | "explore";
  title: string;
  steps: FlowStep[];
};

export type ValidationError =
  | { kind: "missing-source-url"; stepId: string }
  | { kind: "source-not-fetched"; stepId: string; sourceUrl: string }
  | {
      kind: "quote-not-in-source";
      stepId: string;
      sourceUrl: string;
      quote: string;
    }
  | { kind: "quote-empty"; stepId: string };

export type ValidationOk = { ok: true };
export type ValidationErr = { ok: false; errors: ValidationError[] };

/**
 * Lower-cased, NFC-normalized, whitespace-collapsed copy of `s`. Returns
 * the empty string for empty input. The transform is deliberately lossy —
 * we want "foo bar" and "  Foo\n\tbar  " to compare equal.
 */
export function normalizeText(s: string): string {
  if (!s) return "";
  return s.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Canonicalize a URL for keyed lookups so trivial agent typos
 * (`#fragment`, trailing slash, host capitalization) don't read as
 * source-not-fetched. We deliberately do NOT touch the query string —
 * `?utm_*` params can change page semantics on real-world sites, and
 * stripping them blindly is more dangerous than letting a strict miss
 * surface as a retry. Falls through to the raw input for non-URLs so a
 * malformed `sourceUrl` still hits the unfetched-source error path.
 */
export function urlKey(raw: string): string {
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    u.hash = "";
    if (u.pathname.endsWith("/") && u.pathname !== "/") {
      u.pathname = u.pathname.slice(0, -1);
    }
    // URL constructor already lowercases the host; leave the path
    // alone (case can be significant on Unix-style URL paths).
    return u.toString();
  } catch {
    return raw;
  }
}

/**
 * Validate a flow plan against the fetched-page corpus.
 *
 * - For "explore" intent: skip quote checks entirely. `sourceUrl` and
 *   `sourceQuote` may be empty. We still return an ok result.
 * - For "task" intent: every step needs a non-empty `sourceQuote` that
 *   normalizeText-matches inside the normalized fetched text for its
 *   `sourceUrl`. Multiple errors are collected (not short-circuited) so
 *   the agent can fix several mistakes in one retry.
 */
export function validateFlowPlan(
  plan: FlowPlan,
  fetchedPages: Map<string, string>,
): ValidationOk | ValidationErr {
  if (plan.intent === "explore") {
    return { ok: true };
  }

  // Pre-normalize the corpus once. Keys are canonicalized so a step that
  // passes `https://EXAMPLE.com/foo/#anchor` still matches a fetch of
  // `https://example.com/foo`; only the values get folded.
  const normalizedCorpus = new Map<string, string>();
  for (const [url, text] of fetchedPages) {
    normalizedCorpus.set(urlKey(url), normalizeText(text));
  }

  const errors: ValidationError[] = [];
  for (const step of plan.steps) {
    const quote = step.sourceQuote?.trim() ?? "";
    const hasQuote = quote.length > 0;
    const hasSourceUrl = Boolean(step.sourceUrl);
    // Collect both shape errors before continuing — short-circuiting after
    // the first means the agent only learns about one problem per step per
    // retry, wasting a round-trip.
    if (!hasQuote) errors.push({ kind: "quote-empty", stepId: step.id });
    if (!hasSourceUrl)
      errors.push({ kind: "missing-source-url", stepId: step.id });
    if (!hasQuote || !hasSourceUrl) continue;

    const haystack = normalizedCorpus.get(urlKey(step.sourceUrl));
    if (haystack === undefined) {
      errors.push({
        kind: "source-not-fetched",
        stepId: step.id,
        sourceUrl: step.sourceUrl,
      });
      continue;
    }
    const needle = normalizeText(step.sourceQuote);
    if (!needle || !haystack.includes(needle)) {
      errors.push({
        kind: "quote-not-in-source",
        stepId: step.id,
        sourceUrl: step.sourceUrl,
        quote: step.sourceQuote,
      });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true };
}

/**
 * Format validation errors into a single string suitable for surfacing to the
 * model as a tool error. Each line points at the failing step so the model
 * can correct without re-emitting the whole plan blindly.
 */
function describeError(e: ValidationError): string {
  switch (e.kind) {
    case "quote-empty":
      return `step ${e.stepId}: sourceQuote is empty — provide a verbatim excerpt from the fetched page.`;
    case "missing-source-url":
      return `step ${e.stepId}: sourceUrl is missing — set it to the URL you passed to fetch_url.`;
    case "source-not-fetched":
      return `step ${e.stepId}: sourceUrl ${e.sourceUrl} was not fetched in this run — call fetch_url on it first, or pick a URL you did fetch.`;
    case "quote-not-in-source":
      return `step ${e.stepId}: sourceQuote was not found in the text fetched from ${e.sourceUrl}. Quote a contiguous span that appears verbatim in the page.`;
  }
}

export function formatValidationErrors(errors: ValidationError[]): string {
  return [
    "build_flow validation failed:",
    ...errors.map(describeError),
    "Fix these issues and call build_flow again with corrected quotes.",
  ].join("\n");
}
