"use client";

import { useSettingsStore } from "../../../lib/settings/store";
import type { ProviderId } from "../../../lib/settings/types";

const LLM_PROVIDERS: Array<{ id: ProviderId; label: string }> = [
  { id: "openai", label: "OpenAI" },
  { id: "anthropic", label: "Anthropic" },
  { id: "gemini", label: "Google Gemini" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "copilot", label: "GitHub Copilot" },
];

const SEARCH_PROVIDERS: Array<{ id: ProviderId; label: string }> = [
  { id: "brave", label: "Brave Search" },
  { id: "tavily", label: "Tavily" },
];

export function DefaultsSection() {
  const settings = useSettingsStore((state) => state.settings);
  const setDefaultLlm = useSettingsStore((state) => state.setDefaultLlm);
  const setDefaultSearch = useSettingsStore((state) => state.setDefaultSearch);
  const configuredLlm = LLM_PROVIDERS.filter(
    (provider) => settings.providers[provider.id],
  );
  const configuredSearch = SEARCH_PROVIDERS.filter(
    (provider) => settings.providers[provider.id],
  );

  return (
    <div className="space-y-4 rounded border border-[#d9d8cc] bg-white p-4">
      <label className="block text-[#3d4238] text-sm">
        Default LLM
        <select
          className="mt-1 w-full rounded border border-[#c9c8bd] bg-white px-3 py-2 text-[#171814]"
          onChange={(event) =>
            void setDefaultLlm(
              (event.target.value || undefined) as ProviderId | undefined,
            )
          }
          value={
            settings.defaultLlm &&
            settings.providers[settings.defaultLlm] &&
            LLM_PROVIDERS.some(
              (provider) => provider.id === settings.defaultLlm,
            )
              ? settings.defaultLlm
              : ""
          }
        >
          <option value="">No default</option>
          {configuredLlm.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-[#3d4238] text-sm">
        Default search
        <select
          className="mt-1 w-full rounded border border-[#c9c8bd] bg-white px-3 py-2 text-[#171814]"
          onChange={(event) =>
            void setDefaultSearch(
              (event.target.value || undefined) as ProviderId | undefined,
            )
          }
          value={
            settings.defaultSearch &&
            settings.providers[settings.defaultSearch] &&
            SEARCH_PROVIDERS.some(
              (provider) => provider.id === settings.defaultSearch,
            )
              ? settings.defaultSearch
              : ""
          }
        >
          <option value="">No default</option>
          {configuredSearch.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
