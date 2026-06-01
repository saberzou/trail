"use client";

import { Check, ChevronsUpDown, LayoutGrid, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { hydrateTrails, useTrailsStore } from "@/lib/trails/store";
import { TRAIL_COLORS } from "@/lib/trails/types";
import { TrailFormDialog } from "./TrailFormDialog";

/**
 * Lets the user jump between trails (or create one / go to the trail list)
 * straight from the workspace chat dock, without a round-trip to the home
 * page. The current trail name doubles as the dropdown trigger.
 */
export function TrailSwitcher({
  currentTrailId,
  currentTrailName,
}: {
  currentTrailId: string;
  currentTrailName: string;
}) {
  const router = useRouter();
  const trails = useTrailsStore((s) => s.trails);
  const create = useTrailsStore((s) => s.create);

  useEffect(() => {
    if (typeof indexedDB === "undefined") return;
    void hydrateTrails();
  }, []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          className="-ml-2 h-7 max-w-[220px] gap-1.5 px-2 font-semibold text-[15px]"
          size="sm"
          variant="ghost"
        >
          <span className="truncate">{currentTrailName}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        <div className="px-2 py-1.5 font-medium text-[11px] text-muted-foreground uppercase tracking-wider">
          Switch trail
        </div>
        <div className="max-h-64 overflow-y-auto">
          {trails.map((t) => (
            <DropdownMenuItem asChild key={t.id}>
              <Link href={`/trail/${t.id}`}>
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: TRAIL_COLORS[t.color] }}
                />
                <span className="truncate">{t.name}</span>
                {t.id === currentTrailId ? (
                  <Check className="ml-auto size-4 shrink-0" />
                ) : null}
              </Link>
            </DropdownMenuItem>
          ))}
        </div>
        <DropdownMenuSeparator />
        <TrailFormDialog
          description="A trail is its own project — a fresh canvas and chat session for one task."
          onSubmit={async (values) => {
            const trail = await create(values);
            router.push(`/trail/${trail.id}`);
          }}
          submitLabel="Create trail"
          title="New trail"
          trigger={
            <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
              <Plus />
              New trail
            </DropdownMenuItem>
          }
        />
        <DropdownMenuItem asChild>
          <Link href="/">
            <LayoutGrid />
            All trails
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
