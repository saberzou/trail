/**
 * Master agent runner — drives an AI SDK v6 `streamText` tool loop with
 * `web_search`, `fetch_url`, and the structured-output `build_flow` tool.
 *
 * Architecture in a nutshell:
 *
 * 1.  Caller hands us a `SessionRequest` with messages, provider keys, and
 *     optional search creds.
 * 2.  We build a per-session `fetchedPages: Map<url, text>` that captures the
 *     output of every `fetch_url` call. This is the grounding corpus for
 *     `build_flow` quote validation.
 * 3.  `streamText` runs with a step budget (`stepCountIs(8)`). The model is
 *     prompted to: search → fetch 2-5 promising URLs → emit `build_flow`.
 * 4.  Inside `build_flow.execute`, we Zod-parse the plan, run
 *     `validateFlowPlan` against `fetchedPages`, and either:
 *       - emit `flow_meta` + per-step `node` events into the outer event
 *         queue and return success to the model, OR
 *       - increment `retryCount`, throw a structured error so the AI SDK
 *         surfaces it back to the model as a tool error and it can retry.
 * 5.  After two failed validation attempts (retryCount >= 2), the third
 *     call force-downgrades intent to "explore" — quotes are dropped, the
 *     plan ships, and the user is told via an assistant_text event.
 *
 * Events are streamed out via the async iterable returned from `runSession`.
 * Text deltas from the model become `assistant_text` events; tool executions
 * push `flow_meta` and `node` events; the loop ends with `done` or `error`.
 */

import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import {
  type LanguageModel,
  type ModelMessage,
  stepCountIs,
  streamText,
  tool,
} from "ai";
import { nanoid } from "nanoid";
import { z } from "zod";
import type { ChatMessage } from "@/lib/chat/persistence";
import { formatValidationErrors, validateFlowPlan } from "./flow-validator";
import { makeFetchUrlTool, makeWebSearchTool } from "./tools";

export type SessionRequest = {
  messages: ChatMessage[];
  /** Existing webpage tiles already on the canvas (title + url), so the
   * agent doesn't re-suggest pages the user already pinned. Cap at 10. */
  canvasContext: { title: string; url: string }[];
  providerId: "openai" | "anthropic" | "google" | "deepseek";
  apiKey: string;
  searchProvider?: "brave" | "tavily";
  searchKey?: string;
  /** Optional model override; otherwise we pick the default per provider. */
  model?: string;
};

export type SessionEvent =
  | { kind: "assistant_text"; text: string }
  | {
      kind: "node";
      nodeId: string;
      title: string;
      url: string;
      hostname: string;
      mode: "screenshot" | "iframe" | "link";
      summary?: string;
    }
  | {
      kind: "flow_meta";
      intent: "task" | "explore";
      title: string;
      downgraded: boolean;
    }
  | { kind: "done"; runId: string }
  | { kind: "error"; message: string; code?: string };

const flowSchema = z.object({
  intent: z.enum(["task", "explore"]),
  title: z.string().min(1),
  steps: z
    .array(
      z.object({
        id: z.string().min(1),
        title: z.string().min(1),
        url: z.string().url(),
        instruction: z.string().min(1),
        sourceQuote: z.string(),
        sourceUrl: z.string(),
        requires: z.array(z.string()),
        optional: z.boolean(),
        requiresLogin: z.boolean(),
      }),
    )
    .min(1)
    .max(8),
});

const MAX_RETRIES = 2;
const STEP_BUDGET = 8;

function defaultModelId(providerId: SessionRequest["providerId"]): string {
  switch (providerId) {
    case "openai":
      return "gpt-4o-mini";
    case "anthropic":
      return "claude-3-5-sonnet-latest";
    case "google":
      return "gemini-2.0-flash";
    case "deepseek":
      return "deepseek-chat";
  }
}

/**
 * Build the LanguageModel for the requested provider. Kept tiny so callers
 * (and tests) can swap providers without dragging in a factory abstraction.
 */
