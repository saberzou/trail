import type { WebpageNodeShape } from "@/components/canvas/shapes/WebpageNodeUtil";

type WebpageNodeProps = {
  shape: WebpageNodeShape;
};

export function WebpageNode({ shape }: WebpageNodeProps) {
  const { url, title, summary, screenshotUrl } = shape.props;

  return (
    <article className="flex h-full w-full overflow-hidden rounded-xl border border-[#d6d2c4] bg-white shadow-[0_14px_35px_rgba(43,44,35,0.16)]">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-[118px] items-center justify-center border-[#ece7d8] border-b bg-[#f7f3e8]">
          <img
            alt=""
            className="h-full w-full object-cover"
            draggable={false}
            src={screenshotUrl}
          />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-4">
          <div>
            <p className="truncate text-[11px] font-medium uppercase tracking-[0.12em] text-[#6f765f]">
              {new URL(url).hostname.replace(/^www\./, "")}
            </p>
            <h2 className="mt-1 truncate text-base font-semibold text-[#202018]">
              {title}
            </h2>
          </div>
          <p className="line-clamp-3 text-sm leading-5 text-[#5c5e52]">
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
