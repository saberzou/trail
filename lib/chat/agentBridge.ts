/**
 * Thin shim around `runSessionTurn` so ChatPanel has one mockable function to
 * import — and so the heavy `tldraw`/`Editor` types don't leak into the
 * component's render tree. Tests mock this module to script the agent's
 * SessionEvents without needing to fake a real fetch body.
 */

import type { Editor } from "tldraw";
import type { SessionRequest } from "@/lib/agent/session";
import {
  type RunSessionCallbacks,
  runSessionTurn,
} from "@/lib/canvas/agentClient";

export async function runAgentTurn(
  editor: Editor,
  req: SessionRequest,
  signal: AbortSignal,
  callbacks?: RunSessionCallbacks,
): Promise<void> {
  return runSessionTurn(editor, req, signal, callbacks);
}
