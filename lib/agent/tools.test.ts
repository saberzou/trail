// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { makeFetchUrlTool, makeWebSearchTool } from "./tools";

describe("web_search tool (brave)", () => {
  it("returns top results", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        web: {
          results: [{ title: "T", url: "https://x.com", description: "D" }],
        },
      }),
    });
    const t = makeWebSearchTool({
      provider: "brave",
      apiKey: "k",
      fetch: fetchMock as never,
    });
    const result = (await t.execute!(
      { query: "hello" },
      { toolCallId: "x", messages: [] },
    )) as {
      results: Array<{ title: string; url: string; description: string }>;
    };
    expect(result.results[0]).toMatchObject({
      title: "T",
      url: "https://x.com",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0];
    expect(
      (init as { headers: Record<string, string> }).headers[
        "X-Subscription-Token"
      ],
    ).toBe("k");
  });

  it("throws on non-ok brave response", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    const t = makeWebSearchTool({
      provider: "brave",
      apiKey: "k",
      fetch: fetchMock as never,
    });
    await expect(
      t.execute!({ query: "x" }, { toolCallId: "x", messages: [] }),
    ).rejects.toThrow(/brave 503/);
  });
});

describe("web_search tool (tavily)", () => {
  it("posts to tavily and normalizes results", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ title: "T", url: "https://x.com", content: "C" }],
      }),
    });
    const t = makeWebSearchTool({
      provider: "tavily",
      apiKey: "k",
      fetch: fetchMock as never,
    });
    const result = (await t.execute!(
      { query: "hi" },
      { toolCallId: "x", messages: [] },
    )) as {
      results: Array<{ title: string; url: string; description: string }>;
    };
    expect(result.results[0]).toMatchObject({
      title: "T",
      url: "https://x.com",
      description: "C",
    });
    const [, init] = fetchMock.mock.calls[0];
    expect((init as { method: string }).method).toBe("POST");
    expect((init as { body: string }).body).toContain('"api_key":"k"');
  });
});

describe("fetch_url tool", () => {
  it("extracts readable content via readability", async () => {
    const html =
      "<html><head><title>X</title></head><body><article><h1>X</h1><p>Hello world this is a longer paragraph for readability extraction so it has enough content to count.</p><p>Another paragraph with more meaningful content for the extractor to keep.</p></article></body></html>";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => html,
      headers: new Headers({ "content-type": "text/html" }),
    });
    const t = makeFetchUrlTool({ fetch: fetchMock as never });
    const result = (await t.execute!(
      { url: "https://x.com" },
      { toolCallId: "x", messages: [] },
    )) as { title: string; text: string };
    expect(result.title).toBeTruthy();
    expect(result.text).toContain("Hello world");
  });

  it("throws on non-ok fetch", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    const t = makeFetchUrlTool({ fetch: fetchMock as never });
    await expect(
      t.execute!({ url: "https://x.com" }, { toolCallId: "x", messages: [] }),
    ).rejects.toThrow(/fetch 404/);
  });

  it("falls back to cheerio when readability returns nothing", async () => {
    const html =
      "<html><head><title>Plain</title></head><body><div>Just some text here.</div></body></html>";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => html,
      headers: new Headers({ "content-type": "text/html" }),
    });
    const t = makeFetchUrlTool({ fetch: fetchMock as never });
    const result = (await t.execute!(
      { url: "https://x.com" },
      { toolCallId: "x", messages: [] },
    )) as { title: string; text: string };
    expect(result.title).toBe("Plain");
    expect(result.text).toContain("Just some text");
  });
});
