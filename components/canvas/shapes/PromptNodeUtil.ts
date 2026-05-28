import { BaseBoxShapeUtil, HTMLContainer, type RecordProps, type TLBaseShape, T } from "tldraw";
import { PromptNodeBody, type PromptStatus } from "./PromptNode";

export type PromptNodeShape = TLBaseShape<"prompt", {
  w: number;
  h: number;
  prompt: string;
  status: PromptStatus;
  error?: string;
  runId?: string;
}>;

export class PromptNodeUtil extends BaseBoxShapeUtil<PromptNodeShape> {
  static override type = "prompt" as const;
  static override props: RecordProps<PromptNodeShape> = {
    w: T.number, h: T.number, prompt: T.string,
    status: T.literalEnum("idle", "running", "done", "error"),
    error: T.string.optional(), runId: T.string.optional(),
  };

  override getDefaultProps(): PromptNodeShape["props"] {
    return { w: 280, h: 160, prompt: "", status: "idle" };
  }

  override canEdit = () => true;
  override canResize = () => true;
  override isAspectRatioLocked = () => false;

  override component(shape: PromptNodeShape) {
    const editor = this.editor;
    return (
      <HTMLContainer style={{ width: shape.props.w, height: shape.props.h }}>
        <PromptNodeBody
          prompt={shape.props.prompt}
          status={shape.props.status}
          error={shape.props.error}
          onChange={(prompt) => editor.updateShape<PromptNodeShape>({ id: shape.id, type: "prompt", props: { ...shape.props, prompt } })}
          onRun={() => { /* wired in Task 5 */ }}
          onKill={() => { /* wired in Task 5 */ }}
        />
      </HTMLContainer>
    );
  }

  override indicator(shape: PromptNodeShape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={6} />;
  }
}
