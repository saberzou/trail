import type { IDBPDatabase } from "idb";
import { nanoid } from "nanoid";
import { wipeSnapshotFor } from "@/lib/canvas/persistence";
import { wipeChatFor } from "@/lib/chat/persistence";
import { openTrailDb } from "@/lib/idb/open";
import {
  type NewTrailInput,
  TRAIL_COLOR_KEYS,
  type Trail,
  type TrailColor,
} from "./types";

const DB_NAME = "trail-projects";
const DB_VERSION = 1;
const STORE = "trails";

async function db(): Promise<IDBPDatabase> {
  return openTrailDb(DB_NAME, STORE, DB_VERSION);
}

function isTrail(v: unknown): v is Trail {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Trail).id === "string" &&
    typeof (v as Trail).name === "string"
  );
}

/** All trails, most-recently-opened first. */
export async function listTrails(): Promise<Trail[]> {
  const d = await db();
  try {
    const rows = (await d.getAll(STORE)) as unknown[];
    return rows.filter(isTrail).sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
  } finally {
    d.close();
  }
}

export async function getTrail(id: string): Promise<Trail | null> {
  const d = await db();
  try {
    const row = await d.get(STORE, id);
    return isTrail(row) ? row : null;
  } finally {
    d.close();
  }
}

/** Round-robin a default color when the caller doesn't pick one. */
function pickDefaultColor(existing: number): TrailColor {
  return TRAIL_COLOR_KEYS[existing % TRAIL_COLOR_KEYS.length];
}

export async function createTrail(input: NewTrailInput): Promise<Trail> {
  const now = Date.now();
  const d = await db();
  try {
    const count = await d.count(STORE);
    const trail: Trail = {
      id: nanoid(),
      name: input.name.trim() || "Untitled trail",
      description: input.description?.trim() ?? "",
      color: input.color ?? pickDefaultColor(count),
      createdAt: now,
      updatedAt: now,
      lastOpenedAt: now,
    };
    await d.put(STORE, trail, trail.id);
    return trail;
  } finally {
    d.close();
  }
}

/** Insert a fully-formed trail (used by the legacy-data migration). */
export async function putTrail(trail: Trail): Promise<void> {
  const d = await db();
  try {
    await d.put(STORE, trail, trail.id);
  } finally {
    d.close();
  }
}

export async function updateTrail(
  id: string,
  patch: Partial<
    Pick<Trail, "name" | "description" | "color" | "lastOpenedAt">
  >,
): Promise<Trail | null> {
  const d = await db();
  try {
    const existing = await d.get(STORE, id);
    if (!isTrail(existing)) return null;
    const next: Trail = {
      ...existing,
      ...patch,
      name:
        patch.name !== undefined
          ? patch.name.trim() || existing.name
          : existing.name,
      // Bump updatedAt unless this is purely a lastOpenedAt touch.
      updatedAt:
        patch.lastOpenedAt !== undefined && Object.keys(patch).length === 1
          ? existing.updatedAt
          : Date.now(),
    };
    await d.put(STORE, next, id);
    return next;
  } finally {
    d.close();
  }
}

/** Record that a trail was just opened, for "Recent" ordering. */
export async function touchTrail(id: string): Promise<void> {
  await updateTrail(id, { lastOpenedAt: Date.now() });
}

/**
 * Delete a trail and all of its workspace state (canvas snapshot + chat
 * history). Best-effort on the per-trail stores — a missing key is fine.
 */
export async function deleteTrail(id: string): Promise<void> {
  const d = await db();
  try {
    await d.delete(STORE, id);
  } finally {
    d.close();
  }
  await Promise.allSettled([wipeSnapshotFor(id), wipeChatFor(id)]);
}
