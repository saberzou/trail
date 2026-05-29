import { type IDBPDatabase, openDB } from "idb";

/**
 * Open a Trail IndexedDB database, ensuring the given object stores exist.
 *
 * Shared by canvas persistence, settings crypto-storage, and (in PR2) the chat
 * store, so we have a single place to evolve schema-upgrade behavior.
 */
export async function openTrailDb(
  dbName: string,
  storeNames: string | readonly string[],
  version = 1,
): Promise<IDBPDatabase> {
  const stores =
    typeof storeNames === "string" ? [storeNames] : Array.from(storeNames);
  return openDB(dbName, version, {
    upgrade(d) {
      for (const name of stores) {
        if (!d.objectStoreNames.contains(name)) {
          d.createObjectStore(name);
        }
      }
    },
  });
}
