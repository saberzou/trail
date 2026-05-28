"use client";

import { useEffect } from "react";
import { hydrateSettings, useSettingsStore } from "../../lib/settings/store";
import { ApiKeyRow } from "./_components/ApiKeyRow";
import { CopilotRow } from "./_components/CopilotRow";
import { DefaultsSection } from "./_components/DefaultsSection";
import { SectionHeader } from "./_components/SectionHeader";

export default function SettingsPage() {
  const hydrated = useSettingsStore((state) => state.hydrated);
  const wipeAll = useSettingsStore((state) => state.wipeAll);

  useEffect(() => {
    if (!hydrated && typeof indexedDB !== "undefined") {
      void hydrateSettings();
    }
  }, [hydrated]);

  return (
    <main className="min-h-screen bg-[#f7f7f2] px-6 py-10 text-[#171814]">
      <div className="mx-auto flex max-w-2xl flex-col gap-8">
        <header className="space-y-3">
          <p className="font-medium text-[#5f6f52] text-sm uppercase tracking-[0.18em]">
            Trail Settings
          </p>
          <div className="space-y-2">
            <h1 className="font-semibold text-3xl">Provider credentials</h1>
            <p className="text-[#4c5145] text-sm">
              Keys never leave your browser.
            </p>
          </div>
        </header>

        <aside className="rounded border border-amber-500/40 bg-amber-50/50 p-3 text-sm">
          <strong>Where your keys live:</strong> Browser only. Encrypted with
          AES-GCM using a non-extractable key in IndexedDB. This protects
          against someone reading your browser profile on disk, but{" "}
          <strong>not</strong> against malicious JavaScript running on this
          page. Don't paste keys here on a machine or network you don't trust.
        </aside>

        <section className="space-y-4">
          <SectionHeader
            description="Connect LLM providers for future Trail agent runs."
            title="AI Providers"
          />
          <div className="space-y-3">
            <ApiKeyRow baseUrlField label="OpenAI" providerId="openai" />
            <ApiKeyRow label="Anthropic" providerId="anthropic" />
            <ApiKeyRow label="Google Gemini" providerId="gemini" />
            <ApiKeyRow label="DeepSeek" providerId="deepseek" />
            <CopilotRow />
          </div>
        </section>

        <section className="space-y-4">
          <SectionHeader
            description="Connect search providers for future web research."
            title="Search Providers"
          />
          <div className="space-y-3">
            <ApiKeyRow label="Brave Search" providerId="brave" />
            <ApiKeyRow label="Tavily" providerId="tavily" />
          </div>
        </section>

        <section className="space-y-4">
          <SectionHeader
            description="Pick default providers after credentials are saved."
            title="Defaults"
          />
          <DefaultsSection />
        </section>

        <div>
          <button
            className="rounded border border-red-500 px-3 py-1 text-red-600 hover:bg-red-50"
            onClick={async () => {
              if (
                !confirm(
                  "Delete ALL stored credentials? This cannot be undone.",
                )
              ) {
                return;
              }
              await wipeAll();
            }}
            type="button"
          >
            Wipe all credentials
          </button>
        </div>
      </div>
    </main>
  );
}
