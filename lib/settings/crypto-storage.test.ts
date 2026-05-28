import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { loadEncrypted, saveEncrypted, wipeEncrypted } from "./crypto-storage";

describe("crypto-storage", () => {
  beforeEach(async () => {
    await wipeEncrypted();
  });

  it("returns null when nothing stored", async () => {
    expect(await loadEncrypted()).toBeNull();
  });

  it("round-trips an object", async () => {
    await saveEncrypted({ hello: "world", n: 42 });
    expect(await loadEncrypted()).toEqual({ hello: "world", n: 42 });
  });

  it("wipe clears everything", async () => {
    await saveEncrypted({ a: 1 });
    await wipeEncrypted();
    expect(await loadEncrypted()).toBeNull();
  });

  it("ciphertext on disk is not the plaintext", async () => {
    await saveEncrypted({ secret: "sk-supersecret-12345" });
    const { openDB } = await import("idb");
    const db = await openDB("trail", 1);
    const row = await db.get("blob", "settings");
    const bytes = new Uint8Array(row.ciphertext);
    const asText = new TextDecoder().decode(bytes);
    expect(asText).not.toContain("supersecret");
  });
});
