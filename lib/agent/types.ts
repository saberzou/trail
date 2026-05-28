export type AgentEvent =
  | {
      kind: "node";
      nodeId: string;
      parentId: string;
      title: string;
      url: string;
      summary: string;
      source: "search" | "fetch";
    }
  | { kind: "thought"; text: string }
  | { kind: "done"; runId: string }
  | { kind: "error"; message: string };

export interface AgentRunRequest {
  prompt: string;
  parentNodeId: string;
  providerId: "openai" | "anthropic" | "google" | "deepseek";
  apiKey: string;
  model?: string;
  searchProvider?: "brave" | "tavily";
  searchKey?: string;
}
