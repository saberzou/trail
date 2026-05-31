// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
    // Title appears once — in the header bar only. The link-mode body no
    // longer duplicates it (PR2c polish: hostname + summary + Open).
    expect(screen.getAllByText("Hello world").length).toBe(1);
    expect(screen.getAllByText("example.com").length).toBeGreaterThan(0);
    expect(screen.getByText("link")).toBeInTheDocument();
    const openLinks = screen.getAllByRole("link", {
      name: /Open URL in new tab|Open example\.com in new tab/i,
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

  it("link mode renders hostname + summary + compact Open button (no duplicated title)", () => {
    render(
      React.createElement(WebpageNode, {
        shape: makeShape({
          mode: "link",
          title: "Stripe checkout",
          summary: "A short summary.",
        }),
      }),
    );
    // Title appears once — in the header bar only. The card body no longer
    // duplicates it so 320×220 fallback tiles read cleanly.
    expect(screen.getAllByText("Stripe checkout").length).toBe(1);
    // Summary appears once in the body — the redundant footer is gone.
    expect(screen.getAllByText("A short summary.").length).toBe(1);
    // Button label collapsed to "Open ↗" so it survives small render scales.
    const open = screen.getByRole("link", {
      name: /Open example\.com in new tab/i,
    });
    expect(open).toBeInTheDocument();
    expect(open.textContent).toMatch(/Open\s+↗/);
  });

  it("link mode without a summary shows a muted 'No preview available' fallback", () => {
    render(
      React.createElement(WebpageNode, {
        shape: makeShape({ mode: "link", title: "Anything", summary: "" }),
      }),
    );
    expect(screen.getByText(/No preview available/i)).toBeInTheDocument();
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

  it("iframe onError event flips mode to screenshot", async () => {
    const updateShape = vi.fn();
    setCanvasEditor({
      updateShape,
    } as unknown as Parameters<typeof setCanvasEditor>[0]);
    const { container } = render(
      React.createElement(WebpageNode, {
        shape: makeShape({ mode: "iframe" }),
      }),
    );
    // The native `error` listener is attached inside useEffect — wait for
    // the iframe to be mounted AND for the effect to bind the listener.
    const iframe = await waitFor(() => {
      const el = container.querySelector("iframe");
      expect(el).not.toBeNull();
      return el!;
    });
    await act(async () => {
      fireEvent.error(iframe);
    });
    expect(updateShape).toHaveBeenCalled();
    expect(updateShape.mock.calls[0][0].props.mode).toBe("screenshot");
  });

  it("screenshot mode revokes the blob URL on unmount", async () => {
    const fakeBlob = new Blob([new Uint8Array([0x89, 0x50])], {
      type: "image/png",
    });
    const revokeSpy = vi.fn();
    Object.assign(URL, {
      createObjectURL: vi.fn(() => "blob:revokable"),
      revokeObjectURL: revokeSpy,
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
    const { container, unmount } = render(
      React.createElement(WebpageNode, {
        shape: makeShape({ mode: "screenshot" }),
      }),
    );
    await waitFor(() => {
      expect(container.querySelector("img")?.getAttribute("src")).toMatch(
        /^blob:/,
      );
    });
    unmount();
    expect(revokeSpy).toHaveBeenCalledWith("blob:revokable");
  });

  it("screenshot fetch body includes the viewport dimensions", async () => {
    const fetchSpy = vi.fn(
      async () => new Response(new Blob(), { status: 500 }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    setCanvasEditor({
      updateShape: vi.fn(),
    } as unknown as Parameters<typeof setCanvasEditor>[0]);
    render(
      React.createElement(WebpageNode, {
        shape: makeShape({ mode: "screenshot" }),
      }),
    );
    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalled();
    });
    const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const init = call[1];
    expect(init).toBeDefined();
    const body = JSON.parse(init.body as string);
    expect(body.viewport).toEqual({ width: 1280, height: 720 });
  });

  it("link mode Open buttons carry target=_blank rel=noopener noreferrer", () => {
    render(
      React.createElement(WebpageNode, {
        shape: makeShape({ mode: "link", title: "Stripe checkout" }),
      }),
    );
    const links = screen.getAllByRole("link", {
      name: /Open URL in new tab|Open example\.com in new tab/i,
    });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });
});
