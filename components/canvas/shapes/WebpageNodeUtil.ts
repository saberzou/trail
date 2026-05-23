import {
  HTMLContainer,
  Rectangle2d,
  ShapeUtil,
  T,
  type TLBaseShape,
} from "tldraw";
import { WebpageNode } from "@/components/canvas/shapes/WebpageNode";

export type WebpageNodeMode = "iframe" | "screenshot" | "archive";

export type WebpageNodeShape = TLBaseShape<
  "webpage",
  {
    url: string;
    title: string;
    summary: string;
    screenshotUrl: string;
    mode: WebpageNodeMode;
  }
>;

const WIDTH = 320;
const HEIGHT = 240;

export class WebpageNodeUtil extends ShapeUtil<WebpageNodeShape> {
  static override type = "webpage" as const;

  static override props = {
    url: T.string,
    title: T.string,
    summary: T.string,
    screenshotUrl: T.string,
    mode: T.literalEnum("iframe", "screenshot", "archive"),
  };

  override getDefaultProps(): WebpageNodeShape["props"] {
    return {
      url: "https://www.wikipedia.org/",
      title: "Untitled page",
      summary: "No summary has been generated for this page yet.",
      screenshotUrl: "",
      mode: "screenshot",
    };
  }

  override getGeometry() {
    return new Rectangle2d({
      width: WIDTH,
      height: HEIGHT,
      isFilled: true,
    });
  }

  override component(shape: WebpageNodeShape) {
    return (
      <HTMLContainer style={{ height: HEIGHT, width: WIDTH }}>
        <WebpageNode shape={shape} />
      </HTMLContainer>
    );
  }

  override indicator() {
    return <rect height={HEIGHT} rx={12} ry={12} width={WIDTH} />;
  }
}
