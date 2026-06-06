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

  it("renders header with title, hostname badge, mode badge, Open link", () => {
    render(
      React.createElement(WebpageNode, {
        shape: makeShape({ mode: "link", title: "Hello world" }),
      }),
    );
    // Title appears once — in the header bar only. The link-mode body
    // doesn't duplicate it (PR: simplify link body).
    expect(screen.getAllByText("Hello world").length).toBe(1);
    expect(screen.getAllByText("example.com").length).toBeGreaterThan(0);
    expect(screen.getByText("link")).toBeInTheDocument();
    // The header carries the single Open affordance now.
    const openLinks = screen.getAllByRole("link", {
      name: /Open URL in new tab/i,
    });
    expect(openLinks.length).toBe(1);
  });

  it("renders a done-toggle that flips stepState to 'done' via updateShape", () => {
    const updateShape = vi.fn();
    setCanvasEditor({
      updateShape,
    } as unknown as Parameters<typeof setCanvasEditor>[0]);
    render(
      React.createElement(WebpageNode, {
        shape: makeShape({ mode: "link", title: "Step one" }),
      }),
    );
    const toggle = screen.getByRole("button", { name: /mark step as done/i });
    fireEvent.click(toggle);
    expect(updateShape).toHaveBeenCalledTimes(1);
    expect(updateShape.mock.calls[0][0].props.stepState).toBe("done");
  });

  it("a done tile shows a struck-through title and offers to un-complete", () => {
    render(
      React.createElement(WebpageNode, {
        shape: makeShape({
          mode: "link",
          title: "Step one",
          stepState: "done",
        }),
      }),
    );
    expect(
      screen.getByRole("button", { name: /mark step as not done/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Step one").className).toMatch(/line-through/);
  });

  it("renders a favicon img in the header with the s2 favicon service URL", () => {
    const { container } = render(
      React.createElement(WebpageNode, {
        shape: makeShape({ mode: "link", hostname: "stripe.com" }),
      }),
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toContain("google.com/s2/favicons");
    expect(img?.getAttribute("src")).toContain("stripe.com");
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
      // The header's favicon is also an <img>; pick the screenshot one
      // by class (the favicon has shrink-0 / h-4, the screenshot covers).
      const img = container.querySelector("img.object-cover");
      expect(img).not.toBeNull();
      expect(img?.getAttribute("src")).toMatch(/^blob:/);
    });
  });

  it("link mode renders hostname + summary, no Open button in body", () => {
    const { container } = render(
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
    // The header carries the single Open affordance now; the link-body
    // "Open ↗" button was the "big black blob" the user flagged. There
    // should be exactly one Open link, and it lives inside the <header>.
    const links = screen.getAllByRole("link", {
      name: /Open URL in new tab/i,
    });
    expect(links.length).toBe(1);
    expect(container.querySelector("header")?.contains(links[0])).toBe(true);
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
      // Match the screenshot img by class — the favicon is also an <img>.
      expect(
        container.querySelector("img.object-cover")?.getAttribute("src"),
      ).toMatch(/^blob:/);
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
