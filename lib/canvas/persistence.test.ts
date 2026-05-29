import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as openModule from "@/lib/idb/open";
import {
  createDebouncedSaver,
  loadSnapshot,
  saveSnapshot,
  seedLastHash,
  shouldSkipWrite,
  wipeSnapshot,
} from "./persistence";

describe("canvas persistence", () => {
  beforeEach(async () => {
    await wipeSnapshot();
  });

  it("returns null when nothing is stored", async () => {
    expect(await loadSnapshot()).toBeNull();
  });

  it("round-trips a snapshot", async () => {
    const snap = {
      store: { "shape:abc": { id: "shape:abc", x: 1 } },
      schema: { v: 2 },
    };
    await saveSnapshot(snap);
    expect(await loadSnapshot()).toEqual(snap);
  });

  it("overwrites prior snapshot", async () => {
    await saveSnapshot({ a: 1 });
    await saveSnapshot({ a: 2 });
    expect(await loadSnapshot()).toEqual({ a: 2 });
  });

  it("debounces multiple triggers into a single save", async () => {
    let counter = 0;
    const saver = createDebouncedSaver(() => ({ n: ++counter }), 20);
    saver.trigger();
    saver.trigger();
    saver.trigger();
    await new Promise((r) => setTimeout(r, 60));
    expect(counter).toBe(1);
    expect(await loadSnapshot()).toEqual({ n: 1 });
  });

  it("flush persists pending snapshot immediately", async () => {
    const saver = createDebouncedSaver(() => ({ flushed: true }), 5000);
    saver.trigger();
    await saver.flush();
    expect(await loadSnapshot()).toEqual({ flushed: true });
  });

  it("cancel discards pending snapshot", async () => {
    const saver = createDebouncedSaver(() => ({ canceled: true }), 50);
    saver.trigger();
    saver.cancel();
    await new Promise((r) => setTimeout(r, 100));
    expect(await loadSnapshot()).toBeNull();
  });

  it("dedups identical snapshots end-to-end (counts real put() calls)", async () => {
    // Wrap openTrailDb so every returned DB's `put` is counted. This is the
    // production path — saveSnapshot calls openTrailDb internally — so the
    // counter actually reflects what hits IDB.
    let writeCount = 0;
    const realOpen = openModule.openTrailDb;
    const spy = vi
      .spyOn(openModule, "openTrailDb")
      .mockImplementation(async (...args) => {
        const d = await realOpen(...args);
        const realPut = d.put.bind(d);
        d.put = ((...putArgs: Parameters<typeof realPut>) => {
          writeCount++;
          return realPut(...putArgs);
        }) as typeof d.put;
        return d;
      });

    try {
      const A = { store: { "shape:a": { id: "shape:a", x: 1 } } };
      const B = { store: { "shape:a": { id: "shape:a", x: 2 } } };

      // A then A — dedup skips the second write.
      await saveSnapshot(A);
      await saveSnapshot(A);
      expect(writeCount).toBe(1);

      // A then B — distinct snapshot triggers a write.
      await saveSnapshot(B);
      expect(writeCount).toBe(2);

      // wipe resets lastHash; saving A again should land in IDB.
      await wipeSnapshot();
      await saveSnapshot(A);
      expect(writeCount).toBe(3);

      expect(await loadSnapshot()).toEqual(A);
    } finally {
      spy.mockRestore();
    }
  });

  it("shouldSkipWrite predicate skips equal hashes only", () => {
    expect(shouldSkipWrite(null, "abc")).toBe(false);
    expect(shouldSkipWrite("abc", "abc")).toBe(true);
    expect(shouldSkipWrite("abc", "def")).toBe(false);
  });

  it("seedLastHash skips a same-snapshot save after hydrate", async () => {
    let writeCount = 0;
    const realOpen = openModule.openTrailDb;
    const spy = vi
      .spyOn(openModule, "openTrailDb")
      .mockImplementation(async (...args) => {
        const d = await realOpen(...args);
        const realPut = d.put.bind(d);
        d.put = ((...putArgs: Parameters<typeof realPut>) => {
          writeCount++;
          return realPut(...putArgs);
        }) as typeof d.put;
        return d;
      });
    try {
      const A = { store: { "shape:a": { id: "shape:a", x: 1 } } };
      // Simulate: we just loaded A from IDB and seeded the dedup hash.
      seedLastHash(A);
      // First trigger after hydrate with the unchanged snapshot must be a no-op.
      await saveSnapshot(A);
      expect(writeCount).toBe(0);
      // A change still writes.
      await saveSnapshot({ ...A, more: 1 });
      expect(writeCount).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});
