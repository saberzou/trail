import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createDebouncedSaver,
  loadSnapshot,
  saveSnapshot,
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
});
