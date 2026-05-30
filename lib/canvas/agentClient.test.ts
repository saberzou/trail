// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEvent, SessionRequest } from "@/lib/agent/session";
import {
  _resetColumnCursors,
  placeTileInColumn,
  runSessionTurn,
  streamSession,
} from "./agentClient";

type MockEditor = {
  createShape: ReturnType<typeof vi.fn>;
  getViewportPageBounds: ReturnType<typeof vi.fn>;
};

function makeEditor(center = { x: 0, y: 0 }): MockEditor {
  return {
    createShape: vi.fn(),
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

describe("placeTileInColumn", () => {
  beforeEach(() => _resetColumnCursors());
  afterEach(() => _resetColumnCursors());

  it("first tile sits at viewport center; subsequent tiles step 240px down", () => {
    const editor = makeEditor({ x: 100, y: 200 });
    const a = placeTileInColumn(
      editor as unknown as Parameters<typeof placeTileInColumn>[0],
      "run-1",
    );
    const b = placeTileInColumn(
      editor as unknown as Parameters<typeof placeTileInColumn>[0],
      "run-1",
    );
    const c = placeTileInColumn(
      editor as unknown as Parameters<typeof placeTileInColumn>[0],
      "run-1",
    );
    expect(b.y - a.y).toBe(240);
    expect(c.y - b.y).toBe(240);
    // Width 320 → x is center.x - 160.
    expect(a.x).toBe(100 - 160);
  });

  it("separate runs maintain separate cursors", () => {
    const editor = makeEditor({ x: 0, y: 0 });
    const a1 = placeTileInColumn(
      editor as unknown as Parameters<typeof placeTileInColumn>[0],
      "run-A",
    );
    const a2 = placeTileInColumn(
      editor as unknown as Parameters<typeof placeTileInColumn>[0],
      "run-A",
    );
    const b1 = placeTileInColumn(
      editor as unknown as Parameters<typeof placeTileInColumn>[0],
      "run-B",
    );
    expect(b1.y).toBe(a1.y);
    expect(a2.y).toBe(a1.y + 240);
  });
});

describe("runSessionTurn", () => {
  beforeEach(() => _resetColumnCursors());
  afterEach(() => _resetColumnCursors());

  it("creates one shape per node event and fires onDone", async () => {
    const editor = makeEditor({ x: 0, y: 0 });
    const events: SessionEvent[] = [
      { kind: "assistant_text", text: "thinking..." },
      {
        kind: "flow_meta",
        intent: "task",
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
    expect(shapes[1].y - shapes[0].y).toBe(240);
    expect(done).toHaveBeenCalledTimes(1);
    expect(error).not.toHaveBeenCalled();
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
});
