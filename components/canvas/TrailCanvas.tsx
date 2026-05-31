"use client";

import { useEffect, useRef, useState } from "react";
import { type Editor, type TLUiComponents, Tldraw } from "tldraw";
import "tldraw/tldraw.css";
import { WebpageNodeUtil } from "@/components/canvas/shapes/WebpageNodeUtil";
import { setCanvasEditor } from "@/lib/canvas/editorRef";
import {
  type CanvasSnapshot,
  loadSnapshot,
  saveSnapshot,
  seedLastHash,
} from "@/lib/canvas/persistence";
import { createDebouncedSaver } from "@/lib/idb/saver";

/**
 * Trail is graph navigation, not a drawing app. We hide tldraw's StylePanel
 * (top-right color / size / fill picker) because Trail tiles aren't user-
 * styled shapes — the picker was just clutter that confused first-time
 * users. The default tool is set to "hand" in onMount for the same reason:
 * the user should drag to pan without first switching tools.
 *
 * The bottom toolbar (cursor, hand, draw, eraser, arrow, text, sticky,
 * image, square) is intentionally NOT hidden here: hiding the entire
 * Toolbar is too coarse — users still benefit from select for arranging
 * tiles, and sticky/text/draw for jotting notes alongside the flow. If we
 * ever want a tighter palette we'll need a custom Toolbar override.
 */
const TLDRAW_COMPONENTS: TLUiComponents = {
  StylePanel: null,
};

export function TrailCanvas({ trailId }: { trailId: string }) {
  // Gate the <Tldraw> mount until we've checked IndexedDB so we don't race the
  // hydrate against any programmatic shape creation.
  const [initial, setInitial] = useState<{
    snapshot: CanvasSnapshot | null;
  } | null>(null);
  const initialRef = useRef(initial);
  initialRef.current = initial;

  useEffect(() => {
    let alive = true;
    loadSnapshot(trailId)
      .then((snap) => {
        if (alive) setInitial({ snapshot: snap });
      })
      .catch((err) => {
        console.error("[trail] canvas snapshot load failed", err);
        if (alive) setInitial({ snapshot: null });
      });
    return () => {
      alive = false;
    };
  }, [trailId]);

  if (!initial) {
    return <div className="absolute inset-0 bg-muted" />;
  }

  return (
    <div className="absolute inset-0 bg-muted">
      <Tldraw
        components={TLDRAW_COMPONENTS}
        shapeUtils={[WebpageNodeUtil]}
        onMount={(editor: Editor) => {
          setCanvasEditor(editor);

          const snapshot = initialRef.current?.snapshot;
          const hasSnapshot =
            !!snapshot &&
            typeof snapshot === "object" &&
            "store" in (snapshot as Record<string, unknown>) &&
            Object.keys(
              (snapshot as { store?: Record<string, unknown> }).store ?? {},
            ).length > 0;

          if (hasSnapshot) {
            try {
              editor.store.loadStoreSnapshot(
                snapshot as Parameters<
                  typeof editor.store.loadStoreSnapshot
                >[0],
              );
              // Seed the dedup hash so the very first listen() tick after
              // hydrate doesn't pointlessly re-serialize the same snapshot.
              seedLastHash(trailId, snapshot);
            } catch (err) {
              console.error("[trail] failed to load canvas snapshot", err);
            }
          }

          // Default to the hand tool so a left-click-drag pans the canvas.
          // Trail is graph navigation; the user shouldn't have to switch
          // tools just to move around. We do this AFTER snapshot load so
          // any persisted UI state can't immediately swap us back.
          editor.setCurrentTool("hand");

          const saver = createDebouncedSaver(
            () => editor.store.getStoreSnapshot(),
            (snap) => saveSnapshot(trailId, snap),
            400,
          );
          // Listen to document-scope changes from any source (user *and*
          // programmatic) so agent-authored shapes persist. We intentionally
          // skip the `source: "user"` filter that was here before.
          const unlisten = editor.store.listen(
            () => {
              saver.trigger();
            },
            { scope: "document" },
          );

          return () => {
            unlisten();
            void saver.flush();
            setCanvasEditor(null);
          };
        }}
      />
    </div>
  );
}
