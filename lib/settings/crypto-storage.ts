import type { IDBPDatabase } from "idb";
import { openTrailDb } from "@/lib/idb/open";

const DB_NAME = "trail";
const DB_VERSION = 1;
const KEY_STORE = "keys";
const BLOB_STORE = "blob";
const KEY_ID = "settings-key";
const BLOB_ID = "settings";

type Stored = { iv: ArrayBuffer; ciphertext: ArrayBuffer };

async function db(): Promise<IDBPDatabase> {
  return openTrailDb(DB_NAME, [KEY_STORE, BLOB_STORE], DB_VERSION);
}

async function getOrCreateKey(): Promise<CryptoKey> {
  const d = await db();
  try {
    const existing = (await d.get(KEY_STORE, KEY_ID)) as CryptoKey | undefined;
    if (existing) {
      return existing;
    }
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    await d.put(KEY_STORE, key, KEY_ID);
    return key;
  } finally {
    d.close();
  }
}

export async function saveEncrypted(obj: unknown): Promise<void> {
  const key = await getOrCreateKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(obj));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    plaintext,
  );
  const d = await db();
  try {
    await d.put(
      BLOB_STORE,
      { iv: iv.buffer, ciphertext } satisfies Stored,
      BLOB_ID,
    );
  } finally {
    d.close();
  }
}

export async function loadEncrypted<T = unknown>(): Promise<T | null> {
  const d = await db();
  const row = (await d.get(BLOB_STORE, BLOB_ID)) as Stored | undefined;
  d.close();
  if (!row) {
    return null;
  }
  const key = await getOrCreateKey();
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(row.iv) },
      key,
      row.ciphertext,
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch {
    return null;
  }
}

export async function wipeEncrypted(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
    req.onblocked = () => resolve();
  });
}
