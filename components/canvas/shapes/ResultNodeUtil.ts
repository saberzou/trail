import { createElement } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  type RecordProps,
  T,
  type TLBaseShape,
} from "tldraw";
import { ResultNodeBody } from "@/components/canvas/shapes/ResultNode";

export type ResultNodeSource = "search" | "fetch";

export type ResultNodeShape = TLBaseShape<
  "result",
  {
    w: number;
    h: number;
    title: string;
    url: string;
    summary: string;
    source: ResultNodeSource;
  }
>;

export class ResultNodeUtil extends BaseBoxShapeUtil<ResultNodeShape> {
  static override type = "result" as const;
  static override props: RecordProps<ResultNodeShape> = {
    w: T.number,
    h: T.number,
    title: T.string,
    url: T.string,
    summary: T.string,
    source: T.literalEnum("search", "fetch"),
  };

  override getDefaultProps(): ResultNodeShape["props"] {
    return {
      w: 320,
      h: 220,
      title: "Untitled",
      url: "",
      summary: "",
      source: "search",
    };
  }

  override canEdit = () => false;
  override canResize = () => true;
  override isAspectRatioLocked = () => false;

  override component(shape: ResultNodeShape) {
    return createElement(
      HTMLContainer,
      { style: { width: shape.props.w, height: shape.props.h } },
      createElement(ResultNodeBody, {
        title: shape.props.title,
        url: shape.props.url,
        summary: shape.props.summary,
        source: shape.props.source,
        onExploreSimilar: () => {
          /* wired in Task 5 */
        },
      }),
    );
  }

  override indicator(shape: ResultNodeShape) {
    return createElement("rect", {
      width: shape.props.w,
      height: shape.props.h,
      rx: 6,
    });
  }
}
