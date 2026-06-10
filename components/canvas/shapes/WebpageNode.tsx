import { Check, ExternalLink, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type {
  WebpageNodeMode,
  WebpageNodeShape,
} from "@/components/canvas/shapes/WebpageNodeUtil";
import { getCanvasEditor } from "@/lib/canvas/editorRef";

const RENDERER_BASE_URL =
  process.env.NEXT_PUBLIC_TRAIL_RENDERER_URL ?? "http://127.0.0.1:3001";

/**
 * Google's S2 favicon service: no backend, no API key, served as a plain
 * image. We use it to visually differentiate tiles even when the screenshot
 * sidecar is offline. The CSP `img-src https:` rule already covers it.
 */
function faviconUrl(hostname: string, size = 64): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(
    hostname,
  )}&sz=${size}`;
}

/**
 * Lightweight fallback preview — the site's favicon centred on a neutral
 * ground, with the hostname beneath. Instant (one tiny image, no renderer,
 * no og fetch), so tiles never sit blank or show a heavy "loading…" state.
 * Used while a richer preview resolves and as the final fallback when there
 * isn't one.
 */
function FaviconHero({ hostname }: { hostname: string }) {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-muted">
      {hostname ? (
        // biome-ignore lint/performance/noImgElement: tldraw shape previews render inside the canvas, not the Next.js page tree.
        <img
          alt=""
          aria-hidden="true"
          className="size-10 rounded-md opacity-90"
          draggable={false}
          src={faviconUrl(hostname, 128)}
        />
      ) : null}
      {hostname ? (
        <span className="max-w-[80%] truncate px-2 text-[11px] text-muted-foreground">
          {hostname}
        </span>
      ) : null}
    </div>
  );
}

type WebpageNodeProps = { shape: WebpageNodeShape };

export function WebpageNode({ shape }: WebpageNodeProps) {
  const { mode, url, title, hostname, w, h, stepState } = shape.props;
  // `summary` is intentionally not destructured here — link-mode polish
  // (PR2c) routes summary text through the LinkCard body instead of
  // duplicating it in a footer below the screenshot/iframe pane.
  const done = stepState === "done";

  const switchMode = (next: WebpageNodeMode) => {
    if (next === mode) return;
    const editor = getCanvasEditor();
    if (!editor) return;
    editor.updateShape({
      id: shape.id,
      type: "webpage",
      props: { ...shape.props, mode: next },
    });
  };

  const toggleDone = () => {
    const editor = getCanvasEditor();
    if (!editor) return;
    editor.updateShape({
      id: shape.id,
      type: "webpage",
      props: { ...shape.props, stepState: done ? "todo" : "done" },
    });
  };

  // Ask the chat dock to fan out related sites around THIS tile. Decoupled
  // via a window event so the canvas shape doesn't need a handle on the
  // ChatPanel — ChatPanel listens and runs the explore turn anchored here.
  const expandRelated = () => {
    window.dispatchEvent(
      new CustomEvent("trail:expand", {
        detail: { url, hostname, shapeId: shape.id },
      }),
    );
  };

  return (
    <article
      className={`flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-md transition-opacity ${
        done ? "opacity-60" : ""
      }`}
      style={{ width: w, height: h }}
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-border border-b bg-muted px-3">
        <button
          aria-label={done ? "Mark step as not done" : "Mark step as done"}
          aria-pressed={done}
          className="flex size-5 shrink-0 items-center justify-center rounded-full border border-border text-background transition-colors hover:border-foreground data-[done=true]:border-foreground data-[done=true]:bg-foreground"
          data-done={done}
          onClick={toggleDone}
          onPointerDown={(e) => e.stopPropagation()}
          type="button"
        >
          {done ? <Check className="size-3" /> : null}
        </button>
        <Favicon hostname={hostname} />
        <span
          className={`min-w-0 flex-1 truncate font-serif text-[13px] font-medium ${
            done ? "text-muted-foreground line-through" : "text-foreground"
          }`}
          title={title || hostname}
        >
          {title || hostname || "Untitled"}
        </span>
        <button
          aria-label="Find related sites"
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          onClick={expandRelated}
          onPointerDown={(e) => e.stopPropagation()}
          title="Find related sites"
          type="button"
        >
          <Sparkles className="size-3.5" />
        </button>
        <a
          aria-label="Open URL in new tab"
          className="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          href={url}
          onPointerDown={(e) => e.stopPropagation()}
          rel="noopener noreferrer"
          target="_blank"
        >
          <ExternalLink className="size-3.5" />
        </a>
      </header>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-muted">
        <RenderBody shape={shape} onSwitchMode={switchMode} />
      </div>
    </article>
  );
}

function RenderBody({
  shape,
  onSwitchMode,
}: {
  shape: WebpageNodeShape;
  onSwitchMode: (mode: WebpageNodeMode) => void;
}) {
  const { mode, url, title, hostname, summary, previewImage } = shape.props;

  if (mode === "iframe") {
    return (
      <IframeBody
        url={url}
        title={title || hostname}
        onLoadFail={() => onSwitchMode("screenshot")}
      />
    );
  }
  if (mode === "screenshot") {
    return (
      <PreviewBody hostname={hostname} previewImage={previewImage} url={url} />
    );
  }
  return (
    <LinkCard hostname={hostname} title={title} summary={summary} url={url} />
  );
}

/**
 * Preview pane for non-iframe tiles. Preview ladder, cheapest first:
 *   1. the og:image we were handed (from the agent fetch / probe), if any;
 *   2. otherwise ask the same-origin /api/og route to fetch the page's
 *      og:image server-side — chat-app-style unfurl with NO renderer needed;
 *   3. otherwise the Playwright renderer screenshot;
 *   4. ScreenshotImg's own onError then degrades to a link card.
 *
 * og images work even when the screenshot sidecar is offline, which is the
 * common single-user case.
 */
function PreviewBody({
  previewImage,
  url,
  hostname,
}: {
  previewImage?: string;
  url: string;
  hostname: string;
}) {
  const [ogUrl, setOgUrl] = useState<string | null>(previewImage ?? null);
  const [ogFailed, setOgFailed] = useState(false);
  // Whether we've finished trying to RESOLVE an og url (not whether it
  // rendered). Starts done if we were handed one.
  const [resolved, setResolved] = useState<boolean>(Boolean(previewImage));

  useEffect(() => {
    if (previewImage) return; // already have one — no lookup needed
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/og", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ url }),
        });
        const data = (await r.json()) as { previewImage?: string | null };
        if (!alive) return;
        if (data.previewImage) setOgUrl(data.previewImage);
      } catch {
        // ignore — fall through to the renderer screenshot
      } finally {
        if (alive) setResolved(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [url, previewImage]);

  if (ogUrl && !ogFailed) {
    return (
      // biome-ignore lint/performance/noImgElement: tldraw shape previews render inside the canvas, not the Next.js page tree.
      <img
        alt=""
        className="h-full w-full object-cover object-top"
        draggable={false}
        onError={() => setOgFailed(true)}
        src={ogUrl}
      />
    );
  }
  // While resolving the og lookup, show the lightweight favicon hero (never
  // a blank pane). Once resolved with no og, hand off to the renderer
  // screenshot — which itself falls back to the favicon hero if offline.
  if (!resolved) {
    return <FaviconHero hostname={hostname} />;
  }
  return <ScreenshotImg hostname={hostname} url={url} />;
}

function IframeBody({
  url,
  title,
  onLoadFail,
}: {
  url: string;
  title: string;
  onLoadFail: () => void;
}) {
  // iframe `onError` does NOT fire for X-Frame-Options / CSP frame-ancestors
  // blocks — the browser just leaves the frame blank. We belt-and-suspender it
  // with a 1.5s load deadline: if `onLoad` hasn't fired by then, treat it as
  // blocked and fall back to screenshot mode.
  //
  // For the rare native `error` event (e.g. DNS failure), we attach a real
  // DOM listener: React 19 doesn't bind `onError` on <iframe> at all
  // (only `load` is registered as a non-delegated event for iframes), so a
  // JSX `onError={...}` prop here would be silently dropped.
  const loadedRef = useRef(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  useEffect(() => {
    loadedRef.current = false;
    const timer = setTimeout(() => {
      if (!loadedRef.current) onLoadFail();
    }, 1500);
    const el = iframeRef.current;
    const onError = () => onLoadFail();
    el?.addEventListener("error", onError);
    return () => {
      clearTimeout(timer);
      el?.removeEventListener("error", onError);
    };
  }, [onLoadFail]);

  return (
    <iframe
      className="h-full w-full border-0 bg-white"
      onLoad={() => {
        loadedRef.current = true;
      }}
      onPointerDown={(e) => e.stopPropagation()}
      ref={iframeRef}
      sandbox="allow-scripts allow-forms"
      src={url}
      title={`${title} preview`}
    />
  );
}

function ScreenshotImg({ url, hostname }: { url: string; hostname: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let createdBlobUrl: string | null = null;
    setBlobUrl(null);

    (async () => {
      try {
        const r = await fetch(`${RENDERER_BASE_URL}/screenshot`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            url,
            viewport: { width: 1280, height: 720 },
          }),
        });
        if (!r.ok) throw new Error(`renderer returned ${r.status}`);
        const blob = await r.blob();
        if (!alive) return;
        createdBlobUrl = URL.createObjectURL(blob);
        setBlobUrl(createdBlobUrl);
      } catch {
        // Renderer offline / failed — the favicon hero below stays. No mode
        // switch: a missing screenshot isn't an auth wall, and the favicon
        // is a perfectly good lightweight preview.
      }
    })();

    return () => {
      alive = false;
      if (createdBlobUrl) URL.revokeObjectURL(createdBlobUrl);
    };
  }, [url]);

  // Show the favicon hero until (and unless) a screenshot arrives — never a
  // blank pane or a heavy "loading…" flash.
  if (!blobUrl) return <FaviconHero hostname={hostname} />;
  return (
    // biome-ignore lint/performance/noImgElement: tldraw shape previews are rendered inside the canvas, not the Next.js page tree.
    <img
      alt=""
      className="h-full w-full object-cover object-top"
      draggable={false}
      src={blobUrl}
    />
  );
}

function LinkCard({
  hostname,
  summary,
}: {
  hostname: string;
  // `title` is intentionally not consumed — the article header already
  // displays it; repeating it in the card body crowds the 320×220 default
  // tile. Kept on the prop list of the parent caller so the rest of the
  // renderer stays simple.
  title?: string;
  summary?: string;
  // `url` is also intentionally not consumed — the header's Open ↗ link is
  // the single Open affordance. A second Open button in the body was the
  // "big black blob" the user flagged.
  url?: string;
}) {
  // With a summary (e.g. agent link tiles), show the text card. Without one
  // (a bare paste that fell through to link mode), show the favicon hero so
  // the tile is still a recognizable image rather than empty text.
  if (!summary) {
    return <FaviconHero hostname={hostname} />;
  }
  return (
    <div className="flex h-full w-full flex-col gap-1.5 bg-card px-4 py-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {hostname}
      </p>
      <p className="line-clamp-6 text-[12px] leading-snug text-foreground/80">
        {summary}
      </p>
    </div>
  );
}

/**
 * Tiny 16×16 favicon. If the image fails to load (offline, blocked, 404),
 * we hide it entirely rather than showing a broken-image glyph so the
 * header layout stays clean.
 */
function Favicon({ hostname }: { hostname: string }) {
  const [hidden, setHidden] = useState(false);
  if (!hostname || hidden) return null;
  return (
    // biome-ignore lint/performance/noImgElement: tldraw shape headers render inside the canvas, not the Next.js page tree.
    <img
      alt=""
      aria-hidden="true"
      className="h-4 w-4 shrink-0 rounded-sm"
      draggable={false}
      onError={() => setHidden(true)}
      src={faviconUrl(hostname)}
    />
  );
}
