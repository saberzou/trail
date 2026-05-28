import { COPILOT_CLIENT_ID } from "../../../../lib/providers/copilot";

export async function POST(request: Request) {
  const { deviceCode } = (await request.json()) as { deviceCode: string };
  const body = new URLSearchParams({
    client_id: COPILOT_CLIENT_ID,
    device_code: deviceCode,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });
  const upstream = await fetch("https://github.com/login/oauth/access_token", {
    body,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
    },
    method: "POST",
  });
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
