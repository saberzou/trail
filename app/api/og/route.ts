import { makeFetchUrlTool } from "@/lib/agent/tools";

// Server-side share-preview (og:image) fetch — the same metadata chat apps
// unfurl, with NO Playwright renderer needed. Tiles call this so a pasted
// link or an agent-built cluster shows the site's own image even when the
// screenshot sidecar is offline.
//
// Reuses the SSRF-hardened fetch_url tool (private-range blocking, redirect
// caps, body limits), so this route can't be turned into an internal-network
// probe. Node runtime: the tool uses node:dns / undici.
export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  let url: string | undefined;
  try {
    const body = (await req.json()) as { url?: unknown };
    if (typeof body.url === "string") url = body.url;
  } catch {
    // fall through — handled below
  }
  if (!url) {
    return Response.json({ previewImage: null }, { status: 400 });
  }

  try {
    const tool = makeFetchUrlTool();
    // The tool ignores the call-context arg; pass a minimal stub.
    const result = (await tool.execute?.({ url }, {
      toolCallId: "og",
      messages: [],
    } as never)) as { previewImage?: string } | undefined;
    return Response.json({ previewImage: result?.previewImage ?? null });
  } catch {
    // Blocked URL, network error, parse failure — no preview, never a 500.
    return Response.json({ previewImage: null });
  }
}
