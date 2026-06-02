// @vitest-environment node
//
// Resilience / "unhappy path" scenarios — the canvas-side complement to the
// server tests in lib/agent/session.test.ts. session.test.ts proves the agent
// *emits* the right events when grounding fails, a source can't be fetched, or
// the user stops; these prove the canvas *renders* the right thing in response:
//
//   - a task that fails quote-grounding is force-downgraded to an explore
//     cluster (radial, not a task line), and the downgrade is reported;
//   - a turn where no source could be fetched still produces a usable cluster
//     of prior-knowledge link tiles;
//   - stopping mid-run surfaces a friendly "Stopped." and leaves no half-built
//     task chain behind.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEvent, SessionRequest } from "@/lib/agent/session";
import {
  _getLayoutStateCount,
  _resetLayoutStates,
  runSessionTurn,
} from "./agentClient";

const TILE_W = 320;
const TILE_H = 220;
const RADIAL_RADIUS = 360;

type MockEditor = {
  createShape: ReturnType<typeof vi.fn>;
  createBindings: ReturnType<typeof vi.fn>;
  getViewportPageBounds: ReturnType<typeof vi.fn>;
};

function makeEditor(center = { x: 0, y: 0 }): MockEditor {
  return {
    createShape: vi.fn(),
    createBindings: vi.fn(),
    getViewportPageBounds: vi.fn(() => ({ center })),
  };
}

