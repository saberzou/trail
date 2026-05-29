// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isBlockedIPv4,
  isBlockedIPv6,
  type LookupAllFn,
  makeFetchUrlTool,
  makeWebSearchTool,
} from "./tools";

// Helper to call the tool's execute() with the required AI SDK context.
async function runFetch(
  tool: ReturnType<typeof makeFetchUrlTool>,
  url: string,
) {
  return (await tool.execute!({ url }, { toolCallId: "x", messages: [] })) as {
    title: string;
    text: string;
  };
}

const publicLookup: LookupAllFn = async () => [
  { address: "93.184.216.34", family: 4 }, // example.com-ish public IP
];

function html(body: string, title = "Plain") {
  return `<html><head><title>${title}</title></head><body>${body}</body></html>`;
}

function mockResponse(init: {
  status?: number;
  body?: string | Uint8Array | ReadableStream<Uint8Array>;
  headers?: Record<string, string>;
}) {
  const status = init.status ?? 200;
  const headers = new Headers(init.headers ?? { "content-type": "text/html" });
  const ok = status >= 200 && status < 300;
  let stream: ReadableStream<Uint8Array> | null;
  if (init.body instanceof ReadableStream) {
    stream = init.body;
  } else if (init.body !== undefined) {
    const bytes =
      typeof init.body === "string"
        ? new TextEncoder().encode(init.body)
        : init.body;
    stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  } else {
    stream = null;
  }
  return {
    ok,
    status,
    headers,
    body: stream,
    async text() {
      if (!stream) return "";
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      const total = chunks.reduce((n, c) => n + c.byteLength, 0);
      const merged = new Uint8Array(total);
      let o = 0;
      for (const c of chunks) {
        merged.set(c, o);
        o += c.byteLength;
      }
      return new TextDecoder().decode(merged);
    },
  } as unknown as Response;
}

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

