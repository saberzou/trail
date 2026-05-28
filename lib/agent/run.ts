import { createAnthropic } from "@ai-sdk/anthropic";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, type LanguageModel, stepCountIs, tool } from "ai";
import { nanoid } from "nanoid";
import { z } from "zod";
import { makeFetchUrlTool, makeWebSearchTool } from "./tools";
import type { AgentEvent, AgentRunRequest } from "./types";

function resolveModel(req: AgentRunRequest): LanguageModel {
  const model = req.model;
  switch (req.providerId) {
    case "openai":
      return createOpenAI({ apiKey: req.apiKey })(model ?? "gpt-4o-mini");
    case "anthropic":
      return createAnthropic({ apiKey: req.apiKey })(
        model ?? "claude-3-5-sonnet-latest",
      );
    case "google":
      return createGoogleGenerativeAI({ apiKey: req.apiKey })(
        model ?? "gemini-2.0-flash",
      );
    case "deepseek":
      return createDeepSeek({ apiKey: req.apiKey })(model ?? "deepseek-chat");
  }
}

export async function* runAgent(
  req: AgentRunRequest,
  signal: AbortSignal,
): AsyncIterable<AgentEvent> {
  const runId = nanoid(10);
  const events: AgentEvent[] = [];
  const push = (e: AgentEvent) => events.push(e);

  const spawnChild = tool({
    description:
      "Create a child node on the canvas with a search result or fetched page.",
    inputSchema: z.object({
      title: z.string(),
      url: z.string().url(),
      summary: z.string(),
      source: z.enum(["search", "fetch"]),
    }),
    execute: async ({ title, url, summary, source }) => {
      const nodeId = nanoid(10);
      push({
        kind: "node",
        nodeId,
        parentId: req.parentNodeId,
        title,
        url,
        summary,
        source,
      });
      return { nodeId };
    },
  });

  // biome-ignore lint/suspicious/noExplicitAny: AI SDK v6 ToolSet is invariant; mixing tool input shapes requires `any` here
  const tools: Record<string, any> = {
    fetch_url: makeFetchUrlTool(),
    spawn_child_node: spawnChild,
  };
  if (req.searchProvider && req.searchKey) {
    tools.web_search = makeWebSearchTool({
      provider: req.searchProvider,
      apiKey: req.searchKey,
    });
  }

  const generatePromise = generateText({
    model: resolveModel(req),
    tools,
    stopWhen: stepCountIs(8),
    abortSignal: signal,
    system:
      "You are Trail, a visual research agent. Given a user prompt: use web_search to find sources, fetch_url to read interesting ones, and spawn_child_node for EACH useful finding (search hit OR fetched page). Aim for 3-6 child nodes. Be concise in summaries (1-3 sentences).",
    prompt: req.prompt,
  })
    .then(() => null as null | Error)
    .catch((err: unknown) =>
      err instanceof Error ? err : new Error(String(err)),
    );

  // Pump events as the SDK runs. Tools push synchronously into `events`;
  // we race the in-flight generation against a short timer so we can flush
  // any queued events without blocking the whole pipeline.
  let settled: null | Error | undefined;
  generatePromise.then((v) => {
    settled = v;
  });

  while (true) {
    if (events.length > 0) {
      yield events.shift()!;
      continue;
    }
    if (settled !== undefined) {
      while (events.length > 0) yield events.shift()!;
      if (settled instanceof Error) {
        yield { kind: "error", message: settled.message };
      } else {
        yield { kind: "done", runId };
      }
      return;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
}