function sseResponse(events: SessionEvent[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const e of events) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

const baseReq: SessionRequest = {
  messages: [
    { id: "m1", role: "user", text: "incorporate an LLC", createdAt: 1 },
  ],
  canvasContext: [],
  providerId: "openai",
  apiKey: "sk-test",
};

/** Distance from the anchor to a tile's center. */
function centerDist(
  tile: { x: number; y: number },
  anchor: { x: number; y: number },
): number {
  return Math.hypot(
    tile.x + TILE_W / 2 - anchor.x,
    tile.y + TILE_H / 2 - anchor.y,
  );
}

describe("scenario: task fails grounding → force-downgraded to an explore cluster", () => {
  beforeEach(() => _resetLayoutStates());
  afterEach(() => _resetLayoutStates());

  // After 3 failed quote validations the server drops quotes and re-emits the
  // plan as intent:"explore", downgraded:true (see session.test.ts). The
  // canvas must then lay the tiles out radially — NOT as a task line — and the
  // client must be told the turn was downgraded so it can note it.
  const downgraded: SessionEvent[] = [
    {
      kind: "flow_meta",
      intent: "explore",
      title: "How to incorporate an LLC",
      downgraded: true,
    },
    {
      kind: "node",
      nodeId: "d1",
      title: "Choose a state to form in",
      url: "https://www.irs.gov/businesses/small-businesses-self-employed/limited-liability-company-llc",
      hostname: "irs.gov",
      mode: "link",
    },
    {
      kind: "node",
      nodeId: "d2",
      title: "File articles of organization",
      url: "https://www.sba.gov/business-guide/launch-your-business/register-your-business",
      hostname: "sba.gov",
      mode: "link",
    },
    {
      kind: "node",
      nodeId: "d3",
      title: "Get an EIN",
      url: "https://www.irs.gov/businesses/small-businesses-self-employed/apply-for-an-employer-identification-number-ein-online",
      hostname: "irs.gov",
      mode: "link",
    },
    { kind: "done", runId: "downgrade-run" },
  ];

  it("renders a radial cluster (not a line) and reports the downgrade", async () => {
    const editor = makeEditor({ x: 0, y: 0 });
    const fetchMock = vi.fn(async () => sseResponse(downgraded));
    const flowMeta = vi.fn();
    const anchor = { x: 0, y: 0 };

    await runSessionTurn(
      editor as unknown as Parameters<typeof runSessionTurn>[0],
      baseReq,
      new AbortController().signal,
      {
        runId: "downgrade",
        anchorPos: anchor,
        onFlowMeta: flowMeta,
        fetchImpl: fetchMock as unknown as typeof fetch,
      },
    );

    // The client is told this was a downgrade — the hook ChatPanel needs to
    // surface a one-line note.
    expect(flowMeta).toHaveBeenCalledWith("explore", true);

    const shapes = editor.createShape.mock.calls.map((c) => c[0]);
    const tiles = shapes.filter((s) => s.type === "webpage");
    expect(tiles).toHaveLength(3);

    // Radial, not a line: all three centers sit on the cluster radius, and
    // their y-values are NOT all equal (which a horizontal task line would be).
    for (const t of tiles) {
      expect(centerDist(t, anchor)).toBeCloseTo(RADIAL_RADIUS, 5);
    }
    const ys = new Set(tiles.map((t) => t.y));
    expect(ys.size).toBeGreaterThan(1);

    // Explore intent without an anchor shape → no spoke arrows.
    expect(shapes.filter((s) => s.type === "arrow")).toHaveLength(0);
    expect(editor.createBindings).not.toHaveBeenCalled();
  });
});

describe("scenario: no source could be fetched → explore fallback from prior knowledge", () => {
  beforeEach(() => _resetLayoutStates());
  afterEach(() => _resetLayoutStates());

  // When fetch_url fails for every candidate, the agent still emits an explore
  // plan from prior knowledge with empty quotes; every tile ships as `link`
  // (nothing was fetched to screenshot). The user should still get a usable
  // cluster rather than an empty canvas + a dead-end chat reply.
  const fallback: SessionEvent[] = [
    {
      kind: "flow_meta",
      intent: "explore",
      title: "Espresso machine reviews",
      downgraded: false,
    },
    ...[
      "https://www.seriouseats.com/",
      "https://www.wirecutter.com/",
      "https://www.home-barista.com/",
    ].map(
      (url, i): SessionEvent => ({
        kind: "node",
        nodeId: `f${i}`,
        title: `Source ${i + 1}`,
        url,
        hostname: new URL(url).hostname.replace(/^www\./, ""),
        mode: "link",
      }),
    ),
    { kind: "done", runId: "fallback-run" },
  ];

  it("still places a ring of link tiles", async () => {
    const editor = makeEditor({ x: 200, y: 200 });
    const fetchMock = vi.fn(async () => sseResponse(fallback));

    await runSessionTurn(
      editor as unknown as Parameters<typeof runSessionTurn>[0],
      baseReq,
      new AbortController().signal,
      { runId: "fallback", fetchImpl: fetchMock as unknown as typeof fetch },
    );

    const tiles = editor.createShape.mock.calls
      .map((c) => c[0])
      .filter((s) => s.type === "webpage");
    expect(tiles).toHaveLength(3);
    // Every fallback tile is a link card at the wider 360×200 default.
    for (const t of tiles) {
      expect(t.props.mode).toBe("link");
      expect(t.props.w).toBe(360);
      expect(t.props.h).toBe(200);
    }
  });
});

describe("scenario: user stops mid-run", () => {
  beforeEach(() => _resetLayoutStates());
  afterEach(() => _resetLayoutStates());

  it("surfaces a friendly 'Stopped.' and builds no tiles when aborted before the stream opens", async () => {
    const editor = makeEditor();
    const controller = new AbortController();
    controller.abort(); // user hit Stop before the request even resolved

    // A realistic fetch honors the abort signal by throwing.
    const fetchMock = vi.fn(
      async (_url: string, init?: { signal?: AbortSignal }) => {
        if (init?.signal?.aborted) {
          throw new DOMException("The operation was aborted.", "AbortError");
        }
        return sseResponse([{ kind: "done", runId: "x" }]);
      },
    );
    const onError = vi.fn();
    const onDone = vi.fn();

    await runSessionTurn(
      editor as unknown as Parameters<typeof runSessionTurn>[0],
      baseReq,
      controller.signal,
      {
        runId: "stopped",
        onError,
        onDone,
        fetchImpl: fetchMock as unknown as typeof fetch,
      },
    );

    expect(onError).toHaveBeenCalledWith("Stopped.");
    expect(editor.createShape).not.toHaveBeenCalled();
    // Even on the abort path, per-run layout state is pruned (no leak).
    expect(_getLayoutStateCount()).toBe(0);
  });
});
