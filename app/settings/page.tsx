"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
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
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-border border-b">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <Button asChild size="sm" variant="ghost">
            <Link href="/">
              <ArrowLeft />
              Trails
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="inline-block size-4 rounded bg-primary"
            />
            <span className="font-serif font-semibold text-base">Trail</span>
          </div>
        </div>
      </header>

      <div className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-10">
        <header className="space-y-3">
          <p className="font-medium text-primary text-sm uppercase tracking-[0.18em]">
            Trail Settings
          </p>
          <div className="space-y-2">
            <h1 className="font-serif font-semibold text-3xl">
              Provider credentials
            </h1>
            <p className="text-muted-foreground text-sm">
              Keys never leave your browser.
            </p>
          </div>
        </header>

        <aside className="rounded-lg border border-amber-500/40 bg-amber-50/50 p-3 text-sm">
          <strong>Where your keys live:</strong> Browser only. Encrypted with
          AES-GCM using a non-extractable key in IndexedDB. This protects
          against someone reading your browser profile on disk, but{" "}
          <strong>not</strong> against malicious JavaScript running on this
          page. Don't paste keys here on a machine or network you don't trust.
        </aside>

        {hydrated ? (
          <>
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
              <Button
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
                variant="destructive"
              >
                Wipe all credentials
              </Button>
            </div>
          </>
        ) : (
          <div
            aria-live="polite"
            className="rounded-lg border border-border bg-card p-6 text-muted-foreground text-sm"
            role="status"
          >
            Loading saved credentials…
          </div>
        )}
      </div>
    </main>
  );
}