describe("CIDR guards", () => {
  it("blocks loopback / private / link-local IPv4", () => {
    expect(isBlockedIPv4("127.0.0.1")).toBe(true);
    expect(isBlockedIPv4("10.0.0.1")).toBe(true);
    expect(isBlockedIPv4("172.16.5.5")).toBe(true);
    expect(isBlockedIPv4("172.31.255.255")).toBe(true);
    expect(isBlockedIPv4("192.168.1.1")).toBe(true);
    expect(isBlockedIPv4("169.254.169.254")).toBe(true);
    expect(isBlockedIPv4("100.64.0.1")).toBe(true);
    expect(isBlockedIPv4("0.0.0.0")).toBe(true);
  });

  it("allows public IPv4", () => {
    expect(isBlockedIPv4("8.8.8.8")).toBe(false);
    expect(isBlockedIPv4("172.15.0.1")).toBe(false);
    expect(isBlockedIPv4("172.32.0.1")).toBe(false);
    expect(isBlockedIPv4("93.184.216.34")).toBe(false);
  });

  it("blocks loopback / ULA / link-local IPv6", () => {
    expect(isBlockedIPv6("::1")).toBe(true);
    expect(isBlockedIPv6("fc00::1")).toBe(true);
    expect(isBlockedIPv6("fd12:3456::1")).toBe(true);
    expect(isBlockedIPv6("fe80::1")).toBe(true);
  });

  it("blocks IPv4-mapped IPv6 when underlying v4 is blocked", () => {
    expect(isBlockedIPv6("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedIPv6("::ffff:10.0.0.1")).toBe(true);
  });

  it("allows public IPv6", () => {
    expect(isBlockedIPv6("2606:4700:4700::1111")).toBe(false);
  });
});

describe("fetch_url tool (hardened)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects non-http(s) protocols", async () => {
    const t = makeFetchUrlTool({
      fetch: vi.fn() as never,
      lookup: publicLookup,
    });
    await expect(runFetch(t, "file:///etc/passwd")).rejects.toThrow(/non-http/);
    await expect(runFetch(t, "ftp://example.com")).rejects.toThrow(/non-http/);
    // data: URIs aren't valid for zod's z.string().url() in all builds, but
    // we still expect the protocol guard if they reach our code.
    await expect(
      runFetch(t, "data:text/plain;base64,SGVsbG8="),
    ).rejects.toThrow();
  });

  it("rejects loopback IPv4 by literal hostname", async () => {
    const t = makeFetchUrlTool({
      fetch: vi.fn() as never,
      lookup: publicLookup,
    });
    await expect(runFetch(t, "http://127.0.0.1/admin")).rejects.toThrow(
      /private address/,
    );
  });

  it("rejects loopback IPv6 by literal hostname", async () => {
    const t = makeFetchUrlTool({
      fetch: vi.fn() as never,
      lookup: publicLookup,
    });
    await expect(runFetch(t, "http://[::1]/")).rejects.toThrow(
      /private address/,
    );
  });

  it("rejects private IPv4 resolved via DNS (10/172.16/192.168/169.254)", async () => {
    const fetchMock = vi.fn();
    for (const addr of [
      "10.0.0.5",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
    ]) {
      const lookup: LookupAllFn = async () => [{ address: addr, family: 4 }];
      const t = makeFetchUrlTool({ fetch: fetchMock as never, lookup });
      await expect(runFetch(t, "https://evil.example.com/")).rejects.toThrow(
        /private address/,
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects private IPv6 (fc00::, fe80::) resolved via DNS", async () => {
    const fetchMock = vi.fn();
    for (const addr of ["fc00::1", "fe80::1"]) {
      const lookup: LookupAllFn = async () => [{ address: addr, family: 6 }];
      const t = makeFetchUrlTool({ fetch: fetchMock as never, lookup });
      await expect(runFetch(t, "https://evil.example.com/")).rejects.toThrow(
        /private address/,
      );
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("succeeds for a valid public URL", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        mockResponse({ body: html("<p>Hello world.</p>", "Public") }),
      );
    const t = makeFetchUrlTool({
      fetch: fetchMock as never,
      lookup: publicLookup,
    });
    const result = await runFetch(t, "https://example.com/");
    expect(result.title).toBeTruthy();
    expect(result.text).toContain("Hello world");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("follows redirects up to 3 hops", async () => {
    const fetchMock = vi
      .fn()
      // hop 0 -> 1
      .mockResolvedValueOnce(
        mockResponse({
          status: 301,
          headers: { location: "https://example.com/two" },
        }),
      )
      // hop 1 -> 2
      .mockResolvedValueOnce(
        mockResponse({
          status: 302,
          headers: { location: "https://example.com/three" },
        }),
      )
      // hop 2 -> 3 (last allowed)
      .mockResolvedValueOnce(
        mockResponse({
          status: 302,
          headers: { location: "https://example.com/final" },
        }),
      )
      // final
      .mockResolvedValueOnce(
        mockResponse({ body: html("<p>Final body content.</p>", "Final") }),
      );
    const t = makeFetchUrlTool({
      fetch: fetchMock as never,
      lookup: publicLookup,
    });
    const result = await runFetch(t, "https://example.com/start");
    expect(result.text).toContain("Final body");
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("rejects when redirect chain exceeds the cap", async () => {
    const fetchMock = vi.fn().mockImplementation((u: string) => {
      return mockResponse({
        status: 302,
        headers: { location: `${u}/next` },
      });
    });
    const t = makeFetchUrlTool({
      fetch: fetchMock as never,
      lookup: publicLookup,
      maxRedirects: 3,
    });
    await expect(runFetch(t, "https://example.com/start")).rejects.toThrow(
      /too many redirects/,
    );
  });

  it("rejects when a redirect lands on a private IP", async () => {
    const lookup = vi
      .fn<LookupAllFn>()
      .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]) // public start
      .mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }]); // private hop
    const fetchMock = vi.fn().mockResolvedValueOnce(
      mockResponse({
        status: 302,
        headers: { location: "https://internal.example.com/secrets" },
      }),
    );
    const t = makeFetchUrlTool({
      fetch: fetchMock as never,
      lookup: lookup as unknown as LookupAllFn,
    });
    await expect(
      runFetch(t, "https://public.example.com/start"),
    ).rejects.toThrow(/private address/);
  });

  it("enforces 2MB body cap (streaming)", async () => {
    // Stream 3 chunks of 1MB each.
    const chunk = new Uint8Array(1024 * 1024).fill(0x41); // 'A'
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({
        body: stream,
        headers: { "content-type": "text/html" },
      }),
    );
    const t = makeFetchUrlTool({
      fetch: fetchMock as never,
      lookup: publicLookup,
    });
    await expect(runFetch(t, "https://example.com/big")).rejects.toThrow(
      /2MB cap/,
    );
  });

  it("rejects when content-length declares too-large body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({
        body: "stub",
        headers: {
          "content-type": "text/html",
          "content-length": String(5 * 1024 * 1024),
        },
      }),
    );
    const t = makeFetchUrlTool({
      fetch: fetchMock as never,
      lookup: publicLookup,
    });
    await expect(runFetch(t, "https://example.com/big")).rejects.toThrow(
      /2MB cap/,
    );
  });

  it("times out when fetch hangs past the configured deadline", async () => {
    vi.useFakeTimers();
    // Fetch resolves whenever the abort fires.
    const fetchMock = vi.fn().mockImplementation((_u, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(
            init.signal?.reason instanceof Error
              ? init.signal.reason
              : new Error("aborted"),
          );
        });
      });
    });
    const t = makeFetchUrlTool({
      fetch: fetchMock as never,
      lookup: publicLookup,
      timeoutMs: 100,
    });
    const p = runFetch(t, "https://example.com/slow");
    // Drain pending microtasks then expire the timer.
    await vi.advanceTimersByTimeAsync(101);
    await expect(p).rejects.toThrow();
  });

  it("strips credential headers across cross-origin redirects", async () => {
    // We can't observe headers directly on hop 0 (we set them inside the
    // tool), but we can verify the next-hop call doesn't carry an Authorization
    // header that was implicitly forwarded. Cover by exercising the path and
    // asserting the success.
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() =>
        Promise.resolve(
          mockResponse({
            status: 302,
            headers: { location: "https://other.example.com/landed" },
          }),
        ),
      )
      .mockImplementationOnce((_u: string, init: RequestInit) => {
        const headers = init.headers as Record<string, string>;
        // We didn't set Authorization ourselves, so this is mostly a smoke
        // check that the second call gets clean headers.
        expect(headers).not.toHaveProperty("authorization");
        expect(headers).not.toHaveProperty("cookie");
        return Promise.resolve(
          mockResponse({ body: html("<p>Landed safely here now.</p>") }),
        );
      });
    const t = makeFetchUrlTool({
      fetch: fetchMock as never,
      lookup: publicLookup,
    });
    const result = await runFetch(t, "https://start.example.com/");
    expect(result.text).toContain("Landed safely");
  });

  it("falls back to cheerio when readability returns nothing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse({
        body: html("<div>Just some text here.</div>", "Plain"),
      }),
    );
    const t = makeFetchUrlTool({
      fetch: fetchMock as never,
      lookup: publicLookup,
    });
    const result = await runFetch(t, "https://example.com/");
    expect(result.title).toBe("Plain");
    expect(result.text).toContain("Just some text");
  });

  it("throws on non-ok fetch", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(mockResponse({ status: 404, body: "nope" }));
    const t = makeFetchUrlTool({
      fetch: fetchMock as never,
      lookup: publicLookup,
    });
    await expect(runFetch(t, "https://example.com/")).rejects.toThrow(
      /fetch 404/,
    );
  });
});
