"use client";

import { createShapeId, type TLShapePartial, Tldraw } from "tldraw";
import "tldraw/tldraw.css";
import {
  type WebpageNodeShape,
  WebpageNodeUtil,
} from "@/components/canvas/shapes/WebpageNodeUtil";

const HARD_CODED_NODES: TLShapePartial<WebpageNodeShape>[] = [
  {
    id: createShapeId("trail-webpage-wikipedia"),
    type: "webpage",
    x: 120,
    y: 120,
    props: {
      url: "https://www.wikipedia.org/",
      title: "Wikipedia",
      summary:
        "A live iframe example for pages that permit embedding directly inside Trail.",
      screenshotUrl:
        "https://upload.wikimedia.org/wikipedia/commons/thumb/6/63/Wikipedia-logo.png/320px-Wikipedia-logo.png",
      mode: "iframe",
    },
  },
  {
    id: createShapeId("trail-webpage-amazon"),
    type: "webpage",
    x: 500,
    y: 120,
    props: {
      url: "https://www.amazon.com/dp/B08N5WRWNW",
      title: "Amazon Product",
      summary:
        "A screenshot-mode card for pages that block iframes or are better represented by an archived capture.",
      screenshotUrl: "/amazon-product-placeholder.svg",
      mode: "screenshot",
    },
  },
  {
    id: createShapeId("trail-webpage-archive"),
    type: "webpage",
    x: 880,
    y: 120,
    props: {
      url: "/archive-demo.html",
      title: "Archived Trail Snapshot",
      summary:
        "A self-hosted HTML archive example served from this Next.js app origin.",
      screenshotUrl: "/amazon-product-placeholder.svg",
      mode: "archive",
    },
  },
];

export function TrailCanvas() {
  return (
    <main className="fixed inset-0 bg-[#f4f1e8]">
      <Tldraw
        shapeUtils={[WebpageNodeUtil]}
        onMount={(editor) => {
          const missingNodes = HARD_CODED_NODES.filter(
            (node) => !editor.getShape(node.id),
          );

          if (missingNodes.length > 0) {
            editor.createShapes<WebpageNodeShape>(missingNodes);
          }

          editor.select(...HARD_CODED_NODES.map((node) => node.id));
          editor.zoomToSelection({ animation: { duration: 240 } });
        }}
      />
    </main>
  );
}