function resolveModel(req: SessionRequest): LanguageModel {
  const modelId = req.model ?? defaultModelId(req.providerId);
  switch (req.providerId) {
    case "openai":
      return createOpenAI({ apiKey: req.apiKey })(modelId);
    case "anthropic":
      return createAnthropic({ apiKey: req.apiKey })(modelId);
    case "google":
      return createGoogleGenerativeAI({ apiKey: req.apiKey })(modelId);
    case "deepseek":
      return createDeepSeek({ apiKey: req.apiKey })(modelId);
  }
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function buildSystemPrompt(opts: {
  hasSearch: boolean;
  canvasContext: { title: string; url: string }[];
}): string {
  const ctx =
    opts.canvasContext.length > 0
      ? `\n\nExisting tiles on the canvas (do not duplicate):\n${opts.canvasContext
          .slice(0, 10)
          .map((c, i) => `${i + 1}. ${c.title} — ${c.url}`)
          .join("\n")}`
      : "\n\nThe canvas is empty.";

  const search = opts.hasSearch
    ? "You have `web_search` for finding sources."
    : "No web_search is configured. Use prior knowledge to pick canonical authoritative URLs, then call fetch_url to verify their content before quoting.";

  return `You are Trail, a visual research assistant. The user asks a question; you produce a flow plan that materializes as tiles on a canvas to their left.

Decide intent:
- "task" — the user wants to complete a multi-step task ("us visa application", "incorporate an LLC in Delaware"). Produce ordered steps grounded in authoritative sources.
- "explore" — the user wants to browse a topic ("best espresso machines", "history of Vermont"). Produce a loose set of useful pages.

For TASK intent, every step MUST include a \`sourceQuote\` that appears VERBATIM in the text returned by \`fetch_url\` for the matching \`sourceUrl\`. You will be retried if a quote doesn't match; after 2 retries the intent will be force-downgraded to "explore".

For EXPLORE intent, \`sourceQuote\` and \`sourceUrl\` can be empty strings.

Workflow:
1. ${search}${opts.hasSearch ? " Call web_search 1-3 times to find sources." : ""}
2. Call \`fetch_url\` on the 2-5 most promising URLs.
3. Call \`build_flow\` with the structured plan. Set \`requires\` to the IDs of prior steps that must complete first. Mark steps that need login (USCIS, bank portals, government forms) as \`requiresLogin: true\`.

Be concise. 3-7 steps for task; 4-8 tiles for explore. Each \`instruction\` is 1-3 sentences. Quotes should be short (one sentence or less) and copy-pasted from the fetched page.${ctx}`;
}

/**
 * Translate ChatMessage[] (Trail's local persisted shape) into the ModelMessage
 * shape the AI SDK expects. We only support text content right now.
 */
function toModelMessages(messages: ChatMessage[]): ModelMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.text,
  }));
}

/**
 * Map a thrown error into a user-facing message. We don't want to leak raw
 * provider SDK strings — they often contain prompts, URLs, or stack traces.
 */
function classifyError(err: unknown): { message: string; code?: string } {
  if (err instanceof Error) {
    const name = err.name;
    const msg = err.message;
    if (name === "AbortError" || /aborted/i.test(msg)) {
      return { message: "Stopped.", code: "aborted" };
    }
    if (/401|unauthor|invalid[_ ]?api[_ ]?key/i.test(msg)) {
      return {
        message: "Provider rejected the API key. Check /settings.",
        code: "auth",
      };
    }
    if (/429|rate[_ ]?limit/i.test(msg)) {
      return {
        message: "Provider rate-limited the request. Try again in a moment.",
        code: "rate-limit",
      };
    }
    const oneLine = msg.split("\n")[0].slice(0, 240);
    return { message: `Agent run failed: ${oneLine}` };
  }
  return { message: "Agent run failed." };
}

/**
 * Run the master agent for this turn. Yields `SessionEvent`s as the stream
 * progresses; finalizes with `done` (or `error`). Caller is responsible for
 * marshalling these onto an SSE stream / into editor calls.
 */
