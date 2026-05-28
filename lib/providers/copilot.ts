import type { CopilotProvider } from "../settings/types";

export const COPILOT_CLIENT_ID = "Iv1.b507a08c87ecfe98";
export const COPILOT_EDITOR_VERSION = "trail/0.1";

type DeviceCodeResponse = {
  device_code: string;
  interval?: number;
  user_code: string;
  verification_uri: string;
};

type PollResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
  interval?: number;
};

type CopilotTokenResponse = {
  expires_at: number;
  token: string;
};

export type DeviceFlow = {
  deviceCode: string;
  interval: number;
  userCode: string;
  verificationUri: string;
};

export async function startDeviceFlow(): Promise<DeviceFlow> {
  const res = await fetch("/api/copilot/device-code", { method: "POST" });
  if (!res.ok) {
    throw new Error(`GitHub device flow failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as DeviceCodeResponse;
  return {
    deviceCode: data.device_code,
    interval: data.interval ?? 5,
    userCode: data.user_code,
    verificationUri: data.verification_uri,
  };
}

export async function pollForToken(
  deviceCode: string,
  interval: number,
): Promise<string> {
  let delayMs = interval * 1000;

  for (;;) {
    await sleep(delayMs);
    const res = await fetch("/api/copilot/poll", {
      body: JSON.stringify({ deviceCode }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const data = (await res.json()) as PollResponse;
    if (data.access_token) {
      return data.access_token;
    }
    if (data.error === "authorization_pending") {
      continue;
    }
    if (data.error === "slow_down") {
      delayMs += 5000;
      continue;
    }
    throw new Error(
      data.error_description ?? data.error ?? `HTTP ${res.status}`,
    );
  }
}

export async function refreshCopilotToken(
  githubToken: string,
): Promise<NonNullable<CopilotProvider["copilotToken"]>> {
  const res = await fetch("/api/copilot/token", {
    body: JSON.stringify({ githubAccessToken: githubToken }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (!res.ok) {
    throw new Error(`Copilot token failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as CopilotTokenResponse;
  return {
    expiresAt: toUnixMs(data.expires_at),
    token: data.token,
  };
}

export async function getCopilotToken(
  githubToken: string,
  cached?: CopilotProvider["copilotToken"],
): Promise<string> {
  if (cached && cached.expiresAt - Date.now() > 300_000) {
    return cached.token;
  }
  return (await refreshCopilotToken(githubToken)).token;
}

function toUnixMs(value: number) {
  return value < 10_000_000_000 ? value * 1000 : value;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
