// @vitest-environment node
//
// We mock the AI SDK's `streamText` so the session loop has deterministic
// input. The mock builds tools internally (we pass-through the tools the
// runner gave us, then invoke the build_flow tool inline) so we can drive
// the retry / downgrade behavior end-to-end without a live model.
//
// The provider-factory imports are also mocked — they all return a string
// constant ("model") that we never inspect, since `streamText` is mocked.
import { describe, expect, it, vi } from "vitest";

type ToolExecuteResult = { __error?: unknown; output?: unknown };

// The script the mocked streamText follows for a given test. Each entry is
// either a text delta or a tool call to make. The mock returns a `fullStream`
// async iterable of TextStreamPart-shaped objects, and runs the tool's
// `execute` for each tool-call entry — capturing thrown errors so subsequent
// entries can react.
type ScriptEntry =
  | { kind: "text"; text: string }
  | {
      kind: "tool";
      name: string;
      input: unknown;
      onResult?: (r: ToolExecuteResult) => ScriptEntry[] | void;
    };

let nextScript: ScriptEntry[] = [];

vi.mock("@/lib/agent/tools", () => ({
  // The wrappers in session.ts call `.execute` and capture (url, text).
  // For unit tests we expose minimal tool stubs that the session.ts code
  // re-wraps; we never actually trigger them through ai-sdk's loop.
  makeFetchUrlTool: () => ({
    description: "fetch_url",
    inputSchema: { _def: {} },
    execute: async ({ url }: { url: string }) => ({
      title: url,
      text: SCRIPTED_FETCH_TEXT.get(url) ?? `default page text for ${url}`,
    }),
  }),
  makeWebSearchTool: () => ({
    description: "web_search",
    inputSchema: { _def: {} },
    execute: async () => ({ results: [] }),
  }),
}));

vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => () => "model:openai",
}));
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: () => () => "model:anthropic",
}));
vi.mock("@ai-sdk/google", () => ({
  createGoogleGenerativeAI: () => () => "model:google",
}));
vi.mock("@ai-sdk/deepseek", () => ({
  createDeepSeek: () => () => "model:deepseek",
}));

vi.mock("ai", async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    streamText: vi.fn(
      (opts: {
        tools: Record<
          string,
          { execute?: (input: unknown, ctx: unknown) => Promise<unknown> }
        >;
      }) => {
        const tools = opts.tools;
        const script = nextScript;
        async function* gen() {
          let queue: ScriptEntry[] = [...script];
          while (queue.length > 0) {
            const entry = queue.shift()!;
            if (entry.kind === "text") {
              yield {
                type: "text-delta" as const,
                id: "t",
                text: entry.text,
              };
            } else if (entry.kind === "tool") {
              const tool = tools[entry.name];
              if (!tool?.execute) {
                throw new Error(`mock script: unknown tool ${entry.name}`);
              }
              let output: unknown;
              let errored = false;
              let errVal: unknown;
              try {
                output = await tool.execute(entry.input, {
                  toolCallId: "x",
                  messages: [],
                });
              } catch (err) {
                errored = true;
                errVal = err;
              }
              const more = entry.onResult?.(
                errored ? { __error: errVal } : { output },
              );
              if (more) queue = [...more, ...queue];
            }
          }
        }
        return { fullStream: gen() };
      },
    ),
  };
});

const SCRIPTED_FETCH_TEXT = new Map<string, string>();

import type { SessionEvent } from "./session";
import { nodeFromStep, runSession } from "./session";

