import { createElement } from "react";
import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type TLBaseShape,
} from "tldraw";
import { WebpageNode } from "@/components/canvas/shapes/WebpageNode";

/**
 * Render mode for a webpage tile.
 *
 * - "iframe": embed the live URL in a sandboxed iframe. Cheap, always fresh.
 *   Gets blocked by X-Frame-Options/CSP frame-ancestors on most modern sites.
 * - "screenshot": fetch a PNG from the local renderer sidecar. Survives auth
 *   walls and CSP. Stale relative to the live page.
 * - "link": no preview, just a rich link card. Used when both iframe and
 *   screenshot fail (auth-walled, paywalled, or the sidecar is unavailable).
 */
export type WebpageNodeMode = "iframe" | "screenshot" | "link";

/**
 * Per-tile completion state, surfaced as a done-toggle in the tile header.
 * Meant for task-flow steps but available on any tile. Optional so older
 * persisted snapshots (which predate it) still validate — a missing value
 * reads as "todo".
 */
export type WebpageNodeStepState = "todo" | "done";

export type WebpageNodeShape = TLBaseShape<
  "webpage",
  {
    w: number;
    h: number;
    url: string;
    title: string;
    hostname: string;
    mode: WebpageNodeMode;
    summary?: string;
    stepState?: WebpageNodeStepState;
  }
>;

const DEFAULT_W = 360;
const DEFAULT_H = 280;

export class WebpageNodeUtil extends ShapeUtil<WebpageNodeShape> {
  static override type = "webpage" as const;

  static override props = {
    w: T.number,
    h: T.number,
    url: T.string,
    title: T.string,
    hostname: T.string,
    mode: T.literalEnum("iframe", "screenshot", "link"),
    summary: T.optional(T.string),
    stepState: T.optional(T.literalEnum("todo", "done")),
  };

  override canResize = () => true;
  override canEdit = () => false;

  override getDefaultProps(): WebpageNodeShape["props"] {
    return {
      w: DEFAULT_W,
      h: DEFAULT_H,
      url: "",
      title: "",
      hostname: "",
      mode: "screenshot",
    };
  }

  override getGeometry(shape: WebpageNodeShape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  override component(shape: WebpageNodeShape) {
    return createElement(
      HTMLContainer,
      {
        style: { width: shape.props.w, height: shape.props.h },
      },
      createElement(WebpageNode, { shape }),
    );
  }

  override indicator(shape: WebpageNodeShape) {
    return createElement("rect", {
      width: shape.props.w,
      height: shape.props.h,
      rx: 8,
      ry: 8,
    });
  }
}
