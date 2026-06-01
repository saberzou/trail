import type { IDBPDatabase } from "idb";
import { openTrailDb } from "@/lib/idb/open";

const DB_NAME = "trail-canvas";
const DB_VERSION = 1;
const STORE = "snapshots";

/**
 * The IDB key used by Trail v1, before canvas state was scoped per-Trail.
 * The migration in `lib/trails/migrate.ts` reads this and re-keys it under a
 * real trail id. Kept exported so the migration and tests share the constant.
 */
export const LEGACY_KEY = "main";

// Loose type — we round-trip whatever `editor.store.getStoreSnapshot()` returns.
export type CanvasSnapshot = unknown;

async function db(): Promise<IDBPDatabase> {
  return openTrailDb(DB_NAME, STORE, DB_VERSION);
}

// Hash of the last snapshot we actually wrote, per trail, so we can skip no-op
// writes triggered by tldraw's listen() firing for incidental store mutations.
// Keyed by trailId because the module outlives a single canvas mount — without
// per-trail tracking, switching trails in one tab could wrongly dedup a write.
const lastHashByTrail = new Map<string, string>();

/**
 * FNV-1a 32-bit hash over a string. Not cryptographic — we only need a fast
 * same-vs-different fingerprint of the JSON-serialized snapshot, and avoiding
 * `node:crypto` lets this module work inside the client bundle.
 */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function hashSnapshot(snapshot: CanvasSnapshot): string {
  return fnv1a(JSON.stringify(snapshot));
}

/**
 * Seed the dedup hash from a snapshot we just loaded from disk. Without this,
 * the first trigger after `loadStoreSnapshot()` writes the same bytes back to
 * IDB because the per-trail hash is still unset.
 */
export function seedLastHash(trailId: string, snapshot: CanvasSnapshot): void {
  lastHashByTrail.set(trailId, hashSnapshot(snapshot));
}

/**
 * Pure predicate for the snapshot-dedup logic, exported so callers (and tests)
 * can reason about it without touching IDB.
 */
export function shouldSkipWrite(
  prevHash: string | null,
  nextHash: string,
): boolean {
  return prevHash !== null && prevHash === nextHash;
}

export async function saveSnapshot(
  trailId: string,
  snapshot: CanvasSnapshot,
): Promise<void> {
  const hash = hashSnapshot(snapshot);
  if (shouldSkipWrite(lastHashByTrail.get(trailId) ?? null, hash)) {
    return;
  }
  const d = await db();
  try {
    await d.put(STORE, snapshot, trailId);
    lastHashByTrail.set(trailId, hash);
  } finally {
    d.close();
  }
}

export async function loadSnapshot(
  trailId: string,
): Promise<CanvasSnapshot | null> {
  const d = await db();
  try {
    const row = await d.get(STORE, trailId);
    return (row as CanvasSnapshot | undefined) ?? null;
  } finally {
    d.close();
  }
}

/** Delete a single trail's canvas snapshot. Called when a trail is deleted. */
export async function wipeSnapshotFor(trailId: string): Promise<void> {
  lastHashByTrail.delete(trailId);
  const d = await db();
  try {
    await d.delete(STORE, trailId);
  } finally {
    d.close();
  }
}

/** Drop the entire canvas database. Used by tests and a full local reset. */
export async function wipeSnapshot(): Promise<void> {
  lastHashByTrail.clear();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    // Warn but don't hang when another tab holds the DB open.
    req.onblocked = () => {
      console.warn(
        "[trail] wipeSnapshot blocked — another tab holds the DB. Close other tabs and try again.",
      );
      resolve();
    };
  });
}
