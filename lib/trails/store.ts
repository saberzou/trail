"use client";

import { create } from "zustand";
import { migrateLegacyTrail } from "./migrate";
import {
  createTrail,
  deleteTrail,
  listTrails,
  touchTrail,
  updateTrail,
} from "./persistence";
import type { NewTrailInput, Trail, TrailColor } from "./types";

type State = {
  hydrated: boolean;
  trails: Trail[];
  create: (input: NewTrailInput) => Promise<Trail>;
  rename: (
    id: string,
    patch: { name?: string; description?: string; color?: TrailColor },
  ) => Promise<void>;
  remove: (id: string) => Promise<void>;
  touch: (id: string) => Promise<void>;
};

function sortTrails(trails: Trail[]): Trail[] {
  return [...trails].sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
}

export const useTrailsStore = create<State>()((set, get) => ({
  hydrated: false,
  trails: [],
  create: async (input) => {
    const trail = await createTrail(input);
    set({ trails: sortTrails([trail, ...get().trails]) });
    return trail;
  },
  rename: async (id, patch) => {
    const next = await updateTrail(id, patch);
    if (!next) return;
    set({
      trails: sortTrails(get().trails.map((t) => (t.id === id ? next : t))),
    });
  },
  remove: async (id) => {
    await deleteTrail(id);
    set({ trails: get().trails.filter((t) => t.id !== id) });
  },
  touch: async (id) => {
    await touchTrail(id);
    set({
      trails: sortTrails(
        get().trails.map((t) =>
          t.id === id ? { ...t, lastOpenedAt: Date.now() } : t,
        ),
      ),
    });
  },
}));

let hydratePromise: Promise<void> | null = null;

/**
 * Idempotent hydration: runs the one-time legacy migration, then loads all
 * trails into the store. Concurrent callers share a single read.
 */
export async function hydrateTrails(): Promise<void> {
  if (useTrailsStore.getState().hydrated) return;
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    try {
      await migrateLegacyTrail();
      const trails = await listTrails();
      useTrailsStore.setState({ trails: sortTrails(trails), hydrated: true });
    } finally {
      hydratePromise = null;
    }
  })();
  return hydratePromise;
}
