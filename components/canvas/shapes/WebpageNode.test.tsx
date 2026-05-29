// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setCanvasEditor } from "@/lib/canvas/editorRef";
import { WebpageNode } from "./WebpageNode";
import type { WebpageNodeShape } from "./WebpageNodeUtil";

function makeShape(
  overrides: Partial<WebpageNodeShape["props"]> = {},
): WebpageNodeShape {
  return {
    id: "shape:test" as WebpageNodeShape["id"],
    typeName: "shape",
    type: "webpage",
    x: 0,
    y: 0,
    rotation: 0,
    index: "a1" as WebpageNodeShape["index"],
    parentId: "page:test" as WebpageNodeShape["parentId"],
    isLocked: false,
    opacity: 1,
    meta: {},
    props: {
      w: 360,
      h: 280,
      url: "https://example.com/page",
      title: "Example",
      hostname: "example.com",
      mode: "screenshot",
      ...overrides,
    },
  } as WebpageNodeShape;
}

describe("WebpageNode", () => {
  beforeEach(() => {
    // jsdom doesn't implement createObjectURL. Stub it before mount so the
    // screenshot path can construct a blob URL.
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:test"),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    setCanvasEditor(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders header with title, hostname badge, mode badge, Open button", () => {
    render(
      React.createElement(WebpageNode, {
        shape: makeShape({ mode: "link", title: "Hello world" }),
      }),
    );
    // "Hello world" appears in both the header span and (in link mode) the
    // card body h3 — both render the title for redundancy. We only need to
    // know it's in the DOM at least once.
    expect(screen.getAllByText("Hello world").length).toBeGreaterThan(0);
    expect(screen.getAllByText("example.com").length).toBeGreaterThan(0);
    expect(screen.getByText("link")).toBeInTheDocument();
    const openLinks = screen.getAllByRole("link", {
      name: /Open URL in new tab|Open in new tab/i,
    });
    expect(openLinks.length).toBeGreaterThan(0);
  });

  it("iframe mode renders an iframe with the locked sandbox", () => {
    const { container } = render(
      React.createElement(WebpageNode, {
        shape: makeShape({ mode: "iframe" }),
      }),
    );
    const iframe = container.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts allow-forms");
    expect(iframe?.getAttribute("src")).toBe("https://example.com/page");
  });

  it("screenshot mode fetches a blob and renders an <img src=blob:...>", async () => {
    const fakeBlob = new Blob([new Uint8Array([0x89, 0x50])], {
      type: "image/png",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(fakeBlob, {
            status: 200,
            headers: { "content-type": "image/png" },
          }),
      ),
    );
    const { container } = render(
      React.createElement(WebpageNode, {
        shape: makeShape({ mode: "screenshot" }),
      }),
    );
    await waitFor(() => {
      const img = container.querySelector("img");
      expect(img).not.toBeNull();
      expect(img?.getAttribute("src")).toMatch(/^blob:/);
    });
  });

  it("link mode renders title, hostname, and Open button in card body", () => {
    render(
      React.createElement(WebpageNode, {
        shape: makeShape({
          mode: "link",
          title: "Stripe checkout",
          summary: "A short summary.",
        }),
      }),
    );
    // Title is duplicated in the header and the card body — both should be present.
    expect(screen.getAllByText("Stripe checkout").length).toBeGreaterThan(0);
    // Summary appears in both the body's <p> and the link-mode footer.
    expect(screen.getAllByText("A short summary.").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("link", { name: "Open in new tab" }),
    ).toBeInTheDocument();
  });

  it("switchMode (via screenshot fetch failure) calls editor.updateShape", async () => {
    const updateShape = vi.fn();
    setCanvasEditor({
      updateShape,
    } as unknown as Parameters<typeof setCanvasEditor>[0]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    render(
      React.createElement(WebpageNode, {
        shape: makeShape({ mode: "screenshot" }),
      }),
    );
    await waitFor(() => {
      expect(updateShape).toHaveBeenCalled();
    });
    const arg = updateShape.mock.calls[0][0];
    expect(arg.type).toBe("webpage");
    expect(arg.props.mode).toBe("link");
  });

  it("iframe load-timeout falls back to screenshot mode", async () => {
    vi.useFakeTimers();
    const updateShape = vi.fn();
    setCanvasEditor({
      updateShape,
    } as unknown as Parameters<typeof setCanvasEditor>[0]);
    render(
      React.createElement(WebpageNode, {
        shape: makeShape({ mode: "iframe" }),
      }),
    );
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    vi.useRealTimers();
    expect(updateShape).toHaveBeenCalled();
    expect(updateShape.mock.calls[0][0].props.mode).toBe("screenshot");
  });
});
