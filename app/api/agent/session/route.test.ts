// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// Controller the mocked runSession reads at call time so individual tests
// can switch between "stream successfully" and "throw synchronously" without
// having to re-import the route module.
const runSessionBehavior: {
  mode: "ok" | "throws-with-secret";
} = { mode: "ok" };

vi.mock("@/lib/agent/session", async () => {
  return {
    // Mirrors the real classifyError's contract (generic message, no leaks).
    // We don't need full parity here — the route only forwards the result.
    classifyError: (err: unknown) => {
      if (err instanceof Error && /aborted/i.test(err.message)) {
        return { message: "Stopped.", code: "aborted" };
      }
      return { message: "Agent run failed." };
    },
    runSession: vi.fn((..._args: unknown[]) => {
      if (runSessionBehavior.mode === "throws-with-secret") {
        // Synchronous throw — landed in the route's outer try/catch
        // before any SSE frames were enqueued. The raw message contains
        // a secret-looking string we want to confirm does NOT leak.
        throw new Error(
          "PROVIDER_SECRET_LEAK sk-real-key-12345 https://api.openai.com/v1",
        );
      }
      // Default: a tiny in-process iterable.
      return (async function* () {
        yield { kind: "assistant_text", text: "hello" };
        yield { kind: "done", runId: "run-1" };
      })();
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

const validBody = {
  providerId: "openai",
  apiKey: "sk-test",
  messages: [{ id: "m1", role: "user", text: "hi", createdAt: 1 }],
  canvasContext: [],
};

describe("POST /api/agent/session", () => {
  beforeEach(() => {
    runSessionBehavior.mode = "ok";
  });

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
      makeRequest(validBody) as unknown as Parameters<typeof POST>[0],
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

  it("does NOT leak raw thrown messages from runSession setup", async () => {
    // Simulate resolveModel / AI SDK throwing synchronously inside
    // runSession — the route's outer catch must surface a generic
    // message, not the raw provider/SDK string.
    runSessionBehavior.mode = "throws-with-secret";
    // Silence the deliberate console.error the route emits on this path.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const res = await POST(
        makeRequest(validBody) as unknown as Parameters<typeof POST>[0],
      );
      expect(res.status).toBe(200);
      const frames = await readSseFrames(res);
      expect(frames).toHaveLength(1);
      const payload = JSON.parse(frames[0]);
      expect(payload.kind).toBe("error");
      // The streamed message must NOT contain any of the raw fields.
      expect(payload.message).not.toContain("PROVIDER_SECRET_LEAK");
      expect(payload.message).not.toContain("sk-real-key-12345");
      expect(payload.message).not.toContain("api.openai.com");
      // …but it should still be a usable string.
      expect(typeof payload.message).toBe("string");
      expect(payload.message.length).toBeGreaterThan(0);
    } finally {
      spy.mockRestore();
    }
  });
});
