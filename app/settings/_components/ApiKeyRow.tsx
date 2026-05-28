"use client";

import { useState } from "react";
import { testProvider } from "../../../lib/providers/test";
import { maskKey } from "../../../lib/settings/mask";
import { useSettingsStore } from "../../../lib/settings/store";
import type { ApiKeyProvider, ProviderId } from "../../../lib/settings/types";

type ApiKeyProviderId = Exclude<ProviderId, "copilot">;

type ApiKeyRowProps = {
  providerId: ApiKeyProviderId;
  label: string;
  placeholder?: string;
  baseUrlField?: boolean;
};

export function ApiKeyRow({
  providerId,
  label,
  placeholder = "Paste API key",
  baseUrlField = false,
}: ApiKeyRowProps) {
  const saved = useSettingsStore(
    (state) => state.settings.providers[providerId],
  ) as ApiKeyProvider | undefined;
  const setProvider = useSettingsStore((state) => state.setProvider);
  const clearProvider = useSettingsStore((state) => state.clearProvider);
  const [apiKey, setApiKey] = useState(saved?.apiKey ?? "");
  const [baseUrl, setBaseUrl] = useState(saved?.baseUrl ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  async function edit() {
    await clearProvider(providerId);
    setApiKey("");
    setBaseUrl("");
    setStatus(null);
  }

  async function save() {
    await setProvider(providerId, {
      apiKey,
      baseUrl: baseUrl.trim() || undefined,
      kind: "api-key",
    });
    setStatus(`${label} credentials saved.`);
  }

  async function clear() {
    await clearProvider(providerId);
    setApiKey("");
    setBaseUrl("");
    setStatus(null);
  }

  async function testConnection() {
    setTesting(true);
    setStatus(null);
    const result = await testProvider(providerId, {
      apiKey: saved?.apiKey ?? apiKey,
      baseUrl: saved?.baseUrl ?? (baseUrl.trim() || undefined),
      kind: "api-key",
    });
    setStatus(result.ok ? "✓ Connected" : `✗ ${result.error}`);
    setTesting(false);
  }

  return (
    <div className="space-y-3 rounded border border-[#d9d8cc] bg-white p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h3 className="font-medium text-[#171814]">{label}</h3>
          {saved ? (
            <p className="mt-1 text-[#5d6256] text-sm">Credentials saved.</p>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {saved ? (
            <button
              className="rounded border border-[#c9c8bd] px-3 py-1 text-sm hover:bg-[#f0f0e8]"
              onClick={edit}
              type="button"
            >
              Edit
            </button>
          ) : (
            <button
              className="rounded border border-[#c9c8bd] px-3 py-1 text-sm hover:bg-[#f0f0e8]"
              onClick={save}
              type="button"
            >
              Save {label}
            </button>
          )}
          <button
            className="rounded border border-[#c9c8bd] px-3 py-1 text-sm hover:bg-[#f0f0e8]"
            disabled={testing}
            onClick={testConnection}
            type="button"
          >
            {testing ? "Testing..." : "Test connection"}
          </button>
          <button
            aria-label={`Clear ${label}`}
            className="rounded border border-[#c9c8bd] px-3 py-1 text-sm hover:bg-[#f0f0e8]"
            onClick={clear}
            type="button"
          >
            {saved ? "Remove" : `Clear ${label}`}
          </button>
        </div>
      </div>

      {saved ? (
        <div className="text-[#3d4238] text-sm">
          {label} API key
          <code className="mt-1 block rounded border border-[#c9c8bd] bg-[#fbfaf4] px-3 py-2 text-[#171814]">
            {maskKey(saved.apiKey)}
          </code>
        </div>
      ) : (
        <label className="block text-[#3d4238] text-sm">
          {label} API key
          <input
            className="mt-1 w-full rounded border border-[#c9c8bd] bg-white px-3 py-2 text-[#171814]"
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={placeholder}
            type="password"
            value={apiKey}
          />
        </label>
      )}

      {baseUrlField && !saved ? (
        <label className="block text-[#3d4238] text-sm">
          Base URL
          <input
            className="mt-1 w-full rounded border border-[#c9c8bd] bg-white px-3 py-2 text-[#171814]"
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder="https://api.openai.com"
            type="url"
            value={baseUrl}
          />
        </label>
      ) : null}

      {status ? (
        <p className="text-[#4c5145] text-sm" role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}
