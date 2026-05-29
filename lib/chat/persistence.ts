import type { IDBPDatabase } from "idb";
import { openTrailDb } from "@/lib/idb/open";

const DB_NAME = "trail-chat";
const DB_VERSION = 1;
const STORE = "history";
const KEY = "main";

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
 * Load the chat history. Returns an empty history on a missing key OR on a
 * version mismatch — we don't try to migrate yet, we just clean-load. PR2a
 * is the first version that writes here so there's nothing to migrate.
 */
export async function loadChat(): Promise<ChatHistory> {
  const d = await db();
  try {
    const row = (await d.get(STORE, KEY)) as ChatHistory | undefined;
    if (!row || row.version !== 1 || !Array.isArray(row.messages)) {
      return { ...EMPTY_HISTORY };
    }
    return row;
  } finally {
    d.close();
  }
}

export async function saveChat(history: ChatHistory): Promise<void> {
  const d = await db();
  try {
    await d.put(STORE, history, KEY);
  } finally {
    d.close();
  }
}

export async function wipeChat(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}
