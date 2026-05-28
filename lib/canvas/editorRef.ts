import type { Editor } from "tldraw";

let currentEditor: Editor | null = null;

export function setCanvasEditor(editor: Editor | null): void {
  currentEditor = editor;
}

export function getCanvasEditor(): Editor | null {
  return currentEditor;
}
