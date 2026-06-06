// @vitest-environment node
//
// LIVE smoke test for the full agent path (real model + real search + the
// verbatim-quote validator). This is the ONE path the offline scenario tests
// can't cover, because it actually calls a provider.
//
// It is opt-in: the default `pnpm test` EXCLUDES `*.live.test.ts` (see
// vitest.config.ts), and even when run it SKIPS unless a key is present. Run
// it explicitly with:
//
//   TRAIL_LIVE_API_KEY=sk-...            # required
//   TRAIL_LIVE_PROVIDER=deepseek         # openai | anthropic | google | deepseek (default openai)
//   TRAIL_LIVE_SEARCH=brave              # optional: brave | tavily
//   TRAIL_LIVE_SEARCH_KEY=...            # required iff TRAIL_LIVE_SEARCH is set
//   pnpm test:live
//
// Keep the key in your shell env (or a gitignored .env) — never commit it.
import { describe, expect, it } from "vitest";
import { runSession, type SessionEvent, type SessionRequest } from "./session";

const API_KEY = process.env.TRAIL_LIVE_API_KEY;
const PROVIDER = (process.env.TRAIL_LIVE_PROVIDER ??
  "openai") as SessionRequest["providerId"];
const SEARCH = process.env.TRAIL_LIVE_SEARCH as "brave" | "tavily" | undefined;
const SEARCH_KEY = process.env.TRAIL_LIVE_SEARCH_KEY;

// Skip the whole suite unless a key is provided.
const maybe = API_KEY ? describe : describe.skip;

function makeReq(text: string): SessionRequest {
  return {
    messages: [{ id: "m1", role: "user", text, createdAt: Date.now() }],
    canvasContext: [],
    providerId: PROVIDER,
    // biome-ignore lint/style/noNonNullAssertion: guarded by describe.skip above.
    apiKey: API_KEY!,
    ...(SEARCH && SEARCH_KEY
      ? { searchProvider: SEARCH, searchKey: SEARCH_KEY }
      : {}),
  };
}

async function collect(text: string): Promise<SessionEvent[]> {
  const controller = new AbortController();
  const events: SessionEvent[] = [];
  for await (const e of runSession(makeReq(text), controller.signal)) {
    events.push(e);
  }
  return events;
}

function nodes(events: SessionEvent[]) {
  return events.filter(
    (e): e is Extract<SessionEvent, { kind: "node" }> => e.kind === "node",
  );
}
function flowMeta(events: SessionEvent[]) {
  return events.find(
    (e): e is Extract<SessionEvent, { kind: "flow_meta" }> =>
      e.kind === "flow_meta",
  );
}

maybe(`live agent (${PROVIDER}${SEARCH ? ` + ${SEARCH}` : ""})`, () => {
  it("task: 'apply for a US visitor visa' produces a grounded flow of real sites", async () => {
    const events = await collect(
      "Walk me through applying for a U.S. B-1/B-2 tourist visa.",
    );

    // The turn must finish cleanly.
    const errors = events.filter((e) => e.kind === "error");
    expect(errors, JSON.stringify(errors)).toHaveLength(0);
    expect(events.at(-1)?.kind).toBe("done");

    // It must author a flow with at least a couple of real, http(s) tiles.
    const meta = flowMeta(events);
    expect(meta).toBeDefined();
    expect(["task", "explore"]).toContain(meta?.intent);

    const ns = nodes(events);
    expect(ns.length).toBeGreaterThanOrEqual(2);
    for (const n of ns) {
      expect(n.url).toMatch(/^https?:\/\//);
      expect(n.hostname.length).toBeGreaterThan(0);
      expect(["screenshot", "iframe", "link"]).toContain(n.mode);
    }
    // Log what the live model actually produced, for eyeballing.
    console.log(
      `[live] intent=${meta?.intent} downgraded=${meta?.downgraded} tiles=${ns.length}:`,
      ns.map((n) => `${n.hostname} — ${n.title}`),
    );
  }, 120_000);

  it("explore: 'sites like nytimes.com' produces a cluster of related sites", async () => {
    const events = await collect(
      "Find 5 reputable news sites similar to nytimes.com.",
    );
    expect(events.filter((e) => e.kind === "error")).toHaveLength(0);
    expect(events.at(-1)?.kind).toBe("done");
    const ns = nodes(events);
    expect(ns.length).toBeGreaterThanOrEqual(3);
    console.log(
      `[live] explore tiles=${ns.length}:`,
      ns.map((n) => n.hostname),
    );
  }, 120_000);
});
