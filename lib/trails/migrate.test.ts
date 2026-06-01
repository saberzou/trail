import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  LEGACY_KEY as CANVAS_LEGACY,
  loadSnapshot,
} from "@/lib/canvas/persistence";
import { LEGACY_KEY as CHAT_LEGACY, loadChat } from "@/lib/chat/persistence";
import { openTrailDb } from "@/lib/idb/open";
import { migrateLegacyTrail } from "./migrate";
import { listTrails } from "./persistence";

async function wipe(name: string) {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(name);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

async function seedLegacyCanvas(snap: unknown) {
  const d = await openTrailDb("trail-canvas", "snapshots", 1);
  try {
    await d.put("snapshots", snap, CANVAS_LEGACY);
  } finally {
    d.close();
  }
}

async function seedLegacyChat(hist: unknown) {
  const d = await openTrailDb("trail-chat", "history", 1);
  try {
    await d.put("history", hist, CHAT_LEGACY);
  } finally {
    d.close();
  }
}

describe("legacy trail migration", () => {
  beforeEach(async () => {
    await wipe("trail-projects");
    await wipe("trail-canvas");
    await wipe("trail-chat");
  });

  it("does nothing when there is no legacy data", async () => {
    const trail = await migrateLegacyTrail();
    expect(trail).toBeNull();
    expect(await listTrails()).toEqual([]);
  });

  it("folds legacy canvas + chat into a new trail and clears the old keys", async () => {
    const snap = { store: { "shape:1": { id: "shape:1", x: 5 } } };
    const hist = {
      version: 1,
      messages: [{ id: "m1", role: "user", text: "hi", createdAt: 1 }],
    };
    await seedLegacyCanvas(snap);
    await seedLegacyChat(hist);

    const trail = await migrateLegacyTrail();
    expect(trail).not.toBeNull();
    if (!trail) return;

    // The trail now exists, and its workspace holds the migrated data.
    expect((await listTrails()).length).toBe(1);
    expect(await loadSnapshot(trail.id)).toEqual(snap);
    expect((await loadChat(trail.id)).messages[0].text).toBe("hi");

    // Legacy keys were removed.
    const canvasDb = await openTrailDb("trail-canvas", "snapshots", 1);
    const chatDb = await openTrailDb("trail-chat", "history", 1);
    try {
      expect(await canvasDb.get("snapshots", CANVAS_LEGACY)).toBeUndefined();
      expect(await chatDb.get("history", CHAT_LEGACY)).toBeUndefined();
    } finally {
      canvasDb.close();
      chatDb.close();
    }
  });

  it("is a no-op when a trail already exists (runs once)", async () => {
    await seedLegacyCanvas({ store: { "shape:1": { id: "shape:1" } } });
    const first = await migrateLegacyTrail();
    expect(first).not.toBeNull();

    // Second run sees an existing trail and bails.
    const second = await migrateLegacyTrail();
    expect(second).toBeNull();
    expect((await listTrails()).length).toBe(1);
  });

  it("ignores an empty legacy canvas with no shapes", async () => {
    await seedLegacyCanvas({ store: {} });
    const trail = await migrateLegacyTrail();
    expect(trail).toBeNull();
  });
});
