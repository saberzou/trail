import { describe, expect, it, vi } from "vitest";
import { createDebouncedSaver } from "./saver";

describe("createDebouncedSaver", () => {
  it("calls save once after multiple triggers in the debounce window", async () => {
    const save = vi.fn(async () => {});
    let value = 0;
    const saver = createDebouncedSaver(() => ++value, save, 20);
    saver.trigger();
    saver.trigger();
    saver.trigger();
    await new Promise((r) => setTimeout(r, 60));
    expect(save).toHaveBeenCalledTimes(1);
    // getValue ran exactly once (when the timer fired), capturing the latest.
    expect(save).toHaveBeenCalledWith(1);
  });

  it("flush() forces an immediate save of the pending value", async () => {
    const save = vi.fn(async () => {});
    const saver = createDebouncedSaver(() => "x", save, 5000);
    saver.trigger();
    await saver.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("x");
  });

  it("flush() is a no-op when nothing is pending", async () => {
    const save = vi.fn(async () => {});
    const saver = createDebouncedSaver(() => "x", save, 50);
    await saver.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it("cancel() drops any pending save", async () => {
    const save = vi.fn(async () => {});
    const saver = createDebouncedSaver(() => "y", save, 30);
    saver.trigger();
    saver.cancel();
    await new Promise((r) => setTimeout(r, 60));
    expect(save).not.toHaveBeenCalled();
  });

  it("catches errors from save without unhandled rejection", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const save = vi.fn(async () => {
      throw new Error("boom");
    });
    const saver = createDebouncedSaver(() => 1, save, 10);
    saver.trigger();
    await new Promise((r) => setTimeout(r, 50));
    expect(save).toHaveBeenCalled();
    expect(errSpy).toHaveBeenCalledWith(
      "[trail] debounced save failed",
      expect.any(Error),
    );
    errSpy.mockRestore();
  });

  it("later triggers reset the debounce timer", async () => {
    const save = vi.fn(async () => {});
    const saver = createDebouncedSaver(() => 1, save, 40);
    saver.trigger();
    // Re-trigger inside the original window, the save should only fire after
    // the second window elapses.
    await new Promise((r) => setTimeout(r, 20));
    saver.trigger();
    await new Promise((r) => setTimeout(r, 30));
    expect(save).not.toHaveBeenCalled();
    await new Promise((r) => setTimeout(r, 30));
    expect(save).toHaveBeenCalledTimes(1);
  });
});
