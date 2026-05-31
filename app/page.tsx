"use client";

import { Plus, Settings } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { TrailCard } from "@/components/trails/TrailCard";
import { TrailFormDialog } from "@/components/trails/TrailFormDialog";
import { Button } from "@/components/ui/button";
import { hydrateTrails, useTrailsStore } from "@/lib/trails/store";

export default function HomePage() {
  const router = useRouter();
  const hydrated = useTrailsStore((s) => s.hydrated);
  const trails = useTrailsStore((s) => s.trails);
  const create = useTrailsStore((s) => s.create);

  useEffect(() => {
    if (typeof indexedDB === "undefined") return;
    void hydrateTrails();
  }, []);

  const newTrailButton = (
    <Button size="lg">
      <Plus />
      New trail
    </Button>
  );

  const newTrailDialog = (
    <TrailFormDialog
      description="A trail is its own project — a fresh canvas and chat session for one task."
      onSubmit={async (values) => {
        const trail = await create(values);
        router.push(`/trail/${trail.id}`);
      }}
      submitLabel="Create trail"
      title="New trail"
      trigger={newTrailButton}
    />
  );

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-border border-b">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2.5">
            <span
              aria-hidden="true"
              className="inline-block size-5 rounded-md bg-primary"
            />
            <span className="font-semibold text-lg tracking-tight">Trail</span>
          </div>
          <Button asChild size="sm" variant="ghost">
            <Link href="/settings">
              <Settings />
              Settings
            </Link>
          </Button>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1">
            <h1 className="font-semibold text-3xl tracking-tight">
              Your trails
            </h1>
            <p className="text-muted-foreground text-sm">
              Each trail is a self-contained project with its own canvas and
              agent session.
            </p>
          </div>
          {hydrated && trails.length > 0 ? newTrailDialog : null}
        </div>

        <div className="mt-8">
          {!hydrated ? (
            <GridSkeleton />
          ) : trails.length === 0 ? (
            <EmptyState dialog={newTrailDialog} />
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {trails.map((trail) => (
                <TrailCard key={trail.id} trail={trail} />
              ))}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div
          className="h-36 animate-pulse rounded-xl border border-border bg-muted/40"
          key={i}
        />
      ))}
    </div>
  );
}

function EmptyState({ dialog }: { dialog: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-5 rounded-xl border border-border border-dashed bg-card/40 px-6 py-20 text-center">
      <div className="space-y-1.5">
        <h2 className="font-semibold text-xl">Start your first trail</h2>
        <p className="mx-auto max-w-sm text-muted-foreground text-sm">
          Create a trail to open a fresh spatial canvas and chat with the agent
          about a single task or topic.
        </p>
      </div>
      {dialog}
    </div>
  );
}
