import { createElement } from "react";
import {
  BaseBoxShapeUtil,
  createShapeId,
  HTMLContainer,
  type RecordProps,
  T,
  type TLBaseShape,
} from "tldraw";
import { ResultNodeBody } from "@/components/canvas/shapes/ResultNode";
import { runPromptShape } from "@/lib/canvas/agentClient";
import type { PromptNodeShape } from "./PromptNodeUtil";

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
    const editor = this.editor;
    return createElement(
      HTMLContainer,
      { style: { width: shape.props.w, height: shape.props.h } },
      createElement(ResultNodeBody, {
        title: shape.props.title,
        url: shape.props.url,
        summary: shape.props.summary,
        source: shape.props.source,
        onExploreSimilar: () => {
          const seeded =
            `Find pages similar to: "${shape.props.title}" (${shape.props.url}). ` +
            "Surface different sources and different angles.";
          const newId = createShapeId(`prompt-${crypto.randomUUID()}`);
          editor.createShape<PromptNodeShape>({
            id: newId,
            type: "prompt",
            x: shape.x + shape.props.w + 80,
            y: shape.y + shape.props.h + 60,
            props: {
              w: 280,
              h: 160,
              prompt: seeded,
              status: "idle",
            },
          });
          // Auto-run after the shape is committed.
          queueMicrotask(() => {
            void runPromptShape(editor, newId);
          });
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
