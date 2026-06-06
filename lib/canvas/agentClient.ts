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
 *   using a layout chosen by `flow_meta.intent`:
 *     - "task"    → vertical column (top-to-bottom), tiles chained by
 *                   arrows from step N → step N+1. Reads as an ordered
 *                   checklist and doesn't run off the side of the viewport.
 *     - "explore" → radial cluster (anchor + spokes), tiles arranged in
 *                   a ring around an anchor. Arrows fan out from the
 *                   anchor tile to each related tile (only when an
 *                   anchor shape exists — see notes below).
 *   All tiles in a flow are wired together with tldraw's native arrow
 *   shape, bound at both ends so dragging a tile keeps the arrow attached.
 */

import { nanoid } from "nanoid";
import {
  createShapeId,
  type Editor,
  type TLArrowBinding,
  type TLArrowShape,
  type TLShapeId,
} from "tldraw";
import type { SessionEvent, SessionRequest } from "@/lib/agent/session";

const SESSION_ENDPOINT = "/api/agent/session";

/** Default dimensions for screenshot/iframe tiles — these have visual
 * content (an image or a live iframe), so a 220px short edge is enough. */
const TILE_W = 320;
const TILE_H = 220;
/** LINK-mode tiles are slightly wider and shorter so the hostname +
 * summary + Open button fit comfortably without truncating. */
const LINK_TILE_W = 360;
const LINK_TILE_H = 200;
/** Vertical step between consecutive task-flow tiles (TILE_H + 40px gap). */
const COLUMN_STEP = 260;
/** Radius of the ring around the anchor for explore-flow tiles. */
const RADIAL_RADIUS = 360;
/** Default angle between explore-flow tiles when totalHint is unknown. */
const DEFAULT_RADIAL_STEP = Math.PI / 3; // 60°

function dimsForMode(mode: "screenshot" | "iframe" | "link"): {
  w: number;
  h: number;
} {
  return mode === "link"
    ? { w: LINK_TILE_W, h: LINK_TILE_H }
    : { w: TILE_W, h: TILE_H };
}

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
 * Per-run layout state. One entry per `runId` (one per turn). Captured on
 * the FIRST event we see for the run (typically `flow_meta`) so subsequent
 * tile placements all align to the same anchor — even if the user pans
 * the canvas mid-stream.
 *
 * `runSessionTurn` is responsible for clearing this on completion (success
 * AND failure paths) to keep the map from growing without bound.
 */
type LayoutState = {
  intent: "task" | "explore";
  anchorX: number;
  anchorY: number;
  cursor: number;
  /** Optional total tile count for this run; used by radial layout to
   * compute even angle spacing. Today the agent never sends this — left
   * here so we can wire it up cheaply if a future protocol bumps include
   * a `total` field on `flow_meta`. */
  expectedTotal?: number;
};

const layoutStates = new Map<string, LayoutState>();

/**
 * Place a tile in a vertical column below the anchor. `index` is the 0-based
 * ordinal of the tile within the run (cursor); index 0 sits on the anchor,
 * and each subsequent index steps `COLUMN_STEP` downward with constant X —
 * an ordered top-to-bottom checklist that doesn't run off the viewport's
 * side the way a horizontal row did.
 */
export function placeTileInColumn(
  state: LayoutState,
  index: number,
): { x: number; y: number } {
  const x = state.anchorX - TILE_W / 2;
  const y = state.anchorY - TILE_H / 2 + index * COLUMN_STEP;
  return { x, y };
}

/**
 * Place a tile on a circle of radius `RADIAL_RADIUS` around the anchor.
 * Angle stepping prefers `state.expectedTotal` when known (even spacing
 * around the full circle), and falls back to `DEFAULT_RADIAL_STEP` (60°)
 * when tiles arrive one-by-one without a known count.
 *
 * The first tile lands directly to the RIGHT of the anchor (angle 0) so
 * a hub tile + ring of spokes reads as "anchor + related" — not as a
 * decorative pattern around nothing.
 */
