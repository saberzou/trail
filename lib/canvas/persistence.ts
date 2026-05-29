import { createHash } from "node:crypto";
import type { IDBPDatabase } from "idb";
import { openTrailDb } from "@/lib/idb/open";

const DB_NAME = "trail-canvas";
const DB_VERSION = 1;
const STORE = "snapshots";
const KEY = "main";

// Loose type — we round-trip whatever `editor.store.getStoreSnapshot()` returns.
export type CanvasSnapshot = unknown;

async function db(): Promise<IDBPDatabase> {
  return openTrailDb(DB_NAME, STORE, DB_VERSION);
}

// Hash of the last snapshot we actually wrote, so we can skip no-op writes
// triggered by tldraw's listen() firing for incidental store mutations.
let lastHash: string | null = null;

function hashSnapshot(snapshot: CanvasSnapshot): string {
  return createHash("sha1").update(JSON.stringify(snapshot)).digest("hex");
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

export async function saveSnapshot(snapshot: CanvasSnapshot): Promise<void> {
  const hash = hashSnapshot(snapshot);
  if (shouldSkipWrite(lastHash, hash)) {
    return;
  }
  const d = await db();
  try {
    await d.put(STORE, snapshot, KEY);
    lastHash = hash;
  } finally {
    d.close();
  }
}

export async function loadSnapshot(): Promise<CanvasSnapshot | null> {
  const d = await db();
  try {
    const row = await d.get(STORE, KEY);
    return (row as CanvasSnapshot | undefined) ?? null;
  } finally {
    d.close();
  }
}

export async function wipeSnapshot(): Promise<void> {
  lastHash = null;
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}

/**
 * Build a debounced saver. Each call resets the timer; the most-recent snapshot
 * supplier wins. Returns the trigger and a `flush` helper for teardown.
 */
export function createDebouncedSaver(
  getSnapshot: () => CanvasSnapshot,
  delayMs = 400,
): { trigger: () => void; flush: () => Promise<void>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = async () => {
    timer = null;
    try {
      await saveSnapshot(getSnapshot());
    } catch (err) {
      console.error("[trail] canvas snapshot save failed", err);
    }
  };
  return {
    trigger() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, delayMs);
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        await run();
      }
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
