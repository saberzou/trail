import { beforeEach, describe, expect, it, vi } from "vitest";
import { testProvider } from "./test";

beforeEach(() => {
  vi.restoreAllMocks();
});

const mockFetch = (status: number, body: unknown = {}) =>
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })),
  );

describe("testProvider", () => {
  it("openai ok on 200", async () => {
    mockFetch(200, { data: [] });
    expect(
      await testProvider("openai", { kind: "api-key", apiKey: "sk-x" }),
    ).toEqual({ ok: true });
  });

  it("anthropic fails on 401", async () => {
    mockFetch(401, { error: "invalid api key" });
    const r = await testProvider("anthropic", {
      kind: "api-key",
      apiKey: "x",
    });
    expect(r.ok).toBe(false);
  });

  it("empty key short-circuits to error", async () => {
    const r = await testProvider("tavily", { kind: "api-key", apiKey: "" });
    expect(r.ok).toBe(false);
  });
});
