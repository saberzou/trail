"use client";

import { useEffect, useRef, useState } from "react";
import { type Editor, Tldraw } from "tldraw";
import "tldraw/tldraw.css";
import { WebpageNodeUtil } from "@/components/canvas/shapes/WebpageNodeUtil";
import { setCanvasEditor } from "@/lib/canvas/editorRef";
import {
  type CanvasSnapshot,
  createDebouncedSaver,
  loadSnapshot,
} from "@/lib/canvas/persistence";

export function TrailCanvas() {
  // Gate the <Tldraw> mount until we've checked IndexedDB so we don't race the
  // hydrate against any programmatic shape creation.
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
            } catch (err) {
              console.error("[trail] failed to load canvas snapshot", err);
            }
          }

          const saver = createDebouncedSaver(
            () => editor.store.getStoreSnapshot(),
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
    </main>
  );
}
