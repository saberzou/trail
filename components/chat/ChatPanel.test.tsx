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
import { useSettingsStore } from "@/lib/settings/store";

// Mock the agent bridge BEFORE importing ChatPanel so the component picks
// up the mocked function via the module loader.
vi.mock("@/lib/chat/agentBridge", () => ({
  runAgentTurn: vi.fn(async () => {}),
}));

import { runAgentTurn } from "@/lib/chat/agentBridge";
import { ChatPanel } from "./ChatPanel";

type MockEditor = {
  createShape: ReturnType<typeof vi.fn>;
  updateShape: ReturnType<typeof vi.fn>;
  getViewportPageBounds: ReturnType<typeof vi.fn>;
  getCurrentPageShapes: ReturnType<typeof vi.fn>;
};

function makeEditor(): MockEditor {
  return {
    createShape: vi.fn(),
    updateShape: vi.fn(),
    getViewportPageBounds: vi.fn(() => ({ center: { x: 0, y: 0 } })),
    getCurrentPageShapes: vi.fn(() => []),
  };
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

/** Seed the settings store with a configured LLM provider. */
function configureProvider() {
  useSettingsStore.setState({
    hydrated: true,
    settings: {
      version: 1,
      providers: {
        openai: { kind: "api-key", apiKey: "sk-test" },
      },
      defaultLlm: "openai",
    },
  });
}

function clearProviders() {
  useSettingsStore.setState({
    hydrated: true,
    settings: { version: 1, providers: {} },
  });
}

describe("ChatPanel", () => {
  let editor: MockEditor;

  beforeEach(async () => {
    await wipeChat();
    editor = makeEditor();
    setCanvasEditor(editor as unknown as Parameters<typeof setCanvasEditor>[0]);
    // Default fetch mock — individual tests override as needed.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ iframeable: false })),
    );
    vi.mocked(runAgentTurn).mockReset();
    vi.mocked(runAgentTurn).mockImplementation(async () => {});
    clearProviders();
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

  it("free-form text with a configured provider invokes the agent and renders streamed text", async () => {
    configureProvider();
    vi.mocked(runAgentTurn).mockImplementation(
      async (_editor, _req, _signal, callbacks) => {
        callbacks?.onAssistantText?.("Looking into ducks");
        callbacks?.onAssistantText?.(" right now.");
        callbacks?.onDone?.();
      },
    );

    render(React.createElement(ChatPanel));
    const textarea = await screen.findByLabelText("Message input");
    fireEvent.change(textarea, { target: { value: "tell me about ducks" } });
    fireEvent.submit(textarea.closest("form")!);

    await waitFor(() => {
      expect(runAgentTurn).toHaveBeenCalledTimes(1);
    });
    expect(
      await screen.findByText(/Looking into ducks right now\./i),
    ).toBeInTheDocument();
  });

  it("reports the per-turn tile count via onNode in the Done line", async () => {
    configureProvider();
    vi.mocked(runAgentTurn).mockImplementation(
      async (_editor, _req, _signal, callbacks) => {
        // Three tiles for THIS turn, no assistant text.
        callbacks?.onNode?.();
        callbacks?.onNode?.();
        callbacks?.onNode?.();
        callbacks?.onDone?.();
      },
    );

    render(React.createElement(ChatPanel));
    const textarea = await screen.findByLabelText("Message input");
    fireEvent.change(textarea, { target: { value: "us visa application" } });
    fireEvent.submit(textarea.closest("form")!);

    expect(
      await screen.findByText(/Done — added 3 tiles to the canvas\./i),
    ).toBeInTheDocument();
  });

  it("singularizes the tile count when exactly one tile is added", async () => {
    configureProvider();
    vi.mocked(runAgentTurn).mockImplementation(
      async (_editor, _req, _signal, callbacks) => {
        callbacks?.onNode?.();
        callbacks?.onDone?.();
      },
    );
    render(React.createElement(ChatPanel));
    const textarea = await screen.findByLabelText("Message input");
    fireEvent.change(textarea, { target: { value: "one source please" } });
    fireEvent.submit(textarea.closest("form")!);
    expect(
      await screen.findByText(/Done — added 1 tile to the canvas\./i),
    ).toBeInTheDocument();
  });

  it("shows plain 'Done.' when the agent placed no tiles and emitted no text", async () => {
    configureProvider();
    vi.mocked(runAgentTurn).mockImplementation(
      async (_editor, _req, _signal, callbacks) => {
        callbacks?.onDone?.();
      },
    );
    render(React.createElement(ChatPanel));
    const textarea = await screen.findByLabelText("Message input");
    fireEvent.change(textarea, { target: { value: "anything" } });
    fireEvent.submit(textarea.closest("form")!);
    // Bare "Done." (no tile line) — distinguishes the empty-turn case.
    const dones = await screen.findAllByText(/^Done\.$/);
    expect(dones.length).toBeGreaterThan(0);
  });

  it("free-form text with NO provider configured shows the settings hint", async () => {
    // No providers seeded; clearProviders() ran in beforeEach.
    render(React.createElement(ChatPanel));
    const textarea = await screen.findByLabelText("Message input");
    fireEvent.change(textarea, { target: { value: "tell me about ducks" } });
    fireEvent.submit(textarea.closest("form")!);
    expect(
      await screen.findByText(
        /Configure an LLM provider in \/settings first\./i,
      ),
    ).toBeInTheDocument();
    expect(runAgentTurn).not.toHaveBeenCalled();
  });

  it("Stop button during a stream aborts the controller", async () => {
    configureProvider();
    const receivedSignals: AbortSignal[] = [];
    let resolveTurn: () => void = () => {};
    vi.mocked(runAgentTurn).mockImplementation(
      async (_editor, _req, signal, callbacks) => {
        receivedSignals.push(signal);
        callbacks?.onAssistantText?.("starting...");
        await new Promise<void>((res) => {
          resolveTurn = res;
        });
        callbacks?.onDone?.();
      },
    );

    render(React.createElement(ChatPanel));
    const textarea = await screen.findByLabelText("Message input");
    fireEvent.change(textarea, { target: { value: "us visa application" } });
    fireEvent.submit(textarea.closest("form")!);

    const stopButton = await screen.findByRole("button", { name: /stop/i });
    expect(stopButton).toBeInTheDocument();
    fireEvent.click(stopButton);
    expect(receivedSignals[0]?.aborted).toBe(true);
    // Let the mocked turn settle so React unmounts cleanly.
    await act(async () => {
      resolveTurn();
    });
  });

  it("Send button is disabled while in-flight (URL path)", async () => {
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
    // Stop button (not Send) is what's visible while in-flight.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
    });
    await act(async () => {
      resolveProbe(jsonResponse({ iframeable: false }));
    });
  });

  it("URL detection: accepts bare URL, query strings, fragments; rejects spaces, markdown, multiple URLs", async () => {
    // For non-URL inputs the agent path runs; with no provider configured
    // the friendly settings message appears. We assert createShape is only
    // called for inputs we expect to be URLs.
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
          // Either the no-provider hint (free-form path) or canvas-not-ready
          // fires when the input isn't a lone URL.
          const placeholders = screen.queryAllByText(
            /Configure an LLM provider|Couldn't add|Canvas isn't ready/i,
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
      expect(screen.getByRole("button", { name: /stop/i })).toBeInTheDocument();
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
    expect(editor.createShape).not.toHaveBeenCalled();
  });

  it("hydration race: messages submitted before loadChat resolves are preserved", async () => {
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

    // No provider configured → settings hint appears, plus the user message.
    await screen.findByText(/Configure an LLM provider/i);

    await act(async () => {
      resolveLoad({ version: 1, messages: [] });
    });

    expect(screen.getByText("tell me about ducks")).toBeInTheDocument();
    loadSpy.mockRestore();
  });

  it("persists messages to IndexedDB", async () => {
    render(React.createElement(ChatPanel));
    const textarea = await screen.findByLabelText("Message input");
    fireEvent.change(textarea, { target: { value: "hello world" } });
    fireEvent.submit(textarea.closest("form")!);
    // No provider configured → friendly hint is the assistant reply.
    await screen.findByText(/Configure an LLM provider/i);
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
