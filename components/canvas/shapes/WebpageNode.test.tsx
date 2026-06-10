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

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

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

  it("renders header with title, find-related + Open affordances", () => {
    render(
      React.createElement(WebpageNode, {
        shape: makeShape({ mode: "link", title: "Hello world" }),
      }),
    );
    // Title appears once — in the header bar only. The link-mode body
    // doesn't duplicate it (PR: simplify link body).
    expect(screen.getAllByText("Hello world").length).toBe(1);
    expect(screen.getAllByText("example.com").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: /find related sites/i }),
    ).toBeInTheDocument();
    const openLinks = screen.getAllByRole("link", {
      name: /Open URL in new tab/i,
    });
    expect(openLinks.length).toBe(1);
  });

  it("the find-related button dispatches a trail:expand event for this tile", () => {
    const events: CustomEvent[] = [];
    const handler = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener("trail:expand", handler);
    render(
      React.createElement(WebpageNode, {
        shape: makeShape({ mode: "link", hostname: "nytimes.com" }),
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: /find related sites/i }),
    );
    window.removeEventListener("trail:expand", handler);
    expect(events).toHaveLength(1);
    expect(events[0].detail.hostname).toBe("nytimes.com");
    expect(events[0].detail.url).toContain("example.com");
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

  it("screenshot mode with no og resolves /api/og then renders the renderer blob", async () => {
    const fakeBlob = new Blob([new Uint8Array([0x89, 0x50])], {
      type: "image/png",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const u = typeof input === "string" ? input : (input as URL).toString();
        // No server-side og image for this page.
        if (u.endsWith("/api/og")) return jsonResponse({ previewImage: null });
        // Renderer screenshot.
        return new Response(fakeBlob, {
          status: 200,
          headers: { "content-type": "image/png" },
        });
      }),
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

  it("screenshot mode with no handed og fetches /api/og and renders it (renderer-free)", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const u = typeof input === "string" ? input : (input as URL).toString();
      if (u.endsWith("/api/og")) {
        return jsonResponse({ previewImage: "https://cdn.example.com/og.png" });
      }
      throw new Error("renderer should not be called when og resolves");
    });
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(
      React.createElement(WebpageNode, {
        shape: makeShape({ mode: "screenshot" }),
      }),
    );
    await waitFor(() => {
      const img = container.querySelector("img.object-cover");
      expect(img?.getAttribute("src")).toBe("https://cdn.example.com/og.png");
    });
    // No renderer /screenshot round-trip — og came from the same-origin route.
    expect(
      fetchMock.mock.calls.some(([u]) => String(u).endsWith("/screenshot")),
    ).toBe(false);
  });

  it("screenshot mode with previewImage renders the og image directly (no renderer fetch)", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { container } = render(
      React.createElement(WebpageNode, {
        shape: makeShape({
          mode: "screenshot",
          previewImage: "https://cdn.example.com/hero.png",
        }),
      }),
    );
    const img = container.querySelector("img.object-cover");
    expect(img?.getAttribute("src")).toBe("https://cdn.example.com/hero.png");
    // No renderer /screenshot round-trip needed.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("falls back to the renderer screenshot when the og image fails to load", async () => {
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
        shape: makeShape({
          mode: "screenshot",
          previewImage: "https://cdn.example.com/broken.png",
        }),
      }),
    );
    const og = container.querySelector("img.object-cover");
    expect(og).not.toBeNull();
    // Simulate the og image 404ing/being blocked.
    fireEvent.error(og!);
    await waitFor(() => {
      const img = container.querySelector("img.object-cover");
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

  it("link mode without a summary shows the favicon fallback (an image)", () => {
    const { container } = render(
      React.createElement(WebpageNode, {
        shape: makeShape({
          mode: "link",
          title: "Anything",
          summary: "",
          hostname: "stripe.com",
        }),
      }),
    );
    // No "No preview available" text — a favicon image stands in instead.
    expect(screen.queryByText(/No preview available/i)).toBeNull();
    const heroFavicon = Array.from(container.querySelectorAll("img")).find(
      (i) => i.getAttribute("src")?.includes("sz=128"),
    );
    expect(heroFavicon?.getAttribute("src")).toContain("stripe.com");
  });

  it("a failed screenshot shows the favicon fallback, not a mode switch", async () => {
    const updateShape = vi.fn();
    setCanvasEditor({
      updateShape,
    } as unknown as Parameters<typeof setCanvasEditor>[0]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const u = typeof input === "string" ? input : (input as URL).toString();
        if (u.endsWith("/api/og")) return jsonResponse({ previewImage: null });
        return new Response("nope", { status: 500 }); // renderer fails
      }),
    );
    const { container } = render(
      React.createElement(WebpageNode, {
        shape: makeShape({ mode: "screenshot", hostname: "example.com" }),
      }),
    );
    await waitFor(() => {
      const hero = Array.from(container.querySelectorAll("img")).find((i) =>
        i.getAttribute("src")?.includes("sz=128"),
      );
      expect(hero).toBeDefined();
    });
    // A missing screenshot is NOT treated as an auth wall — no mode switch.
    expect(updateShape).not.toHaveBeenCalled();
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
    const fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const u = typeof input === "string" ? input : (input as URL).toString();
      // No server-side og → fall through to the renderer screenshot.
      if (u.endsWith("/api/og")) return jsonResponse({ previewImage: null });
      return new Response(new Blob(), { status: 500 });
    });
    vi.stubGlobal("fetch", fetchSpy);
    setCanvasEditor({
      updateShape: vi.fn(),
    } as unknown as Parameters<typeof setCanvasEditor>[0]);
    render(
      React.createElement(WebpageNode, {
        shape: makeShape({ mode: "screenshot" }),
      }),
    );
    // Find the renderer /screenshot call (the /api/og lookup runs first).
    let shotCall: [string, RequestInit] | undefined;
    await waitFor(() => {
      shotCall = fetchSpy.mock.calls.find(([u]) =>
        String(u).endsWith("/screenshot"),
      ) as unknown as [string, RequestInit] | undefined;
      expect(shotCall).toBeDefined();
    });
    const body = JSON.parse(
      (shotCall as [string, RequestInit])[1].body as string,
    );
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
