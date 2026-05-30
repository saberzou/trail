// @vitest-environment jsdom
import "fake-indexeddb/auto";
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
import { wipeChat } from "@/lib/chat/persistence";
import { ChatPanel } from "./ChatPanel";

type MockEditor = {
  createShape: ReturnType<typeof vi.fn>;
  updateShape: ReturnType<typeof vi.fn>;
  getViewportPageBounds: ReturnType<typeof vi.fn>;
};

function makeEditor(): MockEditor {
  return {
    createShape: vi.fn(),
    updateShape: vi.fn(),
    getViewportPageBounds: vi.fn(() => ({ center: { x: 0, y: 0 } })),
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

describe("ChatPanel", () => {
  let editor: MockEditor;

  beforeEach(async () => {
    await wipeChat();
    editor = makeEditor();
    // Cast to satisfy editorRef's Editor typing; only the methods we touch
    // matter inside ChatPanel's URL-paste path.
    setCanvasEditor(editor as unknown as Parameters<typeof setCanvasEditor>[0]);
    // Default fetch mock — individual tests override as needed.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ iframeable: false })),
    );
  });

  afterEach(() => {
    cleanup();
    setCanvasEditor(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders empty state and a disabled Send button", async () => {
    render(React.createElement(ChatPanel));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Send/i })).toBeInTheDocument();
    });
    const send = screen.getByRole("button", { name: /Send/i });
    expect(send).toBeDisabled();
    expect(screen.getByLabelText("Message input")).toBeEnabled();
  });

  it("typing enables Send; empty input doesn't submit", async () => {
    render(React.createElement(ChatPanel));
    const textarea = await screen.findByLabelText("Message input");
    fireEvent.change(textarea, { target: { value: "hello" } });
    const send = screen.getByRole("button", { name: /Send/i });
    expect(send).not.toBeDisabled();
    fireEvent.change(textarea, { target: { value: "" } });
    expect(send).toBeDisabled();
  });

  it("URL submit calls /probe then editor.createShape", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : (input as URL).toString();
      if (url.endsWith("/probe")) return jsonResponse({ iframeable: false });
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(ChatPanel));
    const textarea = await screen.findByLabelText("Message input");
    fireEvent.change(textarea, { target: { value: "https://example.com" } });
    fireEvent.submit(textarea.closest("form")!);

    await waitFor(() => {
      expect(editor.createShape).toHaveBeenCalledTimes(1);
    });
    const probeCall = fetchMock.mock.calls.find(([u]) =>
      String(u).endsWith("/probe"),
    );
    expect(probeCall).toBeDefined();

    const shape = editor.createShape.mock.calls[0][0];
    expect(shape.type).toBe("webpage");
    expect(shape.props.url).toBe("https://example.com");
    expect(shape.props.mode).toBe("screenshot");
    expect(shape.props.hostname).toBe("example.com");
    expect(await screen.findByText(/Added example\.com/i)).toBeInTheDocument();
  });

  it("iframeable URL creates the shape in iframe mode", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ iframeable: true })),
    );
    render(React.createElement(ChatPanel));
    const textarea = await screen.findByLabelText("Message input");
    fireEvent.change(textarea, { target: { value: "https://wikipedia.org" } });
    fireEvent.submit(textarea.closest("form")!);
    await waitFor(() => {
      expect(editor.createShape).toHaveBeenCalledTimes(1);
    });
    expect(editor.createShape.mock.calls[0][0].props.mode).toBe("iframe");
  });

  it("non-URL text shows the placeholder assistant reply", async () => {
    render(React.createElement(ChatPanel));
    const textarea = await screen.findByLabelText("Message input");
    fireEvent.change(textarea, { target: { value: "tell me about ducks" } });
    fireEvent.submit(textarea.closest("form")!);
    expect(
      await screen.findByText(/master agent arrives in the next update/i),
    ).toBeInTheDocument();
    expect(editor.createShape).not.toHaveBeenCalled();
  });

  it("Send button is disabled while in-flight", async () => {
    let resolveProbe: (r: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((res) => {
            resolveProbe = res;
          }),
      ),
    );
    render(React.createElement(ChatPanel));
    const textarea = await screen.findByLabelText("Message input");
    fireEvent.change(textarea, { target: { value: "https://example.com" } });
    fireEvent.submit(textarea.closest("form")!);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /sending/i })).toBeDisabled();
    });
    // Resolve so React unmounts cleanly.
    await act(async () => {
      resolveProbe(jsonResponse({ iframeable: false }));
    });
  });

  it("URL detection: accepts bare URL, query strings, fragments; rejects spaces, markdown, multiple URLs", async () => {
    const cases: Array<{ input: string; expectsShape: boolean }> = [
      { input: "https://example.com", expectsShape: true },
      { input: "  https://example.com  ", expectsShape: true }, // trimmed
      { input: "https://example.com?q=1&x=2", expectsShape: true },
      { input: "https://example.com/path#frag", expectsShape: true },
      { input: "https://example.com extra", expectsShape: false }, // whitespace inside
      { input: "https://a.com https://b.com", expectsShape: false }, // two URLs
      { input: "[click](https://example.com)", expectsShape: false }, // markdown
      { input: "tell me about ducks", expectsShape: false }, // plain text
    ];

    for (const { input, expectsShape } of cases) {
      cleanup();
      editor = makeEditor();
      setCanvasEditor(
        editor as unknown as Parameters<typeof setCanvasEditor>[0],
      );
      await wipeChat();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => jsonResponse({ iframeable: false })),
      );
      render(React.createElement(ChatPanel));
      const textarea = await screen.findByLabelText("Message input");
      fireEvent.change(textarea, { target: { value: input } });
      fireEvent.submit(textarea.closest("form")!);
      if (expectsShape) {
        await waitFor(() => {
          expect(editor.createShape).toHaveBeenCalledTimes(1);
        });
      } else {
        await waitFor(() => {
          // Wait for either the placeholder reply or any state update.
          const placeholders = screen.queryAllByText(
            /master agent arrives|Couldn't add|Canvas isn't ready/i,
          );
          expect(placeholders.length).toBeGreaterThan(0);
        });
        expect(editor.createShape).not.toHaveBeenCalled();
      }
    }
  });

  it("Cmd+Enter submits the input", async () => {
    render(React.createElement(ChatPanel));
    const textarea = await screen.findByLabelText("Message input");
    fireEvent.change(textarea, { target: { value: "https://example.com" } });
    fireEvent.keyDown(textarea, {
      key: "Enter",
      metaKey: true,
    });
    await waitFor(() => {
      expect(editor.createShape).toHaveBeenCalledTimes(1);
    });
  });

  it("Ctrl+Enter also submits the input", async () => {
    render(React.createElement(ChatPanel));
    const textarea = await screen.findByLabelText("Message input");
    fireEvent.change(textarea, { target: { value: "https://example.com" } });
    fireEvent.keyDown(textarea, { key: "Enter", ctrlKey: true });
    await waitFor(() => {
      expect(editor.createShape).toHaveBeenCalledTimes(1);
    });
  });

  it("a second submit while a turn is in-flight is dropped", async () => {
    // Hold the probe response open so the first turn never finishes.
    let resolveFirstProbe: (r: Response) => void = () => {};
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((res) => {
          resolveFirstProbe = res;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(React.createElement(ChatPanel));
    const textarea = await screen.findByLabelText("Message input");
    fireEvent.change(textarea, { target: { value: "https://first.example" } });
    fireEvent.submit(textarea.closest("form")!);

    // Sending state should be active.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /sending/i })).toBeDisabled();
    });

    // Try to submit a second URL while the first is still in-flight.
    fireEvent.change(textarea, {
      target: { value: "https://second.example" },
    });
    fireEvent.submit(textarea.closest("form")!);

    // Resolve the first probe so React unmounts cleanly.
    await act(async () => {
      resolveFirstProbe(jsonResponse({ iframeable: false }));
    });
    await waitFor(() => {
      expect(editor.createShape).toHaveBeenCalledTimes(1);
    });
    // Only the first URL made it to createShape. ChatPanel passes the
    // raw (trimmed) text — it doesn't run the input through the URL
    // constructor, so no trailing slash normalization happens here.
    expect(editor.createShape.mock.calls[0][0].props.url).toBe(
      "https://first.example",
    );
  });

  it("shows a friendly message when the canvas editor is null", async () => {
    setCanvasEditor(null);
    render(React.createElement(ChatPanel));
    const textarea = await screen.findByLabelText("Message input");
    fireEvent.change(textarea, { target: { value: "https://example.com" } });
    fireEvent.submit(textarea.closest("form")!);
    expect(await screen.findByText(/Canvas isn't ready/i)).toBeInTheDocument();
    // No probe issued, no shape created.
    expect(editor.createShape).not.toHaveBeenCalled();
  });

  it("hydration race: messages submitted before loadChat resolves are preserved", async () => {
    // Replace fake-indexeddb's loadChat by intercepting at the module
    // boundary. We delay the resolution to simulate a slow first read,
    // submit during the wait, then resolve and assert the user message
    // wasn't clobbered.
    const persistence = await import("@/lib/chat/persistence");
    let resolveLoad: (h: { version: 1; messages: [] }) => void = () => {};
    const loadSpy = vi.spyOn(persistence, "loadChat").mockImplementation(
      () =>
        new Promise((res) => {
          resolveLoad = res;
        }),
    );

    render(React.createElement(ChatPanel));
    const textarea = await screen.findByLabelText("Message input");
    fireEvent.change(textarea, { target: { value: "tell me about ducks" } });
    fireEvent.submit(textarea.closest("form")!);

    // Wait for the placeholder reply to appear (local state has messages now).
    await screen.findByText(/master agent arrives/i);

    // Now resolve loadChat with empty history. The component's functional
    // setMessages guards against overwriting when messages already exist.
    await act(async () => {
      resolveLoad({ version: 1, messages: [] });
    });

    // The user message should still be there.
    expect(screen.getByText("tell me about ducks")).toBeInTheDocument();
    loadSpy.mockRestore();
  });

  it("persists messages to IndexedDB", async () => {
    render(React.createElement(ChatPanel));
    const textarea = await screen.findByLabelText("Message input");
    fireEvent.change(textarea, { target: { value: "hello world" } });
    fireEvent.submit(textarea.closest("form")!);
    // Wait for the placeholder reply to appear (signals work is done).
    await screen.findByText(/master agent arrives in the next update/i);
    // Wait past the debounce.
    await new Promise((r) => setTimeout(r, 500));
    const { loadChat } = await import("@/lib/chat/persistence");
    const persisted = await loadChat();
    expect(persisted.messages.length).toBeGreaterThanOrEqual(2);
    expect(persisted.messages[0]).toMatchObject({
      role: "user",
      text: "hello world",
    });
  });
});
