// @vitest-environment node
import type { TLShapeId } from "tldraw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEvent, SessionRequest } from "@/lib/agent/session";
import {
  _getLayoutStateCount,
  _resetLayoutStates,
  placeTileInLine,
  placeTileInRadial,
  runSessionTurn,
  streamSession,
} from "./agentClient";

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

/** Build a Response whose body streams the given SSE events. */
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
  messages: [{ id: "m1", role: "user", text: "hi", createdAt: 1 }],
  canvasContext: [],
  providerId: "openai",
  apiKey: "sk-test",
};

describe("streamSession", () => {
  it("parses sequential SSE frames in order", async () => {
    const fetchMock = vi.fn(async () =>
      sseResponse([
        { kind: "assistant_text", text: "one" },
        { kind: "assistant_text", text: "two" },
        { kind: "done", runId: "r1" },
      ]),
    );
    const received: SessionEvent[] = [];
    await streamSession(
      baseReq,
      (e) => received.push(e),
      new AbortController().signal,
      fetchMock as unknown as typeof fetch,
    );
    expect(received).toEqual([
      { kind: "assistant_text", text: "one" },
      { kind: "assistant_text", text: "two" },
      { kind: "done", runId: "r1" },
    ]);
  });

  it("throws when the server returns a non-2xx", async () => {
    const fetchMock = vi.fn(async () => new Response("bad", { status: 500 }));
    await expect(
      streamSession(
        baseReq,
        () => {},
        new AbortController().signal,
        fetchMock as unknown as typeof fetch,
      ),
    ).rejects.toThrow(/HTTP 500/);
  });
});

describe("placeTileInLine", () => {
  it("returns positions that step horizontally with constant y", () => {
    const state = {
      intent: "task" as const,
      anchorX: 100,
      anchorY: 200,
      cursor: 0,
    };
    const a = placeTileInLine(state, 0);
    const b = placeTileInLine(state, 1);
    const c = placeTileInLine(state, 2);
    // y is constant: anchorY - TILE_H/2 = 200 - 110 = 90.
    expect(a.y).toBe(90);
    expect(b.y).toBe(90);
    expect(c.y).toBe(90);
    // x steps 360 (TILE_W=320 + 40 gap) starting at anchorX - TILE_W/2.
    expect(a.x).toBe(100 - 160);
    expect(b.x - a.x).toBe(360);
    expect(c.x - b.x).toBe(360);
  });
});

describe("placeTileInRadial", () => {
  it("six tiles land on a circle of radius 360 around the anchor with even spacing", () => {
    const state = {
      intent: "explore" as const,
      anchorX: 100,
      anchorY: 200,
      cursor: 0,
      expectedTotal: 6,
    };
    const positions = Array.from({ length: 6 }, (_, i) =>
      placeTileInRadial(state, i),
    );
    // Each tile's center should sit on the circle of radius 360 around
    // the anchor. The placement function returns the top-left of the
    // 320×220 tile, so we add TILE_W/2 and TILE_H/2 to get the center.
    for (const p of positions) {
      const cx = p.x + 160;
      const cy = p.y + 110;
      const dist = Math.hypot(cx - state.anchorX, cy - state.anchorY);
      expect(dist).toBeCloseTo(360, 5);
    }
    // First tile sits at angle 0 (directly right of the anchor).
    const first = positions[0];
    expect(first.x + 160).toBeCloseTo(state.anchorX + 360, 5);
    expect(first.y + 110).toBeCloseTo(state.anchorY, 5);
    // Angular spacing of 6 tiles is 2π/6 = π/3 (60°).
    const a1 = Math.atan2(
      positions[1].y + 110 - state.anchorY,
      positions[1].x + 160 - state.anchorX,
    );
    expect(a1).toBeCloseTo(Math.PI / 3, 5);
  });

  it("falls back to π/3 spacing when expectedTotal is not set", () => {
    const state = {
      intent: "explore" as const,
      anchorX: 0,
      anchorY: 0,
      cursor: 0,
    };
    const p1 = placeTileInRadial(state, 1);
    const angle = Math.atan2(p1.y + 110, p1.x + 160);
    expect(angle).toBeCloseTo(Math.PI / 3, 5);
  });
});

