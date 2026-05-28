// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@/lib/agent/types";

vi.mock("@/lib/agent/run", () => ({
  runAgent: vi.fn(),
}));

const { runAgent } = await import("@/lib/agent/run");
const { POST } = await import("./route");

function makeReq(body: unknown) {
  return new NextRequest("http://localhost/api/agent/run", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

async function readBody(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

describe("POST /api/agent/run", () => {
  beforeEach(() => {
    vi.mocked(runAgent).mockReset();
  });

  it("returns 400 when required fields are missing", async () => {
    const res = await POST(makeReq({ prompt: "x" }));
    expect(res.status).toBe(400);
  });

  it("streams SSE frames produced by runAgent", async () => {
    const events: AgentEvent[] = [
      {
        kind: "node",
        nodeId: "a",
        parentId: "p",
        title: "T1",
        url: "https://x.com",
        summary: "S1",
        source: "search",
      },
      {
        kind: "node",
        nodeId: "b",
        parentId: "p",
        title: "T2",
        url: "https://y.com",
        summary: "S2",
        source: "fetch",
      },
      { kind: "done", runId: "r1" },
    ];
    vi.mocked(runAgent).mockImplementation(async function* () {
      for (const e of events) yield e;
    });

    const res = await POST(
      makeReq({
        prompt: "hello",
        parentNodeId: "p",
        providerId: "openai",
        apiKey: "k",
      }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const text = await readBody(res);
    expect(text).toContain('"kind":"node"');
    expect(text).toContain('"nodeId":"a"');
    expect(text).toContain('"nodeId":"b"');
    expect(text).toContain('"kind":"done"');
    // SSE frame format
    expect(text.split("\n\n").filter((f) => f.startsWith("data:")).length).toBe(
      3,
    );
  });

  it("emits error frame when runAgent throws", async () => {
    vi.mocked(runAgent).mockImplementation(() => ({
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<AgentEvent>> {
            return Promise.reject(new Error("boom"));
          },
        };
      },
    }));
    const res = await POST(
      makeReq({
        prompt: "hello",
        parentNodeId: "p",
        providerId: "openai",
        apiKey: "k",
      }),
    );
    const text = await readBody(res);
    expect(text).toContain('"kind":"error"');
    expect(text).toContain("boom");
  });
});
