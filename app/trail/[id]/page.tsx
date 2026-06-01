"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { getTrail } from "@/lib/trails/persistence";
import { useTrailsStore } from "@/lib/trails/store";
import type { Trail } from "@/lib/trails/types";

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

type LoadState =
  | { status: "loading" }
  | { status: "missing" }
  | { status: "ready"; trail: Trail };

export default function TrailWorkspacePage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const touch = useTrailsStore((s) => s.touch);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    getTrail(id)
      .then((trail) => {
        if (!alive) return;
        if (!trail) {
          setState({ status: "missing" });
          return;
        }
        setState({ status: "ready", trail });
        void touch(id);
      })
      .catch((err) => {
        console.error("[trail] failed to load trail", err);
        if (alive) setState({ status: "missing" });
      });
    return () => {
      alive = false;
    };
  }, [id, touch]);

  if (state.status === "loading") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        Loading trail…
      </main>
    );
  }

  if (state.status === "missing") {
    return (
      <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <div className="space-y-1">
          <h1 className="font-semibold text-2xl">Trail not found</h1>
          <p className="text-muted-foreground text-sm">
            This trail may have been deleted.
          </p>
        </div>
        <Button asChild>
          <Link href="/">Back to all trails</Link>
        </Button>
      </main>
    );
  }

  const { trail } = state;

  return (
    <main className="fixed inset-0 flex bg-background">
      <ChatPanel trailId={trail.id} trailName={trail.name} />
      <div className="relative flex-1">
        <Link
          aria-label="Settings"
          className="absolute top-4 right-4 z-50 inline-flex h-8 w-8 items-center justify-center rounded-md border border-border bg-card text-foreground shadow-sm hover:bg-accent"
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
        <TrailCanvas trailId={trail.id} />
      </div>
    </main>
  );
}
