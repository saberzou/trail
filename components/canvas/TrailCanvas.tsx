"use client";

import { useEffect, useRef, useState } from "react";
import { createShapeId, type Editor, Tldraw } from "tldraw";
import "tldraw/tldraw.css";
import { PromptNodeUtil } from "@/components/canvas/shapes/PromptNodeUtil";
import { ResultNodeUtil } from "@/components/canvas/shapes/ResultNodeUtil";
import { WebpageNodeUtil } from "@/components/canvas/shapes/WebpageNodeUtil";
import { setCanvasEditor } from "@/lib/canvas/editorRef";
import {
  type CanvasSnapshot,
  createDebouncedSaver,
  loadSnapshot,
} from "@/lib/canvas/persistence";

const SEED_PROMPT_ID = createShapeId("trail-prompt-seed");

export function TrailCanvas() {
  // Gate the <Tldraw> mount until we've checked IndexedDB. This keeps us from
  // seeding a new PromptNode and racing the snapshot load.
  const [initial, setInitial] = useState<{
    snapshot: CanvasSnapshot | null;
  } | null>(null);
  const initialRef = useRef(initial);
  initialRef.current = initial;

  useEffect(() => {
    let alive = true;
    loadSnapshot()
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
  }, []);

  if (!initial) {
    return <main className="fixed inset-0 bg-[#f4f1e8]" />;
  }

  return (
    <main className="fixed inset-0 bg-[#f4f1e8]">
      <Tldraw
        shapeUtils={[PromptNodeUtil, ResultNodeUtil, WebpageNodeUtil]}
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
            } catch (err) {
              console.error("[trail] failed to load canvas snapshot", err);
            }
          } else if (!editor.getShape(SEED_PROMPT_ID)) {
            editor.createShape({
              id: SEED_PROMPT_ID,
              type: "prompt",
              x: 200,
              y: 200,
              props: { w: 280, h: 160, prompt: "", status: "idle" },
            });
            editor.select(SEED_PROMPT_ID);
            editor.zoomToSelection({ animation: { duration: 240 } });
          }

          const saver = createDebouncedSaver(
            () => editor.store.getStoreSnapshot(),
            400,
          );
          const unlisten = editor.store.listen(
            () => {
              saver.trigger();
            },
            { source: "user", scope: "document" },
          );

          return () => {
            unlisten();
            void saver.flush();
            setCanvasEditor(null);
          };
        }}
      />
    </main>
  );
}
