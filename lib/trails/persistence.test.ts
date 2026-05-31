import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { loadSnapshot, saveSnapshot } from "@/lib/canvas/persistence";
import { loadChat, saveChat } from "@/lib/chat/persistence";
import {
  createTrail,
  deleteTrail,
  getTrail,
  listTrails,
  touchTrail,
  updateTrail,
} from "./persistence";

async function clearTrailsDb() {
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase("trail-projects");
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}

describe("trails persistence", () => {
  beforeEach(async () => {
    await clearTrailsDb();
  });

  it("creates a trail with sensible defaults", async () => {
    const t = await createTrail({ name: "  Trip to Japan  " });
    expect(t.id).toBeTruthy();
    expect(t.name).toBe("Trip to Japan");
    expect(t.description).toBe("");
    expect(t.color).toBeTruthy();
    expect(t.createdAt).toBeGreaterThan(0);

    const fetched = await getTrail(t.id);
    expect(fetched?.name).toBe("Trip to Japan");
  });

  it("falls back to a placeholder name when blank", async () => {
    const t = await createTrail({ name: "   " });
    expect(t.name).toBe("Untitled trail");
  });

  it("lists trails most-recently-opened first", async () => {
    const a = await createTrail({ name: "A" });
    const b = await createTrail({ name: "B" });
    // Make `a` the most recently opened. Wait a tick so the touch timestamp is
    // strictly greater than b's creation time (same-ms collisions otherwise
    // make the sort order ambiguous).
    await new Promise((r) => setTimeout(r, 5));
    await touchTrail(a.id);
    const list = await listTrails();
    expect(list.map((t) => t.id)).toEqual([a.id, b.id]);
  });

  it("updates name/description/color and bumps updatedAt", async () => {
    const t = await createTrail({ name: "Old" });
    const before = t.updatedAt;
    await new Promise((r) => setTimeout(r, 2));
    const next = await updateTrail(t.id, {
      name: "New",
      description: "desc",
      color: "ochre",
    });
    expect(next?.name).toBe("New");
    expect(next?.description).toBe("desc");
    expect(next?.color).toBe("ochre");
    expect(next?.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it("touchTrail does not bump updatedAt", async () => {
    const t = await createTrail({ name: "X" });
    await new Promise((r) => setTimeout(r, 2));
    await touchTrail(t.id);
    const fetched = await getTrail(t.id);
    expect(fetched?.updatedAt).toBe(t.updatedAt);
    expect(fetched?.lastOpenedAt).toBeGreaterThanOrEqual(t.lastOpenedAt);
  });

  it("deleting a trail also clears its canvas + chat state", async () => {
    const t = await createTrail({ name: "Doomed" });
    await saveSnapshot(t.id, { store: { "shape:1": { id: "shape:1" } } });
    await saveChat(t.id, {
      version: 1,
      messages: [{ id: "m", role: "user", text: "hi", createdAt: 1 }],
    });

    await deleteTrail(t.id);

    expect(await getTrail(t.id)).toBeNull();
    expect(await loadSnapshot(t.id)).toBeNull();
    expect(await loadChat(t.id)).toEqual({ version: 1, messages: [] });
  });
});
