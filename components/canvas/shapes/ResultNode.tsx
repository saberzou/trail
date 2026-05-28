"use client";

export interface ResultNodeBodyProps {
  title: string;
  url: string;
  summary: string;
  source: "search" | "fetch";
  onExploreSimilar: () => void;
}

export function ResultNodeBody({
  title,
  url,
  summary,
  source,
  onExploreSimilar,
}: ResultNodeBodyProps) {
  return (
    <div className="flex h-full w-full flex-col gap-2 rounded-md border border-[#c9c8bd] bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-sm font-medium text-[#273321]">{title}</h3>
        <span className="rounded bg-[#e5e7eb] px-1.5 py-0.5 text-[10px] text-[#4b5563]">
          {source}
        </span>
      </div>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        onPointerDown={(e) => e.stopPropagation()}
        className="truncate text-xs text-[#2563eb] hover:underline"
      >
        {url}
      </a>
      <p className="flex-1 overflow-y-auto text-xs leading-relaxed text-[#374151]">
        {summary}
      </p>
      <button
        type="button"
        onClick={onExploreSimilar}
        onPointerDown={(e) => e.stopPropagation()}
        className="self-start rounded border border-[#c9c8bd] px-2 py-1 text-xs text-[#273321] hover:bg-[#f0f0e8]"
      >
        Explore similar →
      </button>
    </div>
  );
}
