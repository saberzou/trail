// @vitest-environment jsdom
//
// Minimal test for TrailCanvas — focuses on the contract we care about
// post the "default tool = hand" + "hide StylePanel" UX fix:
//   1. onMount calls editor.setCurrentTool("hand") after snapshot load.
//   2. The Tldraw element receives a `components` prop with StylePanel
//      explicitly nulled (the tldraw v3 hook for hiding that toolbar).
//
// We mock tldraw to a tiny stub component that captures the onMount /
// components props so we can assert on them without booting the real
// editor in jsdom.
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let lastTldrawProps: {
  onMount?: (editor: FakeEditor) => void;
  components?: Record<string, unknown>;
} | null = null;

type FakeEditor = {
  setCurrentTool: ReturnType<typeof vi.fn>;
  store: {
    loadStoreSnapshot: ReturnType<typeof vi.fn>;
    getStoreSnapshot: ReturnType<typeof vi.fn>;
    listen: ReturnType<typeof vi.fn>;
  };
};

vi.mock("tldraw", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    // Tldraw renders nothing in tests; we just capture the props it was given.
    Tldraw: (props: Record<string, unknown>) => {
      lastTldrawProps = props as typeof lastTldrawProps;
      return React.createElement("div", { "data-testid": "tldraw-stub" });
    },
  };
});

// The canvas-snapshot loader hits IndexedDB; stub it to return "no snapshot".
vi.mock("@/lib/canvas/persistence", () => ({
  loadSnapshot: vi.fn(async () => null),
  saveSnapshot: vi.fn(async () => {}),
  seedLastHash: vi.fn(),
}));

vi.mock("@/lib/idb/saver", () => ({
  createDebouncedSaver: vi.fn(() => ({
    trigger: vi.fn(),
    flush: vi.fn(async () => {}),
  })),
}));

vi.mock("@/lib/canvas/editorRef", () => ({
  setCanvasEditor: vi.fn(),
}));

import { TrailCanvas } from "./TrailCanvas";

function makeFakeEditor(): FakeEditor {
  return {
    setCurrentTool: vi.fn(),
    store: {
      loadStoreSnapshot: vi.fn(),
      getStoreSnapshot: vi.fn(() => ({})),
      listen: vi.fn(() => () => {}),
    },
  };
}

describe("TrailCanvas", () => {
  beforeEach(() => {
    lastTldrawProps = null;
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("passes components prop with StylePanel hidden", async () => {
    render(React.createElement(TrailCanvas, { trailId: "test-trail" }));
    // The component renders a placeholder until loadSnapshot resolves;
    // flush microtasks so the gated useEffect resolves and Tldraw mounts.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(lastTldrawProps).not.toBeNull();
    expect(lastTldrawProps?.components).toBeDefined();
    // Explicit null tells tldraw to hide that UI region in v3.
    expect(lastTldrawProps?.components?.StylePanel).toBeNull();
  });

  it("defaults the current tool to 'hand' on mount", async () => {
    render(React.createElement(TrailCanvas, { trailId: "test-trail" }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const editor = makeFakeEditor();
    // Simulate tldraw calling onMount with a real editor.
    const onMount = lastTldrawProps?.onMount;
    if (typeof onMount !== "function") {
      throw new Error("expected Tldraw to receive an onMount prop");
    }
    act(() => {
      onMount(editor);
    });
    expect(editor.setCurrentTool).toHaveBeenCalledWith("hand");
  });
});
