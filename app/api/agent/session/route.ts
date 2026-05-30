/**
 * Trust model for /api/agent/session:
 *
 * Trail is a Mac-only, single-user, local-first app. The Next.js dev server
 * binds to 127.0.0.1, so this route is reachable only from the same machine.
 * That loopback boundary is the *entire* auth story — there is no shared
 * secret, no auth header, no CSRF token. The user's provider API keys travel
 * from the browser in the POST body and we forward them to the configured
 * LLM / search providers. If you ever move Trail off-loopback (a hosted demo,
 * a Tailscale exposed endpoint), put a real auth layer in front of this route
 * before doing so.
 */

import type { NextRequest } from "next/server";
import {
  classifyError,
  runSession,
  type SessionRequest,
} from "@/lib/agent/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: SessionRequest;
  try {
    body = (await req.json()) as SessionRequest;
  } catch {
    return new Response(JSON.stringify({ error: "invalid json" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  // Minimal shape check. Anything finer-grained is up to the runner.
  if (
    !body ||
    typeof body !== "object" ||
    !body.providerId ||
    !body.apiKey ||
    !Array.isArray(body.messages) ||
    body.messages.length === 0
  ) {
    return new Response(JSON.stringify({ error: "missing fields" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  // canvasContext defaults to []; the runner caps it at 10.
  if (!Array.isArray(body.canvasContext)) {
    body.canvasContext = [];
  }

  const encoder = new TextEncoder();
  const abort = new AbortController();
  req.signal.addEventListener("abort", () => abort.abort());

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of runSession(body, abort.signal)) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify(event)}\n\n`),
          );
        }
      } catch (err) {
        // Synchronous setup failures (bad provider id, AI SDK module
        // load errors, etc.) land here. Match the runner's error mapping
        // so we never ship a raw provider/SDK string downstream — those
        // strings can include prompts, URLs, or stack traces. Same fix
        // PR1 applied to the old route after review.
        console.error("[trail] agent session route error", err);
        const payload = { kind: "error", ...classifyError(err) };
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
        );
      } finally {
        controller.close();
      }
    },
    cancel() {
      abort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
