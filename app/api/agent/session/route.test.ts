// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/agent/session", async () => {
  return {
    runSession: vi.fn(async function* () {
      yield { kind: "assistant_text", text: "hello" };
      yield { kind: "done", runId: "run-1" };
    }),
  };
});

import { POST } from "./route";

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/agent/session", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

async function readSseFrames(res: Response): Promise<string[]> {
  const text = await res.text();
  // SSE frames are separated by a blank line. We parse `data:` lines.
  return text
    .split("\n\n")
    .map((f) => f.trim())
    .filter((f) => f.startsWith("data:"))
    .map((f) => f.slice("data:".length).trim());
}

describe("POST /api/agent/session", () => {
  it("returns 400 when required fields are missing", async () => {
    const res = await POST(
      makeRequest({ providerId: "openai" }) as unknown as Parameters<
        typeof POST
      >[0],
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for invalid JSON body", async () => {
    const req = new Request("http://localhost/api/agent/session", {
      method: "POST",
      body: "not-json",
      headers: { "content-type": "application/json" },
    });
    const res = await POST(req as unknown as Parameters<typeof POST>[0]);
    expect(res.status).toBe(400);
  });

  it("streams SessionEvents as SSE data frames", async () => {
    const res = await POST(
      makeRequest({
        providerId: "openai",
        apiKey: "sk-test",
        messages: [{ id: "m1", role: "user", text: "hi", createdAt: 1 }],
        canvasContext: [],
      }) as unknown as Parameters<typeof POST>[0],
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const frames = await readSseFrames(res);
    expect(frames).toHaveLength(2);
    expect(JSON.parse(frames[0])).toEqual({
      kind: "assistant_text",
      text: "hello",
    });
    expect(JSON.parse(frames[1])).toEqual({ kind: "done", runId: "run-1" });
  });
});
