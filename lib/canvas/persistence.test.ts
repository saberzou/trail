import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as openModule from "@/lib/idb/open";
import {
  loadSnapshot,
  saveSnapshot,
  seedLastHash,
  shouldSkipWrite,
  wipeSnapshot,
  wipeSnapshotFor,
} from "./persistence";

const T = "trail-1";

describe("canvas persistence", () => {
  beforeEach(async () => {
    await wipeSnapshot();
  });

  it("returns null when nothing is stored", async () => {
    expect(await loadSnapshot(T)).toBeNull();
  });

  it("round-trips a snapshot", async () => {
    const snap = {
      store: { "shape:abc": { id: "shape:abc", x: 1 } },
      schema: { v: 2 },
    };
    await saveSnapshot(T, snap);
    expect(await loadSnapshot(T)).toEqual(snap);
  });

  it("overwrites prior snapshot", async () => {
    await saveSnapshot(T, { a: 1 });
    await saveSnapshot(T, { a: 2 });
    expect(await loadSnapshot(T)).toEqual({ a: 2 });
  });

  it("keeps separate trails isolated", async () => {
    await saveSnapshot("a", { store: { "shape:1": { id: "shape:1" } } });
    await saveSnapshot("b", { store: { "shape:2": { id: "shape:2" } } });
    expect(await loadSnapshot("a")).toEqual({
      store: { "shape:1": { id: "shape:1" } },
    });
    expect(await loadSnapshot("b")).toEqual({
      store: { "shape:2": { id: "shape:2" } },
    });
  });

  it("wipeSnapshotFor deletes only the given trail", async () => {
    await saveSnapshot("a", { a: 1 });
    await saveSnapshot("b", { b: 1 });
    await wipeSnapshotFor("a");
    expect(await loadSnapshot("a")).toBeNull();
    expect(await loadSnapshot("b")).toEqual({ b: 1 });
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
      await saveSnapshot(T, A);
      await saveSnapshot(T, A);
      expect(writeCount).toBe(1);

      // A then B — distinct snapshot triggers a write.
      await saveSnapshot(T, B);
      expect(writeCount).toBe(2);

      // wipe resets lastHash; saving A again should land in IDB.
      await wipeSnapshot();
      await saveSnapshot(T, A);
      expect(writeCount).toBe(3);

      expect(await loadSnapshot(T)).toEqual(A);
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
      seedLastHash(T, A);
      // First trigger after hydrate with the unchanged snapshot must be a no-op.
      await saveSnapshot(T, A);
      expect(writeCount).toBe(0);
      // A change still writes.
      await saveSnapshot(T, { ...A, more: 1 });
      expect(writeCount).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});
