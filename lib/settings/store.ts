"use client";

import { create } from "zustand";
import { loadEncrypted, saveEncrypted, wipeEncrypted } from "./crypto-storage";
import type { ProviderConfig, ProviderId, TrailSettings } from "./types";

type State = {
  hydrated: boolean;
  settings: TrailSettings;
  setProvider: (id: ProviderId, cfg: ProviderConfig) => Promise<void>;
  clearProvider: (id: ProviderId) => Promise<void>;
  setDefaultLlm: (id: ProviderId | undefined) => Promise<void>;
  setDefaultSearch: (id: ProviderId | undefined) => Promise<void>;
  wipeAll: () => Promise<void>;
};

const initial: TrailSettings = { version: 1, providers: {} };

async function persist(next: TrailSettings) {
  await saveEncrypted(next);
}

export const useSettingsStore = create<State>()((set, get) => ({
  hydrated: false,
  settings: initial,
  setProvider: async (id, cfg) => {
    const next = {
      ...get().settings,
      providers: { ...get().settings.providers, [id]: cfg },
    };
    set({ settings: next });
    await persist(next);
  },
  clearProvider: async (id) => {
    const { [id]: _, ...rest } = get().settings.providers;
    const next = { ...get().settings, providers: rest };
    set({ settings: next });
    await persist(next);
  },
  setDefaultLlm: async (id) => {
    const next = { ...get().settings, defaultLlm: id };
    set({ settings: next });
    await persist(next);
  },
  setDefaultSearch: async (id) => {
    const next = { ...get().settings, defaultSearch: id };
    set({ settings: next });
    await persist(next);
  },
  wipeAll: async () => {
    set({ settings: initial });
    await wipeEncrypted();
  },
}));

// Tracks an in-flight hydration so concurrent callers (e.g. /canvas mounting
// ChatPanel while the user also opens /settings in a new tab) share the same
// disk read and resolve on the same setState. Cleared once the promise
// settles so a subsequent rehydrate (after wipeAll, say) still runs.
let hydratePromise: Promise<void> | null = null;

/**
 * Idempotent: returns immediately if the store is already hydrated, and
 * coalesces concurrent calls into a single disk read. Safe to call from
 * every page that needs settings without worrying about double-loads.
 */
export async function hydrateSettings(): Promise<void> {
  if (useSettingsStore.getState().hydrated) return;
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      const loaded = await loadEncrypted<TrailSettings>();
      useSettingsStore.setState({
        settings: loaded ?? initial,
        hydrated: true,
      });
    } finally {
      hydratePromise = null;
    }
  })();
  return hydratePromise;
}
