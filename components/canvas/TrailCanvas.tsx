"use client";

import { Tldraw, createShapeId } from "tldraw";
import "tldraw/tldraw.css";
import {
  type WebpageNodeShape,
  WebpageNodeUtil,
} from "@/components/canvas/shapes/WebpageNodeUtil";

const HARD_CODED_NODE_ID = createShapeId("trail-webpage-node");

export function TrailCanvas() {
  return (
    <main className="fixed inset-0 bg-[#f4f1e8]">
      <Tldraw
        shapeUtils={[WebpageNodeUtil]}
        onMount={(editor) => {
          if (editor.getShape(HARD_CODED_NODE_ID)) {
            return;
          }

          editor.createShape<WebpageNodeShape>({
            id: HARD_CODED_NODE_ID,
            type: "webpage",
            x: 160,
            y: 120,
            props: {
              url: "https://www.wikipedia.org/",
              title: "Wikipedia",
              summary:
                "A hardcoded Trail webpage node proving that custom web artifacts can live directly on the canvas.",
              screenshotUrl:
                "https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/Wikipedia-logo.png/320px-Wikipedia-logo.png",
              mode: "screenshot",
            },
          });

          editor.select(HARD_CODED_NODE_ID);
          editor.zoomToSelection();
        }}
      />
    </main>
  );
}
