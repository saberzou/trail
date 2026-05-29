/**
 * Generic debounced saver. Each `trigger()` resets the timer; the most recent
 * `getValue()` wins. `flush()` runs any pending save immediately. `cancel()`
 * drops any pending save without running it.
 *
 * Errors thrown from `save` are caught and logged, so callers don't surface
 * unhandled rejections when a write fails (IDB quota, transient corruption,
 * etc.). Shared by canvas + chat persistence to keep the debounce semantics
 * in one place.
 */
export function createDebouncedSaver<T>(
  getValue: () => T,
  save: (value: T) => Promise<void>,
  delayMs = 400,
): { trigger: () => void; flush: () => Promise<void>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = async () => {
    timer = null;
    try {
      await save(getValue());
    } catch (err) {
      console.error("[trail] debounced save failed", err);
    }
  };
  return {
    trigger() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, delayMs);
    },
    async flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
        await run();
      }
    },
    cancel() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    },
  };
}