async function collect(
  iter: AsyncIterable<SessionEvent>,
): Promise<SessionEvent[]> {
  const out: SessionEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

const baseReq = {
  messages: [
    {
      id: "m1",
      role: "user" as const,
      text: "us visa application",
      createdAt: 1,
    },
  ],
  canvasContext: [],
  providerId: "openai" as const,
  apiKey: "sk-test",
};

describe("runSession", () => {
  it("happy path: text delta → fetch → valid build_flow → flow_meta + nodes + done", async () => {
    SCRIPTED_FETCH_TEXT.set(
      "https://example.gov/step-1",
      "Schedule an appointment online to file Form DS-160.",
    );
    SCRIPTED_FETCH_TEXT.set(
      "https://example.gov/step-2",
      "Pay the visa application fee at any approved bank.",
    );

    nextScript = [
      { kind: "text", text: "Researching..." },
      {
        kind: "tool",
        name: "fetch_url",
        input: { url: "https://example.gov/step-1" },
      },
      {
        kind: "tool",
        name: "fetch_url",
        input: { url: "https://example.gov/step-2" },
      },
      {
        kind: "tool",
        name: "build_flow",
        input: {
          intent: "task",
          title: "US visa application",
          steps: [
            {
              id: "step-1",
              title: "File DS-160",
              url: "https://example.gov/step-1",
              instruction: "Complete Form DS-160 online.",
              sourceQuote: "file Form DS-160",
              sourceUrl: "https://example.gov/step-1",
              requires: [],
              optional: false,
              requiresLogin: true,
            },
            {
              id: "step-2",
              title: "Pay the fee",
              url: "https://example.gov/step-2",
              instruction: "Pay the visa application fee.",
              sourceQuote: "Pay the visa application fee",
              sourceUrl: "https://example.gov/step-2",
              requires: ["step-1"],
              optional: false,
              requiresLogin: false,
            },
          ],
        },
      },
    ];

    const events = await collect(
      runSession(baseReq, new AbortController().signal),
    );
    const kinds = events.map((e) => e.kind);
    expect(kinds).toEqual([
      "assistant_text",
      "flow_meta",
      "node",
      "node",
      "done",
    ]);
    const meta = events.find((e) => e.kind === "flow_meta")!;
    expect(meta).toMatchObject({
      kind: "flow_meta",
      intent: "task",
      downgraded: false,
    });
    const nodes = events.filter((e) => e.kind === "node") as Array<
      Extract<SessionEvent, { kind: "node" }>
    >;
    expect(nodes).toHaveLength(2);
    expect(nodes[0].url).toBe("https://example.gov/step-1");
    // Step 1 has requiresLogin:true → must ship as `link` so WebpageNode
    // doesn't try to screenshot behind an auth wall. Step 2 has
    // requiresLogin:false → stays `screenshot`.
    expect(nodes[0].mode).toBe("link");
    expect(nodes[1].mode).toBe("screenshot");
  });

  it("invalid quote on first call → agent retries; second call validates and emits nodes", async () => {
    SCRIPTED_FETCH_TEXT.set(
      "https://a",
      "the correct phrase is here in the page",
    );

    nextScript = [
      {
        kind: "tool",
        name: "fetch_url",
        input: { url: "https://a" },
      },
      {
        kind: "tool",
        name: "build_flow",
        input: {
          intent: "task",
          title: "Test",
          steps: [
            {
              id: "s1",
              title: "S1",
              url: "https://a",
              instruction: "Do it.",
              sourceQuote: "completely wrong quote",
              sourceUrl: "https://a",
              requires: [],
              optional: false,
              requiresLogin: false,
            },
          ],
        },
        onResult: (r) => {
          // First call must fail validation — confirms retry plumbing.
          expect(r.__error).toBeInstanceOf(Error);
          // On the second call, send a valid quote.
          return [
            {
              kind: "tool",
              name: "build_flow",
              input: {
                intent: "task",
                title: "Test",
                steps: [
                  {
                    id: "s1",
                    title: "S1",
                    url: "https://a",
                    instruction: "Do it.",
                    sourceQuote: "the correct phrase",
                    sourceUrl: "https://a",
                    requires: [],
                    optional: false,
                    requiresLogin: false,
                  },
                ],
              },
            },
          ];
        },
      },
    ];

    const events = await collect(
      runSession(baseReq, new AbortController().signal),
    );
    // Exactly one flow_meta + one node make it out: the retry succeeded.
    const meta = events.filter((e) => e.kind === "flow_meta");
    expect(meta).toHaveLength(1);
    expect((meta[0] as { downgraded: boolean }).downgraded).toBe(false);
    expect(events.filter((e) => e.kind === "node")).toHaveLength(1);
    expect(events.at(-1)?.kind).toBe("done");
  });

  it("three failed validations → intent force-downgrades to explore on the third call", async () => {
    SCRIPTED_FETCH_TEXT.set("https://a", "page text");
    const badPlan = {
      intent: "task" as const,
      title: "Test",
      steps: [
        {
          id: "s1",
          title: "S1",
          url: "https://a",
          instruction: "do it",
          sourceQuote: "not present",
          sourceUrl: "https://a",
          requires: [],
          optional: false,
          requiresLogin: false,
        },
      ],
    };

    // Three build_flow calls in a row. First two must fail; the third
    // call (regardless of quote) must succeed via forced downgrade.
    nextScript = [
      { kind: "tool", name: "fetch_url", input: { url: "https://a" } },
      {
        kind: "tool",
        name: "build_flow",
        input: badPlan,
        onResult: (r) => {
          expect(r.__error).toBeInstanceOf(Error);
        },
      },
      {
        kind: "tool",
        name: "build_flow",
        input: badPlan,
        onResult: (r) => {
          expect(r.__error).toBeInstanceOf(Error);
        },
      },
      {
        kind: "tool",
        name: "build_flow",
        input: badPlan,
        onResult: (r) => {
          // Third call succeeds — no error.
          expect(r.__error).toBeUndefined();
        },
      },
    ];

    const events = await collect(
      runSession(baseReq, new AbortController().signal),
    );
    const meta = events.find((e) => e.kind === "flow_meta") as
      | {
          kind: "flow_meta";
          intent: "task" | "explore";
          downgraded: boolean;
        }
      | undefined;
    expect(meta).toBeDefined();
    expect(meta?.intent).toBe("explore");
    expect(meta?.downgraded).toBe(true);
    // The friendly assistant_text explaining the downgrade should be emitted.
    const downgradeMsg = events.find(
      (e) =>
        e.kind === "assistant_text" &&
        /exploration tiles/i.test((e as { text: string }).text),
    );
    expect(downgradeMsg).toBeDefined();
    // Exactly one node from the (now-explore) plan.
    expect(events.filter((e) => e.kind === "node")).toHaveLength(1);
  });
});

describe("nodeFromStep", () => {
  it("maps requiresLogin:true → mode 'link'", () => {
    const ev = nodeFromStep({
      title: "Sign in to USCIS",
      url: "https://my.uscis.gov/account",
      instruction: "Sign in to your USCIS account.",
      requiresLogin: true,
    });
    expect(ev.mode).toBe("link");
    expect(ev.hostname).toBe("my.uscis.gov");
    expect(ev.summary).toBe("Sign in to your USCIS account.");
  });

  it("maps requiresLogin:false → mode 'screenshot'", () => {
    const ev = nodeFromStep({
      title: "How to apply",
      url: "https://www.example.gov/apply",
      instruction: "Read the eligibility section.",
      requiresLogin: false,
    });
    expect(ev.mode).toBe("screenshot");
    // safeHostname strips the leading www.
    expect(ev.hostname).toBe("example.gov");
  });
});
