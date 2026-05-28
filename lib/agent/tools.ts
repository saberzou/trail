import { Readability } from "@mozilla/readability";
import { tool } from "ai";
import * as cheerio from "cheerio";
import { JSDOM } from "jsdom";
import { z } from "zod";

type Fetch = typeof fetch;

export function makeWebSearchTool(opts: {
  provider: "brave" | "tavily";
  apiKey: string;
  fetch?: Fetch;
}) {
  const f = opts.fetch ?? fetch;
  return tool({
    description:
      "Search the web. Returns top results with title, url, description.",
    inputSchema: z.object({ query: z.string().min(1) }),
    execute: async ({ query }) => {
      if (opts.provider === "brave") {
        const r = await f(
          `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=8`,
          {
            headers: {
              "X-Subscription-Token": opts.apiKey,
              Accept: "application/json",
            },
          },
        );
        if (!r.ok) throw new Error(`brave ${r.status}`);
        const j = (await r.json()) as {
          web?: {
            results?: Array<{
              title: string;
              url: string;
              description: string;
            }>;
          };
        };
        return {
          results: (j.web?.results ?? [])
            .slice(0, 8)
            .map(({ title, url, description }) => ({
              title,
              url,
              description,
            })),
        };
      }
      const r = await f("https://api.tavily.com/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ api_key: opts.apiKey, query, max_results: 8 }),
      });
      if (!r.ok) throw new Error(`tavily ${r.status}`);
      const j = (await r.json()) as {
        results?: Array<{ title: string; url: string; content: string }>;
      };
      return {
        results: (j.results ?? []).map(({ title, url, content }) => ({
          title,
          url,
          description: content,
        })),
      };
    },
  });
}

export function makeFetchUrlTool(opts: { fetch?: Fetch } = {}) {
  const f = opts.fetch ?? fetch;
  return tool({
    description: "Fetch a URL and extract its main readable content.",
    inputSchema: z.object({ url: z.string().url() }),
    execute: async ({ url }) => {
      const r = await f(url, {
        headers: { "user-agent": "Mozilla/5.0 TrailBot/1.0" },
      });
      if (!r.ok) throw new Error(`fetch ${r.status}`);
      const html = await r.text();
      const dom = new JSDOM(html, { url });
      const article = new Readability(dom.window.document).parse();
      if (article?.textContent) {
        return {
          title: article.title || url,
          text: article.textContent.slice(0, 4000),
        };
      }
      const $ = cheerio.load(html);
      $("script, style, noscript").remove();
      return {
        title: $("title").text() || url,
        text: $("body").text().replace(/\s+/g, " ").slice(0, 4000),
      };
    },
  });
}
