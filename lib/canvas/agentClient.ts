/**
 * Client-side bridge between the master agent (SSE from /api/agent/session)
 * and the tldraw canvas.
 *
 * Two entry points:
 *
 * - `streamSession` is a thin POST-and-parse wrapper. It opens the SSE,
 *   pulls `data:` frames out, and hands each parsed event to the caller.
 *   It does NOT touch the editor — that's deliberate; the route test and
 *   any non-canvas consumer (a dev panel, etc.) can use it in isolation.
 *
 * - `runSessionTurn` is the canvas-facing high-level helper. It calls
 *   `streamSession`, then for every `node` event creates a webpage shape
 *   at the next vertical-column slot. Text deltas go through
 *   `callbacks.onAssistantText`; errors and completion fire their own
 *   callbacks. The column layout is intentionally dumb in PR2b — tiles
 *   stack 240px apart under the viewport center; PR2c adds radial.
 */

import { nanoid } from "nanoid";
import { createShapeId, type Editor } from "tldraw";
import type { SessionEvent, SessionRequest } from "@/lib/agent/session";

const SESSION_ENDPOINT = "/api/agent/session";

const TILE_W = 320;
const TILE_H = 220;
const COLUMN_GAP = 240;

export async function streamSession(
  req: SessionRequest,
  onEvent: (event: SessionEvent) => void,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const res = await fetchImpl(SESSION_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
    signal,
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `agent session HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  // SSE frames end at a blank line. We buffer partial chunks across reads
  // and only emit complete frames so a JSON.parse never sees half a payload.
  let buffer = "";
  while (true) {
    if (signal.aborted) {
      await reader.cancel().catch(() => {});
      return;
    }
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    // biome-ignore lint/suspicious/noAssignInExpressions: standard SSE-buffer drain pattern.
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 2);
      if (!frame) continue;
      // We only emit `data:` lines from the server; tolerate other SSE
      // fields (comments, retries) by ignoring them.
      const lines = frame.split("\n");
      for (const line of lines) {
        if (!line.startsWith("data:")) continue;
        const json = line.slice("data:".length).trim();
        if (!json) continue;
        try {
          onEvent(JSON.parse(json) as SessionEvent);
        } catch (err) {
          console.error("[trail] failed to parse SSE frame", err, json);
        }
      }
    }
  }
}

/**
 * Vertical-column layout state. Keyed by something the caller controls (a
 * runId — usually we generate one per turn). First tile lands at the
 * viewport center; subsequent tiles stack 240px down.
 *
 * `columnAnchors` snapshots the viewport center on the FIRST tile placement
 * per runId so subsequent tiles align to the same x/y origin even if the
 * user pans the canvas mid-stream. Without this, panning between
 * `node` events would fragment the column.
 *
 * `runSessionTurn` is responsible for clearing both maps on completion
 * (including the failure path) — otherwise both grow without bound.
 */
const columnCursors = new Map<string, number>();
const columnAnchors = new Map<string, { x: number; y: number }>();

export function placeTileInColumn(
  editor: Editor,
  runId: string,
): { x: number; y: number } {
  let anchor = columnAnchors.get(runId);
  if (!anchor) {
    const c = editor.getViewportPageBounds().center;
    anchor = { x: c.x, y: c.y };
    columnAnchors.set(runId, anchor);
  }
  const cursor = columnCursors.get(runId) ?? 0;
  const x = anchor.x - TILE_W / 2;
  const y = anchor.y - TILE_H / 2 + cursor * COLUMN_GAP;
  columnCursors.set(runId, cursor + 1);
  return { x, y };
}

/** Test-only: reset both column-layout maps. */
export function _resetColumnCursors() {
  columnCursors.clear();
  columnAnchors.clear();
}

/** Test-only: how many runIds are still tracked in the layout maps. */
export function _getColumnCursorCount(): number {
  return columnCursors.size;
}

/** Test-only: how many anchors are still tracked. */
export function _getColumnAnchorCount(): number {
  return columnAnchors.size;
}

export type RunSessionCallbacks = {
  onAssistantText?: (text: string) => void;
  onFlowMeta?: (intent: "task" | "explore", downgraded: boolean) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
  /** Fires once per successfully created tile shape — caller uses this for
   * per-turn tile counts (ChatPanel's "Done — added N tiles" line). */
  onNode?: () => void;
  /** Used by tests to override the column-layout runId. */
  runId?: string;
  /** Inject a fetch (tests). */
  fetchImpl?: typeof fetch;
};

export async function runSessionTurn(
  editor: Editor,
  req: SessionRequest,
  signal: AbortSignal,
  callbacks: RunSessionCallbacks = {},
): Promise<void> {
  const runId = callbacks.runId ?? nanoid(10);

  try {
    await streamSession(
      req,
      (event) => {
        switch (event.kind) {
          case "assistant_text":
            callbacks.onAssistantText?.(event.text);
            break;
          case "flow_meta":
            callbacks.onFlowMeta?.(event.intent, event.downgraded);
            break;
          case "node": {
            const { x, y } = placeTileInColumn(editor, runId);
            const shapeId = createShapeId(event.nodeId);
            try {
              editor.createShape({
                id: shapeId,
                type: "webpage",
                x,
                y,
                props: {
                  w: TILE_W,
                  h: TILE_H,
                  url: event.url,
                  title: event.title,
                  hostname: event.hostname,
                  mode: event.mode,
                  summary: event.summary,
                },
              });
              callbacks.onNode?.();
            } catch (err) {
              // Surface to chat so the user sees *something* per missing
              // tile, but don't abort — keep processing the remaining
              // node events in this run.
              console.error("[trail] createShape failed", err);
              callbacks.onError?.(`Couldn't add tile for ${event.url}`);
            }
            break;
          }
          case "error":
            callbacks.onError?.(event.message);
            break;
          case "done":
            // Final cleanup happens after the loop exits.
            break;
        }
      },
      signal,
      callbacks.fetchImpl,
    );
    callbacks.onDone?.();
  } catch (err) {
    if (signal.aborted) {
      callbacks.onError?.("Stopped.");
      return;
    }
    const message = err instanceof Error ? err.message : "agent run failed";
    callbacks.onError?.(message);
  } finally {
    // Prune layout state for this run so the maps don't grow without
    // bound across sessions. Cleared on both success and failure.
    columnCursors.delete(runId);
    columnAnchors.delete(runId);
  }
}
