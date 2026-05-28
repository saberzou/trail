"use client";

import { createShapeId, type Editor, Tldraw } from "tldraw";
import "tldraw/tldraw.css";
import { PromptNodeUtil } from "@/components/canvas/shapes/PromptNodeUtil";
import { ResultNodeUtil } from "@/components/canvas/shapes/ResultNodeUtil";
import { WebpageNodeUtil } from "@/components/canvas/shapes/WebpageNodeUtil";
import { setCanvasEditor } from "@/lib/canvas/editorRef";

const SEED_PROMPT_ID = createShapeId("trail-prompt-seed");

export function TrailCanvas() {
  return (
    <main className="fixed inset-0 bg-[#f4f1e8]">
      <Tldraw
        shapeUtils={[PromptNodeUtil, ResultNodeUtil, WebpageNodeUtil]}
        onMount={(editor: Editor) => {
          setCanvasEditor(editor);
          if (!editor.getShape(SEED_PROMPT_ID)) {
            editor.createShape({
              id: SEED_PROMPT_ID,
              type: "prompt",
              x: 200,
              y: 200,
              props: { w: 280, h: 160, prompt: "", status: "idle" },
            });
          }
          editor.select(SEED_PROMPT_ID);
          editor.zoomToSelection({ animation: { duration: 240 } });
          return () => {
            setCanvasEditor(null);
          };
        }}
      />
    </main>
  );
}
