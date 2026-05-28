import { COPILOT_EDITOR_VERSION } from "../../../../lib/providers/copilot";

export async function POST(request: Request) {
  const { githubAccessToken } = (await request.json()) as {
    githubAccessToken: string;
  };
  const upstream = await fetch(
    "https://api.github.com/copilot_internal/v2/token",
    {
      headers: {
        Authorization: `token ${githubAccessToken}`,
        "Editor-Version": COPILOT_EDITOR_VERSION,
      },
    },
  );
  return passthrough(upstream);
}

async function passthrough(upstream: Response) {
  return new Response(await upstream.text(), {
    headers: {
      "Content-Type":
        upstream.headers.get("Content-Type") ?? "application/json",
    },
    status: upstream.status,
  });
}
