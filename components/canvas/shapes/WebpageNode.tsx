import { useEffect, useRef, useState } from "react";
import type {
  WebpageNodeMode,
  WebpageNodeShape,
} from "@/components/canvas/shapes/WebpageNodeUtil";
import { getCanvasEditor } from "@/lib/canvas/editorRef";

const RENDERER_BASE_URL =
  process.env.NEXT_PUBLIC_TRAIL_RENDERER_URL ?? "http://127.0.0.1:3001";

type WebpageNodeProps = { shape: WebpageNodeShape };

export function WebpageNode({ shape }: WebpageNodeProps) {
  const { mode, url, title, hostname, summary, w, h } = shape.props;

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
      className="flex h-full w-full flex-col overflow-hidden rounded-lg border border-[#c9c8bd] bg-white shadow-[0_8px_24px_rgba(23,24,20,0.12)]"
      style={{ width: w, height: h }}
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-[#ece9dd] border-b bg-[#f7f7f2] px-3">
        <span
          className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#171814]"
          title={title || hostname}
        >
          {title || hostname || "Untitled"}
        </span>
        <span className="shrink-0 rounded bg-[#ece9dd] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#5d6256]">
          {hostname}
        </span>
        <span className="shrink-0 rounded bg-[#e6e9dd] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#5d6256]">
          {mode}
        </span>
        <a
          aria-label="Open URL in new tab"
          className="shrink-0 rounded px-1 text-[#5d6256] hover:bg-[#ece9dd] hover:text-[#171814]"
          href={url}
          onPointerDown={(e) => e.stopPropagation()}
          rel="noopener noreferrer"
          target="_blank"
        >
          {"↗"}
        </a>
      </header>
      <div className="relative min-h-0 flex-1 overflow-hidden bg-[#f4f1e8]">
        <RenderBody
          shape={shape}
          onError={() => switchMode("link")}
          onSwitchMode={switchMode}
        />
      </div>
      {mode === "link" && summary ? (
        <footer className="shrink-0 border-[#ece9dd] border-t bg-white px-3 py-2 text-[12px] text-[#5d6256]">
          <p className="line-clamp-2">{summary}</p>
        </footer>
      ) : null}
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
        className="flex h-full w-full items-center justify-center text-[12px] text-[#5d6256]"
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
  title,
  summary,
  url,
}: {
  hostname: string;
  title: string;
  summary?: string;
  url: string;
}) {
  return (
    <div className="flex h-full w-full flex-col items-start justify-center gap-2 bg-[#f7f7f2] p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-[#5d6256]">
        {hostname}
      </p>
      <h3 className="line-clamp-2 text-[15px] font-semibold text-[#171814]">
        {title || hostname}
      </h3>
      {summary ? (
        <p className="line-clamp-3 text-[12px] text-[#5d6256]">{summary}</p>
      ) : null}
      <a
        className="mt-auto inline-flex items-center rounded-md bg-[#273321] px-3 py-1.5 text-[12px] font-medium text-white hover:bg-[#36452d]"
        href={url}
        onPointerDown={(e) => e.stopPropagation()}
        rel="noopener noreferrer"
        target="_blank"
      >
        Open in new tab
      </a>
    </div>
  );
}
