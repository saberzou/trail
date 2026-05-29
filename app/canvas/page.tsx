"use client";

import dynamic from "next/dynamic";
import Link from "next/link";

const TrailCanvas = dynamic(
  () =>
    import("@/components/canvas/TrailCanvas").then(
      (module) => module.TrailCanvas,
    ),
  { ssr: false },
);

const ChatPanel = dynamic(
  () =>
    import("@/components/chat/ChatPanel").then((module) => module.ChatPanel),
  { ssr: false },
);

export default function CanvasPage() {
  return (
    <main className="fixed inset-0 flex bg-[#f4f1e8]">
      <ChatPanel />
      <div className="relative flex-1">
        <Link
          aria-label="Settings"
          className="absolute top-4 right-4 z-50 inline-flex h-8 w-8 items-center justify-center rounded border border-[#c9c8bd] bg-white text-[#273321] shadow-sm hover:bg-[#f0f0e8]"
          href="/settings"
        >
          <svg
            aria-hidden="true"
            className="h-4 w-4"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z"
              stroke="currentColor"
              strokeWidth="1.8"
            />
            <path
              d="M19.4 15a8.1 8.1 0 0 0 .1-1.2 8.1 8.1 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7.8 7.8 0 0 0-2-1.2L14.6 5h-5.2L9 7.4a7.8 7.8 0 0 0-2 1.2l-2.4-1-2 3.5 2 1.5a8.1 8.1 0 0 0-.1 1.2 8.1 8.1 0 0 0 .1 1.2l-2 1.5 2 3.5 2.4-1a7.8 7.8 0 0 0 2 1.2l.4 2.4h5.2l.4-2.4a7.8 7.8 0 0 0 2-1.2l2.4 1 2-3.5-2-1.5Z"
              stroke="currentColor"
              strokeLinejoin="round"
              strokeWidth="1.8"
            />
          </svg>
        </Link>
        <TrailCanvas />
      </div>
    </main>
  );
}
