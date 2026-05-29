import type { WebpageNodeShape } from "@/components/canvas/shapes/WebpageNodeUtil";

type WebpageNodeProps = {
  shape: WebpageNodeShape;
};

export function WebpageNode({ shape }: WebpageNodeProps) {
  const { mode, url, title, summary } = shape.props;

  return (
    <article className="flex h-full w-full overflow-hidden rounded-xl border border-[#d6d2c4] bg-white shadow-[0_14px_35px_rgba(43,44,35,0.16)]">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="h-[128px] overflow-hidden border-[#ece7d8] border-b bg-[#f7f3e8]">
          <RenderModePreview shape={shape} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
          <div>
            <div className="flex items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-[11px] font-medium uppercase tracking-[0.12em] text-[#6f765f]">
                {sourceLabel(url)}
              </p>
              <span className="rounded-full bg-[#edf0e5] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#59624c]">
                {mode}
              </span>
            </div>
            <h2 className="mt-1 truncate text-base font-semibold text-[#202018]">
              {title}
            </h2>
          </div>
          <p className="line-clamp-2 text-sm leading-5 text-[#5c5e52]">
            {summary}
          </p>
          <a
            className="mt-auto inline-flex w-fit items-center rounded-md bg-[#273321] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#36452d]"
            href={url}
            onPointerDown={(event) => event.stopPropagation()}
            rel="noreferrer"
            target="_blank"
          >
            open
          </a>
        </div>
      </div>
    </article>
  );
}

function RenderModePreview({ shape }: WebpageNodeProps) {
  const { mode, screenshotUrl, url } = shape.props;

  switch (mode) {
    case "iframe":
      return (
        <iframe
          className="h-full w-full bg-white"
          sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
          src={url}
          title={`${shape.props.title} live preview`}
        />
      );
    case "screenshot":
      return (
        // biome-ignore lint/performance/noImgElement: tldraw shape previews use a plain image inside the canvas.
        <img
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
          src={screenshotUrl}
        />
      );
  }
}

function sourceLabel(url: string) {
  if (url.startsWith("/")) {
    return "local archive";
  }

  return new URL(url).hostname.replace(/^www\./, "");
}