describe("runSessionTurn", () => {
  beforeEach(() => _resetLayoutStates());
  afterEach(() => _resetLayoutStates());

  it("explore intent: creates radial tiles + skips arrows when no anchor shape", async () => {
    const editor = makeEditor({ x: 0, y: 0 });
    const events: SessionEvent[] = [
      { kind: "assistant_text", text: "thinking..." },
      {
        kind: "flow_meta",
        intent: "explore",
        title: "x",
        downgraded: false,
      },
      {
        kind: "node",
        nodeId: "n1",
        title: "First",
        url: "https://a",
        hostname: "a",
        mode: "screenshot",
      },
      {
        kind: "node",
        nodeId: "n2",
        title: "Second",
        url: "https://b",
        hostname: "b",
        mode: "screenshot",
        summary: "do it",
      },
      { kind: "done", runId: "r" },
    ];
    const fetchMock = vi.fn(async () => sseResponse(events));
    const text = vi.fn();
    const done = vi.fn();
    const error = vi.fn();

    await runSessionTurn(
      editor as unknown as Parameters<typeof runSessionTurn>[0],
      baseReq,
      new AbortController().signal,
      {
        onAssistantText: text,
        onDone: done,
        onError: error,
        runId: "run-X",
        fetchImpl: fetchMock as unknown as typeof fetch,
      },
    );

    expect(text).toHaveBeenCalledWith("thinking...");
    expect(editor.createShape).toHaveBeenCalledTimes(2);
    const shapes = editor.createShape.mock.calls.map((c) => c[0]);
    expect(shapes[0].props.url).toBe("https://a");
    expect(shapes[1].props.url).toBe("https://b");
    // No anchor shape was supplied → no arrows.
    expect(editor.createBindings).not.toHaveBeenCalled();
    expect(done).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
  });

  it("task intent: tiles arrange horizontally and arrows chain consecutive tiles", async () => {
    const editor = makeEditor({ x: 0, y: 0 });
    const events: SessionEvent[] = [
      {
        kind: "flow_meta",
        intent: "task",
        title: "us visa",
        downgraded: false,
      },
      {
        kind: "node",
        nodeId: "n1",
        title: "Step 1",
        url: "https://a",
        hostname: "a",
        mode: "screenshot",
      },
      {
        kind: "node",
        nodeId: "n2",
        title: "Step 2",
        url: "https://b",
        hostname: "b",
        mode: "screenshot",
      },
      {
        kind: "node",
        nodeId: "n3",
        title: "Step 3",
        url: "https://c",
        hostname: "c",
        mode: "screenshot",
      },
      { kind: "done", runId: "r" },
    ];
    const fetchMock = vi.fn(async () => sseResponse(events));
    await runSessionTurn(
      editor as unknown as Parameters<typeof runSessionTurn>[0],
      baseReq,
      new AbortController().signal,
      {
        runId: "run-task",
        fetchImpl: fetchMock as unknown as typeof fetch,
      },
    );

    // Three webpage tiles, then two arrow tiles wiring step1→step2 and
    // step2→step3.
    const shapeCalls = editor.createShape.mock.calls.map((c) => c[0]);
    const tiles = shapeCalls.filter((s) => s.type === "webpage");
    const arrows = shapeCalls.filter((s) => s.type === "arrow");
    expect(tiles).toHaveLength(3);
    expect(arrows).toHaveLength(2);
    // Tiles step horizontally; y is identical.
    expect(tiles[1].x - tiles[0].x).toBe(360);
    expect(tiles[2].x - tiles[1].x).toBe(360);
    expect(tiles[0].y).toBe(tiles[1].y);
    expect(tiles[1].y).toBe(tiles[2].y);
    // Each arrow gets a pair of bindings (start + end).
    expect(editor.createBindings).toHaveBeenCalledTimes(2);
    for (const call of editor.createBindings.mock.calls) {
      const partials = call[0];
      expect(partials).toHaveLength(2);
      expect(partials[0].props.terminal).toBe("start");
      expect(partials[1].props.terminal).toBe("end");
      expect(partials[0].type).toBe("arrow");
    }
  });

  it("explore with anchorShapeId: spoke arrows fan out from the anchor to each tile", async () => {
    const editor = makeEditor({ x: 0, y: 0 });
    const events: SessionEvent[] = [
      {
        kind: "flow_meta",
        intent: "explore",
        title: "related",
        downgraded: false,
      },
      {
        kind: "node",
        nodeId: "n1",
        title: "a",
        url: "https://a",
        hostname: "a",
        mode: "screenshot",
      },
      {
        kind: "node",
        nodeId: "n2",
        title: "b",
        url: "https://b",
        hostname: "b",
        mode: "screenshot",
      },
      { kind: "done", runId: "r" },
    ];
    const fetchMock = vi.fn(async () => sseResponse(events));
    // Pretend the anchor tile is a previously-created shape.
    const anchorShapeId = "shape:anchor" as TLShapeId;
    await runSessionTurn(
      editor as unknown as Parameters<typeof runSessionTurn>[0],
      baseReq,
      new AbortController().signal,
      {
        runId: "run-explore",
        anchorPos: { x: 500, y: 500 },
        anchorShapeId,
        fetchImpl: fetchMock as unknown as typeof fetch,
      },
    );
    const shapeCalls = editor.createShape.mock.calls.map((c) => c[0]);
    const tiles = shapeCalls.filter((s) => s.type === "webpage");
    const arrows = shapeCalls.filter((s) => s.type === "arrow");
    expect(tiles).toHaveLength(2);
    // One spoke per tile.
    expect(arrows).toHaveLength(2);
    expect(editor.createBindings).toHaveBeenCalledTimes(2);
    // Each binding pair's start terminal is the anchor shape.
    for (const call of editor.createBindings.mock.calls) {
      const partials = call[0];
      expect(partials[0].toId).toBe(anchorShapeId);
    }
  });

  it("anchorPos overrides the viewport center for layout", async () => {
    // Viewport center is wildly different from the anchorPos we pass in.
    // After the run, the radial centers should all sit on a 360-radius
    // circle around the anchorPos, not the viewport.
    const editor = makeEditor({ x: -9999, y: -9999 });
    const events: SessionEvent[] = [
      {
        kind: "flow_meta",
        intent: "explore",
        title: "x",
        downgraded: false,
      },
      {
        kind: "node",
        nodeId: "n1",
        title: "a",
        url: "https://a",
        hostname: "a",
        mode: "screenshot",
      },
    ];
    const fetchMock = vi.fn(async () => sseResponse(events));
    await runSessionTurn(
      editor as unknown as Parameters<typeof runSessionTurn>[0],
      baseReq,
      new AbortController().signal,
      {
        runId: "anchor-override",
        anchorPos: { x: 100, y: 200 },
        fetchImpl: fetchMock as unknown as typeof fetch,
      },
    );
    const tile = editor.createShape.mock.calls.find(
      (c) => c[0].type === "webpage",
    )?.[0];
    expect(tile).toBeDefined();
    // First tile center should be ~360 to the right of anchorPos (angle 0).
    expect(tile.x + 160).toBeCloseTo(100 + 360, 1);
    expect(tile.y + 110).toBeCloseTo(200, 1);
  });

  it("forwards error events to onError", async () => {
    const editor = makeEditor();
    const fetchMock = vi.fn(async () =>
      sseResponse([{ kind: "error", message: "nope" }]),
    );
    const error = vi.fn();
    await runSessionTurn(
      editor as unknown as Parameters<typeof runSessionTurn>[0],
      baseReq,
      new AbortController().signal,
      { onError: error, fetchImpl: fetchMock as unknown as typeof fetch },
    );
    expect(error).toHaveBeenCalledWith("nope");
  });

  it("HTTP failure surfaces through onError", async () => {
    const editor = makeEditor();
    const fetchMock = vi.fn(async () => new Response("bad", { status: 500 }));
    const error = vi.fn();
    await runSessionTurn(
      editor as unknown as Parameters<typeof runSessionTurn>[0],
      baseReq,
      new AbortController().signal,
      { onError: error, fetchImpl: fetchMock as unknown as typeof fetch },
    );
    expect(error).toHaveBeenCalled();
    expect(error.mock.calls[0][0]).toMatch(/HTTP 500/);
  });

  it("prunes the layout-state map when a run completes", async () => {
    const editor = makeEditor({ x: 0, y: 0 });
    const events: SessionEvent[] = [
      {
        kind: "flow_meta",
        intent: "explore",
        title: "x",
        downgraded: false,
      },
      {
        kind: "node",
        nodeId: "n1",
        title: "a",
        url: "https://a",
        hostname: "a",
        mode: "screenshot",
      },
      {
        kind: "node",
        nodeId: "n2",
        title: "b",
        url: "https://b",
        hostname: "b",
        mode: "screenshot",
      },
      { kind: "done", runId: "r" },
    ];
    const fetchMock = vi.fn(async () => sseResponse(events));
    await runSessionTurn(
      editor as unknown as Parameters<typeof runSessionTurn>[0],
      baseReq,
      new AbortController().signal,
      {
        runId: "leak-check",
        fetchImpl: fetchMock as unknown as typeof fetch,
      },
    );
    // No entries should be left behind. If this fails the map grows
    // linearly with session count.
    expect(_getLayoutStateCount()).toBe(0);
  });

  it("prunes layout-state map even when the stream errors", async () => {
    const editor = makeEditor();
    const fetchMock = vi.fn(async () => new Response("bad", { status: 500 }));
    await runSessionTurn(
      editor as unknown as Parameters<typeof runSessionTurn>[0],
      baseReq,
      new AbortController().signal,
      {
        runId: "leak-error",
        onError: () => {},
        fetchImpl: fetchMock as unknown as typeof fetch,
      },
    );
    expect(_getLayoutStateCount()).toBe(0);
  });

  it("link-mode tiles are placed at the wider 360×200 default", async () => {
    const editor = makeEditor({ x: 0, y: 0 });
    const events: SessionEvent[] = [
      {
        kind: "flow_meta",
        intent: "explore",
        title: "x",
        downgraded: false,
      },
      {
        kind: "node",
        nodeId: "n1",
        title: "Linked",
        url: "https://a",
        hostname: "a",
        mode: "link",
      },
      {
        kind: "node",
        nodeId: "n2",
        title: "Shot",
        url: "https://b",
        hostname: "b",
        mode: "screenshot",
      },
    ];
    const fetchMock = vi.fn(async () => sseResponse(events));
    await runSessionTurn(
      editor as unknown as Parameters<typeof runSessionTurn>[0],
      baseReq,
      new AbortController().signal,
      {
        runId: "link-dims",
        fetchImpl: fetchMock as unknown as typeof fetch,
      },
    );
    const shapes = editor.createShape.mock.calls
      .map((c) => c[0])
      .filter((s) => s.type === "webpage");
    expect(shapes[0].props.mode).toBe("link");
    expect(shapes[0].props.w).toBe(360);
    expect(shapes[0].props.h).toBe(200);
    expect(shapes[1].props.mode).toBe("screenshot");
    expect(shapes[1].props.w).toBe(320);
    expect(shapes[1].props.h).toBe(220);
  });

  it("fires onNode once per successfully placed tile", async () => {
    const editor = makeEditor({ x: 0, y: 0 });
    const events: SessionEvent[] = [
      {
        kind: "flow_meta",
        intent: "explore",
        title: "x",
        downgraded: false,
      },
      {
        kind: "node",
        nodeId: "n1",
        title: "a",
        url: "https://a",
        hostname: "a",
        mode: "screenshot",
      },
      {
        kind: "node",
        nodeId: "n2",
        title: "b",
        url: "https://b",
        hostname: "b",
        mode: "screenshot",
      },
      {
        kind: "node",
        nodeId: "n3",
        title: "c",
        url: "https://c",
        hostname: "c",
        mode: "link",
      },
      { kind: "done", runId: "r" },
    ];
    const fetchMock = vi.fn(async () => sseResponse(events));
    const node = vi.fn();
    await runSessionTurn(
      editor as unknown as Parameters<typeof runSessionTurn>[0],
      baseReq,
      new AbortController().signal,
      {
        onNode: node,
        runId: "node-counter",
        fetchImpl: fetchMock as unknown as typeof fetch,
      },
    );
    expect(node).toHaveBeenCalledTimes(3);
  });

  it("surfaces createShape failures via onError but keeps processing the rest of the stream", async () => {
    const editor = {
      createShape: vi.fn((shape) => {
        // Fail on the FIRST webpage shape only; subsequent shapes (and
        // any arrows) succeed.
        if (shape.type === "webpage" && shape.props.url === "https://a") {
          throw new Error("boom");
        }
      }),
      createBindings: vi.fn(),
      getViewportPageBounds: vi.fn(() => ({ center: { x: 0, y: 0 } })),
    };
    const events: SessionEvent[] = [
      {
        kind: "flow_meta",
        intent: "explore",
        title: "x",
        downgraded: false,
      },
      {
        kind: "node",
        nodeId: "n1",
        title: "a",
        url: "https://a",
        hostname: "a",
        mode: "screenshot",
      },
      {
        kind: "node",
        nodeId: "n2",
        title: "b",
        url: "https://b",
        hostname: "b",
        mode: "screenshot",
      },
      { kind: "done", runId: "r" },
    ];
    const fetchMock = vi.fn(async () => sseResponse(events));
    const error = vi.fn();
    const node = vi.fn();
    await runSessionTurn(
      editor as unknown as Parameters<typeof runSessionTurn>[0],
      baseReq,
      new AbortController().signal,
      {
        onError: error,
        onNode: node,
        runId: "shape-error",
        fetchImpl: fetchMock as unknown as typeof fetch,
      },
    );
    // The first tile's failure was surfaced to the caller…
    expect(error).toHaveBeenCalledWith(expect.stringContaining("https://a"));
    // …but the second tile still made it.
    const webpageCalls = editor.createShape.mock.calls
      .map((c) => c[0])
      .filter((s) => s.type === "webpage");
    expect(webpageCalls).toHaveLength(2);
    expect(node).toHaveBeenCalledTimes(1);
  });
});
