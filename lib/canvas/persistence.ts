import { type IDBPDatabase, openDB } from "idb";

const DB_NAME = "trail-canvas";
const DB_VERSION = 1;
const STORE = "snapshots";
const KEY = "main";

// Loose type — we round-trip whatever `editor.store.getStoreSnapshot()` returns.
export type CanvasSnapshot = unknown;

async function db(): Promise<IDBPDatabase> {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(d) {
      if (!d.objectStoreNames.contains(STORE)) {
        d.createObjectStore(STORE);
      }
    },
  });
}

export async function saveSnapshot(snapshot: CanvasSnapshot): Promise<void> {
  const d = await db();
  try {
    await d.put(STORE, snapshot, KEY);
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