export async function* runSession(
  req: SessionRequest,
  signal: AbortSignal,
): AsyncIterable<SessionEvent> {
  const runId = nanoid(10);

  // Captured fetched-page corpus for this run. Each successful fetch_url
  // execution pushes (requested-url, extracted-text) here. The key is the
  // URL exactly as the model called fetch_url with so that build_flow's
  // sourceUrl can be looked up directly.
  const fetchedPages = new Map<string, string>();

  // Outer event queue. The streamText loop and the build_flow tool both
  // produce events; we pump them out in the order they arrive. The
  // `pumpResolve` handle lets a tool execution wake the for-await loop
  // immediately when it enqueues an event, instead of waiting on the next
  // stream tick.
  const queue: SessionEvent[] = [];
  let pumpResolve: (() => void) | null = null;
  function wake() {
    const r = pumpResolve;
    if (r) {
      pumpResolve = null;
      r();
    }
  }
  const enqueue = (e: SessionEvent) => {
    queue.push(e);
    wake();
  };

  // Retry accounting for the build_flow validator → forced-downgrade flow.
  let retryCount = 0;
  let downgraded = false;

  // --- Tools ---------------------------------------------------------------

  const baseFetch = makeFetchUrlTool();
  const fetchUrlTool = tool({
    description: baseFetch.description,
    inputSchema: baseFetch.inputSchema as z.ZodType<{ url: string }>,
    execute: async (input, ctx) => {
      // Delegate to the SSRF-hardened implementation, then capture the
      // (url, text) pair under the exact URL the agent passed (NOT the
      // final URL after redirects — build_flow.sourceUrl is what the
      // agent saw, not what the network ended up at).
      const result = (await baseFetch.execute!(input, ctx)) as {
        title: string;
        text: string;
      };
      fetchedPages.set(input.url, result.text);
      return result;
    },
  });

  const webSearchTool =
    req.searchProvider && req.searchKey
      ? makeWebSearchTool({
          provider: req.searchProvider,
          apiKey: req.searchKey,
        })
      : undefined;

  const buildFlowTool = tool({
    description:
      "Submit the final flow plan. Every step's sourceQuote must appear verbatim in the text fetch_url returned for that step's sourceUrl. Validation runs on call.",
    inputSchema: flowSchema,
    execute: async (input) => {
      const forceDowngrade = retryCount >= MAX_RETRIES;
      const effectivePlan = forceDowngrade
        ? // Strip quotes; treat as explore.
          {
            ...input,
            intent: "explore" as const,
            steps: input.steps.map((s) => ({
              ...s,
              sourceQuote: "",
              sourceUrl: "",
            })),
          }
        : input;

      if (!forceDowngrade) {
        const result = validateFlowPlan(effectivePlan, fetchedPages);
        if (!result.ok) {
          retryCount += 1;
          // Surface the validation errors to the model as a tool error so
          // the AI SDK passes them back into the next step.
          throw new Error(formatValidationErrors(result.errors));
        }
      } else if (!downgraded) {
        downgraded = true;
        enqueue({
          kind: "assistant_text",
          text: "I couldn't ground every step in the sources I fetched, so I'm showing these as exploration tiles instead.",
        });
      }

      enqueue({
        kind: "flow_meta",
        intent: effectivePlan.intent,
        title: effectivePlan.title,
        downgraded: forceDowngrade,
      });
      for (const step of effectivePlan.steps) {
        enqueue({
          kind: "node",
          nodeId: nanoid(10),
          title: step.title,
          url: step.url,
          hostname: safeHostname(step.url),
          // PR2b: ship everything as screenshot. The WebpageNode UI will
          // fall back to link if the screenshot sidecar refuses.
          mode: "screenshot",
          summary: step.instruction,
        });
      }
      return {
        ok: true,
        nodeCount: effectivePlan.steps.length,
        downgraded: forceDowngrade,
      };
    },
  });

  const tools: Record<string, unknown> = {
    fetch_url: fetchUrlTool,
    build_flow: buildFlowTool,
  };
  if (webSearchTool) tools.web_search = webSearchTool;

  // --- Stream --------------------------------------------------------------

  const system = buildSystemPrompt({
    hasSearch: Boolean(webSearchTool),
    canvasContext: req.canvasContext,
  });

  let streamResult: ReturnType<typeof streamText>;
  try {
    streamResult = streamText({
      model: resolveModel(req),
      // `tools` is inferred — cast through because we built the record
      // dynamically (web_search may be absent).
      tools: tools as Parameters<typeof streamText>[0]["tools"],
      stopWhen: stepCountIs(STEP_BUDGET),
      abortSignal: signal,
      system,
      messages: toModelMessages(req.messages),
    });
  } catch (err) {
    yield { kind: "error", ...classifyError(err) };
    return;
  }

  // Consume the full stream in the background, feeding text deltas and
  // surfacing tool errors into the queue. We deliberately do NOT await the
  // stream here — instead the main for-await yields out of `queue` as
  // events arrive, and the stream's completion (or failure) flips a flag
  // the queue-drain loop watches.
  let streamDone = false;
  let streamError: unknown = null;
  const pump = (async () => {
    try {
      for await (const part of streamResult.fullStream) {
        if (signal.aborted) break;
        if (part.type === "text-delta") {
          if (part.text) enqueue({ kind: "assistant_text", text: part.text });
        } else if (part.type === "error") {
          // streamText emits a non-throwing 'error' part for transient
          // upstream issues. Treat it as fatal for this run.
          streamError = part.error;
          break;
        } else if (part.type === "abort") {
          streamError = new DOMException("aborted", "AbortError");
          break;
        }
        // tool-call / tool-result / tool-error are handled inside the tool
        // executions themselves; nothing to surface to the user.
      }
    } catch (err) {
      streamError = err;
    } finally {
      streamDone = true;
      wake();
    }
  })();

  // --- Drain ---------------------------------------------------------------

  while (true) {
    if (queue.length > 0) {
      const ev = queue.shift();
      if (ev) yield ev;
      continue;
    }
    if (streamDone) break;
    // Wait for the next enqueue OR the stream to finish.
    await new Promise<void>((res) => {
      pumpResolve = res;
    });
  }

  // Make sure the background task is fully settled before we wrap up.
  await pump;

  if (streamError) {
    yield { kind: "error", ...classifyError(streamError) };
    return;
  }
  yield { kind: "done", runId };
}
