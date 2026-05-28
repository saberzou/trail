export type ProviderId =
  | "openai"
  | "anthropic"
  | "gemini"
  | "deepseek"
  | "copilot"
  | "brave"
  | "tavily";

export type ApiKeyProvider = {
  kind: "api-key";
  apiKey: string;
  baseUrl?: string;
};

export type CopilotProvider = {
  kind: "copilot";
  githubAccessToken: string;
  copilotToken?: {
    token: string;
    expiresAt: number;
  };
};

export type ProviderConfig = ApiKeyProvider | CopilotProvider;

export type TrailSettings = {
  version: 1;
  providers: Partial<Record<ProviderId, ProviderConfig>>;
  defaultLlm?: ProviderId;
  defaultSearch?: ProviderId;
};

export const SETTINGS_STORAGE_KEY = "trail.settings.v1";
