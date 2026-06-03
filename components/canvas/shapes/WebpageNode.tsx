import { ExternalLink } from "lucide-react";
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
function faviconUrl(hostname: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(
    hostname,
  )}&sz=64`;
}

type WebpageNodeProps = { shape: WebpageNodeShape };

export function WebpageNode({ shape }: WebpageNodeProps) {
  const { mode, url, title, hostname, w, h } = shape.props;
  // `summary` is intentionally not destructured here — link-mode polish
  // (PR2c) routes summary text through the LinkCard body instead of
  // duplicating it in a footer below the screenshot/iframe pane.

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

  return (
    <article
      className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-border bg-card shadow-md"
      style={{ width: w, height: h }}
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-border border-b bg-muted px-3">
        <Favicon hostname={hostname} />
        <span
          className="min-w-0 flex-1 truncate font-serif text-[13px] font-medium text-foreground"
          title={title || hostname}
        >
          {title || hostname || "Untitled"}
        </span>
        <span className="shrink-0 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          {mode}
        </span>
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
        <RenderBody
          shape={shape}
          onError={() => switchMode("link")}
          onSwitchMode={switchMode}
        />
      </div>
    </article>
  );
}

function RenderBody({
  shape,
  onError,
  onSwitchMode,
}: {
  shape: WebpageNodeShape;
  onError: () => void;
  onSwitchMode: (mode: WebpageNodeMode) => void;
}) {
  const { mode, url, title, hostname, summary } = shape.props;

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
    return <ScreenshotImg url={url} onError={onError} />;
  }
  return (
    <LinkCard hostname={hostname} title={title} summary={summary} url={url} />
  );
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

function ScreenshotImg({ url, onError }: { url: string; onError: () => void }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    let createdBlobUrl: string | null = null;
    setLoading(true);
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
        setLoading(false);
      } catch (err) {
        console.error("[trail] screenshot fetch failed", err);
        if (alive) onError();
      }
    })();

    return () => {
      alive = false;
      if (createdBlobUrl) URL.revokeObjectURL(createdBlobUrl);
    };
  }, [url, onError]);

  if (loading && !blobUrl) {
    return (
      <div
        aria-label="Loading screenshot"
        className="flex h-full w-full items-center justify-center text-[12px] text-muted-foreground"
        role="status"
      >
        <span className="animate-pulse">loading preview...</span>
      </div>
    );
  }
  if (!blobUrl) return null;
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
  return (
    <div className="flex h-full w-full flex-col gap-1.5 bg-card px-4 py-3">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {hostname}
      </p>
      {summary ? (
        <p className="line-clamp-6 text-[12px] leading-snug text-foreground/80">
          {summary}
        </p>
      ) : (
        <p className="text-[12px] text-muted-foreground/70">
          No preview available.
        </p>
      )}
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
