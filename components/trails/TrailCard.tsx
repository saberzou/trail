"use client";

import { MoreVertical, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTrailsStore } from "@/lib/trails/store";
import { TRAIL_COLORS, type Trail } from "@/lib/trails/types";
import { TrailFormDialog } from "./TrailFormDialog";

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(ts).toLocaleDateString();
}

export function TrailCard({ trail }: { trail: Trail }) {
  const rename = useTrailsStore((s) => s.rename);
  const remove = useTrailsStore((s) => s.remove);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  return (
    <Card className="group relative gap-0 overflow-hidden p-0 transition-shadow hover:shadow-md focus-within:ring-2 focus-within:ring-ring">
      {/* Stretched link: covers the whole card so the entire surface opens the
          trail, while staying a keyboard-focusable anchor. The action menu
          sits above it via z-10 so its clicks don't navigate. */}
      <Link className="absolute inset-0 z-0" href={`/trail/${trail.id}`}>
        <span className="sr-only">Open {trail.name}</span>
      </Link>
      <div
        aria-hidden="true"
        className="h-1.5 w-full"
        style={{ backgroundColor: TRAIL_COLORS[trail.color] }}
      />
      <CardHeader className="gap-1.5 p-5">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-snug">{trail.name}</CardTitle>

          <div className="-mr-2 -mt-1 relative z-10 shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label="Trail actions"
                  className="size-8 text-muted-foreground"
                  size="icon"
                  variant="ghost"
                >
                  <MoreVertical />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <TrailFormDialog
                  description="Update this trail's name, description, or color."
                  initial={{
                    name: trail.name,
                    description: trail.description,
                    color: trail.color,
                  }}
                  onSubmit={(values) => rename(trail.id, values)}
                  submitLabel="Save changes"
                  title="Edit trail"
                  trigger={
                    <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                      <Pencil />
                      Edit
                    </DropdownMenuItem>
                  }
                />
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={(e) => {
                    e.preventDefault();
                    setConfirmOpen(true);
                  }}
                  variant="destructive"
                >
                  <Trash2 />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {trail.description ? (
          <CardDescription className="line-clamp-2">
            {trail.description}
          </CardDescription>
        ) : (
          <CardDescription className="italic opacity-70">
            No description
          </CardDescription>
        )}
        <p className="mt-2 text-muted-foreground text-xs">
          Opened {formatRelative(trail.lastOpenedAt)}
        </p>
      </CardHeader>

      <AlertDialog onOpenChange={setConfirmOpen} open={confirmOpen}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{trail.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes the trail along with its canvas and chat
              history. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleting}
              onClick={async (e) => {
                e.preventDefault();
                setDeleting(true);
                try {
                  await remove(trail.id);
                } finally {
                  setDeleting(false);
                  setConfirmOpen(false);
                }
              }}
            >
              {deleting ? "Deleting…" : "Delete trail"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