export function placeTileInRadial(
  state: LayoutState,
  index: number,
): { x: number; y: number } {
  const step =
    state.expectedTotal && state.expectedTotal > 0
      ? (2 * Math.PI) / state.expectedTotal
      : DEFAULT_RADIAL_STEP;
  const angle = index * step;
  const cx = state.anchorX + RADIAL_RADIUS * Math.cos(angle);
  const cy = state.anchorY + RADIAL_RADIUS * Math.sin(angle);
  return { x: cx - TILE_W / 2, y: cy - TILE_H / 2 };
}

/** Test-only: reset the layout-state map. */
export function _resetLayoutStates() {
  layoutStates.clear();
}

/** Test-only: how many runIds are still tracked in the layout-state map. */
export function _getLayoutStateCount(): number {
  return layoutStates.size;
}

/**
 * Test-only: seed an expected tile count. `runSessionTurn` will pick this
 * up on the first event if the agent never streams one itself. Today
 * unused in production code — exported so a future protocol bump can wire
 * it up without changing this module's shape.
 */
export function _setExpectedTileCount(runId: string, n: number): void {
  const s = layoutStates.get(runId);
  if (s) s.expectedTotal = n;
}

export type RunSessionCallbacks = {
  onAssistantText?: (text: string) => void;
  onFlowMeta?: (intent: "task" | "explore", downgraded: boolean) => void;
  onError?: (message: string) => void;
  onDone?: () => void;
  /** Fires once per successfully created tile shape — caller uses this for
   * per-turn tile counts (ChatPanel's "Done — added N tiles" line). */
  onNode?: () => void;
  /** Used by tests to override the layout-state runId. */
  runId?: string;
  /** Inject a fetch (tests). */
  fetchImpl?: typeof fetch;
  /** Anchor position (page-space center) for this run's layout. If
   * omitted, the viewport center at first-event time is used. */
  anchorPos?: { x: number; y: number };
  /** Shape id of the anchor tile (e.g. the URL-paste tile that triggered
   * a "find related" follow-up). When present and the flow's intent is
   * `explore`, arrows fan out from this shape to each created tile. */
  anchorShapeId?: TLShapeId;
};

/**
 * Build the start/end bindings that wire an arrow shape to its two
 * terminal tiles. We bind at the tile center (normalizedAnchor 0.5/0.5)
 * with `isPrecise: false` so tldraw routes the arrow to whichever edge
 * looks best — this matches the default behaviour when a user draws an
 * arrow between two shapes interactively.
 */
function bindArrow(
  editor: Editor,
  arrowId: ReturnType<typeof createShapeId>,
  fromShapeId: TLShapeId,
  toShapeId: TLShapeId,
): void {
  editor.createBindings<TLArrowBinding>([
    {
      fromId: arrowId,
      toId: fromShapeId,
      type: "arrow",
      props: {
        terminal: "start",
        normalizedAnchor: { x: 0.5, y: 0.5 },
        isPrecise: false,
        isExact: false,
      },
    },
    {
      fromId: arrowId,
      toId: toShapeId,
      type: "arrow",
      props: {
        terminal: "end",
        normalizedAnchor: { x: 0.5, y: 0.5 },
        isPrecise: false,
        isExact: false,
      },
    },
  ]);
}

/**
 * Create an arrow shape between two tiles. We seed start/end at the tile
 * centers so the arrow has *something* on screen even before the binding
 * resolver runs; once the bindings are attached, tldraw recomputes the
 * geometry to route from edge to edge.
 *
 * The default `arrow` shape type is registered by tldraw out of the box
 * (we don't list it in `TrailCanvas`'s `shapeUtils`), so we don't need
 * to add anything to the canvas to use it.
 */
function createArrowBetween(
  editor: Editor,
  fromShapeId: TLShapeId,
  fromCenter: { x: number; y: number },
  toShapeId: TLShapeId,
  toCenter: { x: number; y: number },
): void {
  const arrowId = createShapeId(nanoid());
  try {
    editor.createShape<TLArrowShape>({
      id: arrowId,
      type: "arrow",
      x: fromCenter.x,
      y: fromCenter.y,
      props: {
        start: { x: 0, y: 0 },
        end: { x: toCenter.x - fromCenter.x, y: toCenter.y - fromCenter.y },
      },
    });
    bindArrow(editor, arrowId, fromShapeId, toShapeId);
  } catch (err) {
    // Arrow creation failing isn't fatal — the tiles themselves are still
    // visible. We log so a regression surfaces in devtools.
    console.error("[trail] createArrow failed", err);
  }
}

