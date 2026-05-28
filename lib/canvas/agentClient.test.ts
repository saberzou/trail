import { describe, expect, it, vi } from "vitest";
import {
  clearAbortController,
  getAbortController,
  setAbortController,
  streamAgentRun,
} from "./agentClient";

describe("streamAgentRun", () => {
  it("parses SSE frames into events", async () => {
    const body = new ReadableStream({
      start(c) {
        const enc = new TextEncoder();
        c.enqueue(
          enc.encode(
            'data: {"kind":"node","nodeId":"a","parentId":"p","title":"T","url":"https://x.com","summary":"S","source":"search"}\n\n',
          ),
        );
        c.enqueue(enc.encode('data: {"kind":"done","runId":"r"}\n\n'));
        c.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(body, {
        headers: { "content-type": "text/event-stream" },
      }),
    );
    const events: unknown[] = [];
    await streamAgentRun(
      { prompt: "x", parentNodeId: "p", providerId: "openai", apiKey: "k" },
      (e) => events.push(e),
      new AbortController().signal,
      fetchMock as never,
    );
    expect(events).toHaveLength(2);
    expect((events[0] as { kind: string }).kind).toBe("node");
    expect((events[1] as { kind: string }).kind).toBe("done");
  });

  it("throws on non-ok response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("bad", { status: 400 }));
    await expect(
      streamAgentRun(
        { prompt: "x", parentNodeId: "p", providerId: "openai", apiKey: "k" },
        () => {},
        new AbortController().signal,
        fetchMock as never,
      ),
    ).rejects.toThrow(/agent 400/);
  });

  it("handles split SSE frames across chunks", async () => {
    const enc = new TextEncoder();
    const body = new ReadableStream({
      start(c) {
        c.enqueue(enc.encode('data: {"kind":"done"'));
        c.enqueue(enc.encode(',"runId":"r"}\n\n'));
        c.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body));
    const events: unknown[] = [];
    await streamAgentRun(
      { prompt: "x", parentNodeId: "p", providerId: "openai", apiKey: "k" },
      (e) => events.push(e),
      new AbortController().signal,
      fetchMock as never,
    );
    expect(events).toHaveLength(1);
  });
});

describe("abort controller registry", () => {
  it("stores, retrieves, and clears controllers by runId", () => {
    const c = new AbortController();
    setAbortController("run-1", c);
    expect(getAbortController("run-1")).toBe(c);
    clearAbortController("run-1");
    expect(getAbortController("run-1")).toBeUndefined();
  });
});
