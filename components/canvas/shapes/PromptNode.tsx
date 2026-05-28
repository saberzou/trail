"use client";

export type PromptStatus = "idle" | "running" | "done" | "error";

export interface PromptNodeBodyProps {
  prompt: string;
  status: PromptStatus;
  error?: string;
  onChange: (next: string) => void;
  onRun: () => void;
  onKill: () => void;
}

export function PromptNodeBody({ prompt, status, error, onChange, onRun, onKill }: PromptNodeBodyProps) {
  return (
    <div className="flex h-full w-full flex-col gap-2 rounded-md border border-[#c9c8bd] bg-[#fef9c3] p-3 shadow-sm">
      <textarea
        className="flex-1 resize-none bg-transparent text-sm text-[#273321] outline-none placeholder:text-[#7a7a6e]"
        placeholder="Ask anything — agent will search and explore..."
        value={prompt}
        onChange={(e) => onChange(e.target.value)}
        onPointerDown={(e) => e.stopPropagation()}
      />
      <div className="flex items-center justify-between text-xs">
        <StatusPill status={status} />
        {status === "running" ? (
          <button type="button" onClick={onKill} className="rounded bg-[#dc2626] px-2 py-1 text-white">Stop</button>
        ) : (
          <button type="button" onClick={onRun} disabled={!prompt.trim()} className="rounded bg-[#273321] px-2 py-1 text-white disabled:opacity-50">Run</button>
        )}
      </div>
      {status === "error" && error ? <div className="text-xs text-[#dc2626]">{error}</div> : null}
    </div>
  );
}

function StatusPill({ status }: { status: PromptStatus }) {
  const label = { idle: "ready", running: "thinking…", done: "done", error: "error" }[status];
  const cls = { idle: "bg-[#e5e7eb]", running: "bg-[#fbbf24]", done: "bg-[#22c55e] text-white", error: "bg-[#dc2626] text-white" }[status];
  return <span className={`rounded px-2 py-0.5 ${cls}`}>{label}</span>;
}