export async function runSessionTurn(
  editor: Editor,
  req: SessionRequest,
  signal: AbortSignal,
  callbacks: RunSessionCallbacks = {},
): Promise<void> {
  const runId = callbacks.runId ?? nanoid(10);

  // Tile IDs (and their centers) created during THIS run, in creation
  // order. Used to wire arrows after all nodes have arrived.
  const createdTiles: Array<{
    id: TLShapeId;
    center: { x: number; y: number };
  }> = [];

  /** Lazily initialise layout state on the first event. We default to
   * "explore" intent until `flow_meta` arrives — the agent always emits
   * `flow_meta` before any `node` events today, but if a malformed stream
   * sends a `node` first we'd rather lay them out radially than crash. */
  function ensureLayout(): LayoutState {
    let s = layoutStates.get(runId);
    if (!s) {
      const anchor =
        callbacks.anchorPos ?? editor.getViewportPageBounds().center;
      s = {
        intent: "explore",
        anchorX: anchor.x,
        anchorY: anchor.y,
        cursor: 0,
      };
      layoutStates.set(runId, s);
    }
    return s;
  }

  try {
    await streamSession(
      req,
      (event) => {
        switch (event.kind) {
          case "assistant_text":
            callbacks.onAssistantText?.(event.text);
            break;
          case "flow_meta": {
            const s = ensureLayout();
            s.intent = event.intent;
            callbacks.onFlowMeta?.(event.intent, event.downgraded);
            break;
          }
          case "node": {
            const s = ensureLayout();
            const index = s.cursor;
            const { x, y } =
              s.intent === "task"
                ? placeTileInColumn(s, index)
                : placeTileInRadial(s, index);
            s.cursor = index + 1;
            const shapeId = createShapeId(event.nodeId);
            const { w, h } = dimsForMode(event.mode);
            try {
              editor.createShape({
                id: shapeId,
                type: "webpage",
                x,
                y,
                props: {
                  w,
                  h,
                  url: event.url,
                  title: event.title,
                  hostname: event.hostname,
                  mode: event.mode,
                  summary: event.summary,
                },
              });
              createdTiles.push({
                id: shapeId,
                center: { x: x + w / 2, y: y + h / 2 },
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
            // Arrow wiring happens after the loop exits so we have the
            // full list of created tiles in hand.
            break;
        }
      },
      signal,
      callbacks.fetchImpl,
    );

    // Wire arrows once all node events have arrived. The intent we use
    // here is whichever the agent settled on for this run (defaults to
    // "explore" if no flow_meta was ever received).
    const state = layoutStates.get(runId);
    if (state && createdTiles.length > 0) {
      if (state.intent === "task") {
        // step₁ → step₂ → step₃ … chain.
        for (let i = 0; i < createdTiles.length - 1; i++) {
          const from = createdTiles[i];
          const to = createdTiles[i + 1];
          createArrowBetween(editor, from.id, from.center, to.id, to.center);
        }
      } else {
        // Explore: spokes from the anchor tile (if any) to each created
        // tile. When no anchorShapeId is supplied — i.e. free-form
        // explore where the anchor is just the viewport center, not a
        // real shape — we skip arrows. There's nothing to bind to, and
        // dangling positional arrows pointing at empty page-space looks
        // worse than no arrows at all.
        if (callbacks.anchorShapeId) {
          const anchorCenter = {
            x: state.anchorX,
            y: state.anchorY,
          };
          for (const tile of createdTiles) {
            createArrowBetween(
              editor,
              callbacks.anchorShapeId,
              anchorCenter,
              tile.id,
              tile.center,
            );
          }
        }
      }
    }

    callbacks.onDone?.();
  } catch (err) {
    if (signal.aborted) {
      callbacks.onError?.("Stopped.");
      return;
    }
    const message = err instanceof Error ? err.message : "agent run failed";
    callbacks.onError?.(message);
  } finally {
    // Prune layout state for this run so the map doesn't grow without
    // bound across sessions. Cleared on both success and failure.
    layoutStates.delete(runId);
  }
}
