import type { ProviderConfig, ProviderId } from "../settings/types";
import { COPILOT_EDITOR_VERSION, getCopilotToken } from "./copilot";

export type TestResult = { ok: true } | { ok: false; error: string };

export async function testProvider(
  id: ProviderId,
  cfg: ProviderConfig,
): Promise<TestResult> {
  if (id === "copilot") {
    const cp = cfg as Extract<ProviderConfig, { kind: "copilot" }>;
    if (!cp.githubAccessToken) {
      return { ok: false, error: "Use Copilot device flow to authenticate" };
    }
    try {
      const token = await getCopilotToken(
        cp.githubAccessToken,
        cp.copilotToken,
      );
      const res = await fetch("https://api.githubcopilot.com/models", {
        headers: {
          Authorization: `Bearer ${token}`,
          "Editor-Version": COPILOT_EDITOR_VERSION,
        },
      });
      return res.ok ? { ok: true } : { ok: false, error: `HTTP ${res.status}` };
    } catch (error: unknown) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Network error",
      };
    }
  }
  const c = cfg as Extract<ProviderConfig, { kind: "api-key" }>;
  if (!c.apiKey?.trim()) {
    return { ok: false, error: "API key is required" };
  }
  try {
    const res = await fetchFor(id, c);
    if (res.ok) {
      return { ok: true };
    }
    return { ok: false, error: `HTTP ${res.status} ${res.statusText}` };
  } catch (error: unknown) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Network error",
    };
  }
}

function fetchFor(
  id: ProviderId,
  c: { apiKey: string; baseUrl?: string },
): Promise<Response> {
  switch (id) {
    case "openai":
      return fetch(`${c.baseUrl ?? "https://api.openai.com"}/v1/models`, {
        headers: { Authorization: `Bearer ${c.apiKey}` },
      });
    case "anthropic":
      return fetch("https://api.anthropic.com/v1/models", {
        headers: {
          "anthropic-version": "2023-06-01",
          "x-api-key": c.apiKey,
        },
      });
    case "gemini":
      return fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(c.apiKey)}`,
      );
    case "deepseek":
      return fetch("https://api.deepseek.com/models", {
        headers: { Authorization: `Bearer ${c.apiKey}` },
      });
    case "brave":
      return fetch(
        "https://api.search.brave.com/res/v1/web/search?q=test&count=1",
        {
          headers: {
            Accept: "application/json",
            "X-Subscription-Token": c.apiKey,
          },
        },
      );
    case "tavily":
      return fetch("https://api.tavily.com/search", {
        body: JSON.stringify({
          api_key: c.apiKey,
          max_results: 1,
          query: "test",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
    default:
      throw new Error(`unknown provider ${id}`);
  }
}
