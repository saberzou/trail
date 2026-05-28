import { createShapeId, type Editor } from "tldraw";
import type { PromptNodeShape } from "@/components/canvas/shapes/PromptNodeUtil";
import type { ResultNodeShape } from "@/components/canvas/shapes/ResultNodeUtil";
import type { AgentEvent, AgentRunRequest } from "@/lib/agent/types";
import { useSettingsStore } from "@/lib/settings/store";
import type { ProviderId } from "@/lib/settings/types";

const abortControllers = new Map<string, AbortController>();

export function setAbortController(runId: string, c: AbortController): void {
  abortControllers.set(runId, c);
}

export function getAbortController(runId: string): AbortController | undefined {
  return abortControllers.get(runId);
}

export function clearAbortController(runId: string): void {
  abortControllers.delete(runId);
}

export async function streamAgentRun(
  req: AgentRunRequest,
  onEvent: (event: AgentEvent) => void,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl("/api/agent/run", {
    method: "POST",
    body: JSON.stringify(req),
    headers: { "content-type": "application/json" },
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`agent ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const frames = buf.split("\n\n");
    buf = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.trim();
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      onEvent(JSON.parse(payload) as AgentEvent);
    }
  }
}

const AGENT_PROVIDERS = new Set<ProviderId>([
  "openai",
  "anthropic",
  "gemini",
  "deepseek",
]);

function toAgentProviderId(
  id: ProviderId | undefined,
): "openai" | "anthropic" | "google" | "deepseek" | undefined {
  if (!id || !AGENT_PROVIDERS.has(id)) return undefined;
  if (id === "gemini") return "google";
  return id as "openai" | "anthropic" | "deepseek";
}

/**
 * Drive an agent run from a PromptNode shape on the canvas. Updates the
 * shape's status, materializes ResultNode children, and connects them with
 * positional arrows.
 */
export async function runPromptShape(
  editor: Editor,
  shapeId: PromptNodeShape["id"],
): Promise<void> {
  const shape = editor.getShape<PromptNodeShape>(shapeId);
  if (!shape || shape.type !== "prompt") return;

  const updateProps = (next: Partial<PromptNodeShape["props"]>) => {
    const current = editor.getShape<PromptNodeShape>(shapeId);
    if (!current) return;
    editor.updateShape<PromptNodeShape>({
      id: shapeId,
      type: "prompt",
      props: { ...current.props, ...next },
    });
  };

  const settings = useSettingsStore.getState().settings;
  const providerId = toAgentProviderId(settings.defaultLlm);
  const llmCfg = settings.defaultLlm
    ? settings.providers[settings.defaultLlm]
    : undefined;
  const apiKey =
    llmCfg && llmCfg.kind === "api-key" ? llmCfg.apiKey : undefined;
  if (!providerId || !apiKey) {
    updateProps({
      status: "error",
      error: "Configure an LLM provider with an API key in /settings first.",
    });
    return;
  }
  const searchId = settings.defaultSearch;
  const searchCfg = searchId ? settings.providers[searchId] : undefined;
  const searchKey =
    searchCfg && searchCfg.kind === "api-key" ? searchCfg.apiKey : undefined;
  const searchProvider: "brave" | "tavily" | undefined =
    searchId === "brave" || searchId === "tavily" ? searchId : undefined;

  const controller = new AbortController();
  const runId = crypto.randomUUID();
  setAbortController(runId, controller);
  updateProps({ status: "running", runId, error: undefined });

  let childIndex = 0;
  try {
    await streamAgentRun(
      {
        prompt: shape.props.prompt,
        parentNodeId: shape.id,
        providerId,
        apiKey,
        searchProvider: searchKey ? searchProvider : undefined,
        searchKey: searchKey ?? undefined,
      },
      (event) => {
        if (event.kind === "node") {
          const childId = createShapeId(`result-${event.nodeId}`);
          const angle = (childIndex * Math.PI * 2) / 6;
          const dx = Math.cos(angle) * 380;
          const dy = Math.sin(angle) * 260 + 240;
          childIndex += 1;
          const childX = shape.x + dx;
          const childY = shape.y + dy;
          editor.createShape<ResultNodeShape>({
            id: childId,
            type: "result",
            x: childX,
            y: childY,
            props: {
              w: 320,
              h: 220,
              title: event.title,
              url: event.url,
              summary: event.summary,
              source: event.source,
            },
          });
          // Positional arrow (no bindings) — reliable fallback per plan.
          editor.createShape({
            id: createShapeId(`arrow-${event.nodeId}`),
            type: "arrow",
            x: 0,
            y: 0,
            props: {
              start: {
                x: shape.x + shape.props.w / 2,
                y: shape.y + shape.props.h / 2,
              },
              end: { x: childX + 160, y: childY + 110 },
            } as never,
          });
        } else if (event.kind === "done") {
          updateProps({ status: "done" });
        } else if (event.kind === "error") {
          updateProps({ status: "error", error: event.message });
        }
      },
      controller.signal,
    );
  } catch (err) {
    if (controller.signal.aborted) {
      updateProps({ status: "idle" });
    } else {
      updateProps({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } finally {
    clearAbortController(runId);
  }
}

export function killPromptShape(
  editor: Editor,
  shapeId: PromptNodeShape["id"],
): void {
  const shape = editor.getShape<PromptNodeShape>(shapeId);
  if (!shape) return;
  const runId = shape.props.runId;
  if (!runId) return;
  getAbortController(runId)?.abort();
  clearAbortController(runId);
  editor.updateShape<PromptNodeShape>({
    id: shapeId,
    type: "prompt",
    props: { ...shape.props, status: "idle" },
  });
}
