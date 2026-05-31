import type { IDBPDatabase } from "idb";
import { openTrailDb } from "@/lib/idb/open";

const DB_NAME = "trail-chat";
const DB_VERSION = 1;
const STORE = "history";

/**
 * The IDB key used by Trail v1, before chat history was scoped per-Trail.
 * The migration in `lib/trails/migrate.ts` re-keys it under a real trail id.
 */
export const LEGACY_KEY = "main";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** Epoch milliseconds — sortable, JSON-friendly, no timezone fuss. */
  createdAt: number;
  /** Optional structured tag — used by the URL-paste path to remember which
   * canvas shape this message generated. */
  meta?: { kind: "url-tile"; nodeId?: string };
};

export type ChatHistory = { version: 1; messages: ChatMessage[] };

const EMPTY_HISTORY: ChatHistory = { version: 1, messages: [] };

async function db(): Promise<IDBPDatabase> {
  return openTrailDb(DB_NAME, STORE, DB_VERSION);
}

/**
 * Load a trail's chat history. Returns an empty history on a missing key OR on
 * a version mismatch — we don't try to migrate the record shape, we just
 * clean-load.
 */
export async function loadChat(trailId: string): Promise<ChatHistory> {
  const d = await db();
  try {
    const row = (await d.get(STORE, trailId)) as ChatHistory | undefined;
    if (!row || row.version !== 1 || !Array.isArray(row.messages)) {
      return { ...EMPTY_HISTORY };
    }
    return row;
  } finally {
    d.close();
  }
}

export async function saveChat(
  trailId: string,
  history: ChatHistory,
): Promise<void> {
  const d = await db();
  try {
    await d.put(STORE, history, trailId);
  } finally {
    d.close();
  }
}

/** Delete a single trail's chat history. Called when a trail is deleted. */
export async function wipeChatFor(trailId: string): Promise<void> {
  const d = await db();
  try {
    await d.delete(STORE, trailId);
  } finally {
    d.close();
  }
}

/** Drop the entire chat database. Used by tests and a full local reset. */
export async function wipeChat(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => {
      console.warn(
        "[trail] wipeChat blocked — another tab holds the DB. Close other tabs and try again.",
      );
      resolve();
    };
  });
}
