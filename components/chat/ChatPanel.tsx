"use client";

import { nanoid } from "nanoid";
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createShapeId } from "tldraw";
import { getCanvasEditor } from "@/lib/canvas/editorRef";
import {
  type ChatHistory,
  type ChatMessage,
  loadChat,
  saveChat,
} from "@/lib/chat/persistence";
import { createDebouncedSaver } from "@/lib/idb/saver";

const RENDERER_BASE_URL =
  process.env.NEXT_PUBLIC_TRAIL_RENDERER_URL ?? "http://127.0.0.1:3001";

const URL_PATTERN = /^https?:\/\/[^\s/$.?#][^\s]*$/i;

/**
 * Returns true iff `s` is a single bare http(s) URL — no surrounding text, no
 * embedded whitespace, no markdown wrapper. We treat anything else (including
 * "check out https://x.com") as free-form chat.
 */
function isLoneUrl(s: string): boolean {
  const trimmed = s.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;
  return URL_PATTERN.test(trimmed);
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

async function probeUrl(url: string): Promise<{ iframeable: boolean }> {
  try {
    const r = await fetch(`${RENDERER_BASE_URL}/probe`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!r.ok) return { iframeable: false };
    return (await r.json()) as { iframeable: boolean };
  } catch {
    return { iframeable: false };
  }
}

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;

  // Build a debounced saver that snapshots the current messages array.
  const saver = useMemo(
    () =>
      createDebouncedSaver<ChatHistory>(
        () => ({ version: 1, messages: messagesRef.current }),
        saveChat,
        400,
      ),
    [],
  );

  // Hydrate from IndexedDB on mount, then start persisting on every change.
  useEffect(() => {
    let alive = true;
    loadChat()
      .then((h) => {
        if (!alive) return;
        // Only seed from storage if the user hasn't already started typing
        // before hydrate resolved — otherwise the async load would clobber
        // freshly-added messages.
        setMessages((prev) => (prev.length === 0 ? h.messages : prev));
        setHydrated(true);
      })
      .catch((err) => {
        console.error("[trail] chat history load failed", err);
        if (alive) setHydrated(true);
      });
    return () => {
      alive = false;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `messages` is the change signal — the effect body only calls trigger().
  useEffect(() => {
    if (!hydrated) return;
    saver.trigger();
  }, [hydrated, messages, saver]);

  // Flush any pending save on unmount.
  useEffect(() => {
    return () => {
      void saver.flush();
    };
  }, [saver]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `messages` is the change signal we want — body reads only scrollRef.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const submit = useCallback(async () => {
    const raw = input.trim();
    if (!raw || sending) return;
    setError(null);

    const userMsg: ChatMessage = {
      id: nanoid(),
      role: "user",
      text: raw,
      createdAt: Date.now(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setSending(true);

    try {
      if (isLoneUrl(raw)) {
        await handleUrl(raw, (reply) =>
          setMessages((prev) => [...prev, reply]),
        );
      } else {
        const reply: ChatMessage = {
          id: nanoid(),
          role: "assistant",
          text: "Free-form chat with the master agent arrives in the next update. For now, paste a URL and I'll add it as a tile.",
          createdAt: Date.now(),
        };
        setMessages((prev) => [...prev, reply]);
      }
    } finally {
      setSending(false);
    }
  }, [input, sending]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <aside
      aria-label="Trail chat"
      className="flex h-screen w-[360px] shrink-0 flex-col border-[#c9c8bd] border-r bg-[#f7f7f2] text-[#171814]"
    >
      <header className="shrink-0 border-[#c9c8bd] border-b px-4 py-3">
        <h1 className="font-semibold text-[15px] text-[#171814]">Trail</h1>
        <p className="mt-0.5 text-[12px] text-[#5d6256]">
          paste a URL or type a question
        </p>
      </header>

      <div
        aria-label="Chat messages"
        aria-live="polite"
        className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-3"
        ref={scrollRef}
        role="log"
      >
        {messages.length === 0 ? (
          <p className="px-1 text-[12px] text-[#5d6256]">
            Drop in a link to add it to the canvas.
          </p>
        ) : (
          messages.map((m) => <MessageCard key={m.id} message={m} />)
        )}
        {error ? (
          <p className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[12px] text-red-700">
            {error}
          </p>
        ) : null}
      </div>

      <form
        className="shrink-0 border-[#c9c8bd] border-t bg-[#f7f7f2] p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <textarea
          aria-label="Message input"
          className="w-full resize-none rounded border border-[#c9c8bd] bg-white px-2 py-1.5 text-[13px] text-[#171814] outline-none focus:border-[#5d6256]"
          disabled={sending}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="https://example.com or ask a question"
          rows={3}
          value={input}
        />
        <div className="mt-2 flex items-center justify-between text-[11px] text-[#5d6256]">
          <span>Cmd+Enter to send</span>
          <button
            className="rounded bg-[#273321] px-3 py-1 font-medium text-[12px] text-white disabled:cursor-not-allowed disabled:bg-[#a5a89c]"
            disabled={sending || input.trim().length === 0}
            type="submit"
          >
            {sending ? "sending..." : "Send"}
          </button>
        </div>
      </form>
    </aside>
  );
}

async function handleUrl(
  url: string,
  push: (m: ChatMessage) => void,
): Promise<void> {
  const editor = getCanvasEditor();
  if (!editor) {
    push({
      id: nanoid(),
      role: "assistant",
      text: "Canvas isn't ready yet — try again in a moment.",
      createdAt: Date.now(),
    });
    return;
  }

  const { iframeable } = await probeUrl(url);
  const mode = iframeable ? "iframe" : "screenshot";
  const hostname = safeHostname(url);

  // Place the tile at the center of the current viewport. tldraw's coordinate
  // system is page-space; getViewportPageBounds().center maps to where the
  // user is looking right now.
  const center = editor.getViewportPageBounds().center;
  const w = 360;
  const h = 280;
  const shapeId = createShapeId(nanoid());

  try {
    editor.createShape({
      id: shapeId,
      type: "webpage",
      x: center.x - w / 2,
      y: center.y - h / 2,
      props: {
        w,
        h,
        url,
        title: hostname,
        hostname,
        mode,
      },
    });
  } catch (err) {
    console.error("[trail] failed to create webpage shape", err);
    push({
      id: nanoid(),
      role: "assistant",
      text: `Couldn't add ${hostname} to the canvas. See devtools for details.`,
      createdAt: Date.now(),
    });
    return;
  }

  push({
    id: nanoid(),
    role: "assistant",
    text: `Added ${hostname} to your canvas.`,
    createdAt: Date.now(),
    meta: { kind: "url-tile", nodeId: shapeId },
  });
}

function MessageCard({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div
      className={
        isUser
          ? "rounded border border-[#c9c8bd] bg-white px-2 py-1.5"
          : "rounded border border-[#ece9dd] bg-[#ece9dd] px-2 py-1.5"
      }
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[#5d6256]">
        {isUser ? "you" : "trail"}
      </p>
      <p className="mt-0.5 whitespace-pre-wrap break-words text-[13px] text-[#171814]">
        {message.text}
      </p>
    </div>
  );
}
