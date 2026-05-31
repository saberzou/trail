"use client";

import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  TRAIL_COLOR_KEYS,
  TRAIL_COLORS,
  type TrailColor,
} from "@/lib/trails/types";
import { cn } from "@/lib/utils";

export type TrailFormValues = {
  name: string;
  description: string;
  color: TrailColor;
};

type TrailFormDialogProps = {
  /** Element that opens the dialog (rendered via DialogTrigger asChild). */
  trigger: ReactNode;
  title: string;
  description: string;
  submitLabel: string;
  initial?: Partial<TrailFormValues>;
  onSubmit: (values: TrailFormValues) => Promise<void> | void;
};

export function TrailFormDialog({
  trigger,
  title,
  description,
  submitLabel,
  initial,
  onSubmit,
}: TrailFormDialogProps) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initial?.name ?? "");
  const [desc, setDesc] = useState(initial?.description ?? "");
  const [color, setColor] = useState<TrailColor>(
    initial?.color ?? TRAIL_COLOR_KEYS[0],
  );
  const [submitting, setSubmitting] = useState(false);

  // Reset the form to the latest initial values each time the dialog opens, so
  // an edit dialog reflects the current trail and a create dialog starts fresh.
  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setDesc(initial?.description ?? "");
    setColor(initial?.color ?? TRAIL_COLOR_KEYS[0]);
  }, [open, initial?.name, initial?.description, initial?.color]);

  const canSubmit = name.trim().length > 0 && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), description: desc.trim(), color });
      setOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="trail-name">Name</Label>
            <Input
              autoFocus
              id="trail-name"
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              placeholder="Plan a trip to Japan"
              value={name}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="trail-description">Description</Label>
            <Textarea
              id="trail-description"
              maxLength={280}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="What is this trail for? (optional)"
              rows={3}
              value={desc}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2">
              {TRAIL_COLOR_KEYS.map((key) => (
                <button
                  aria-label={key}
                  aria-pressed={color === key}
                  className={cn(
                    "size-7 rounded-full ring-offset-2 ring-offset-card transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    color === key && "ring-2 ring-ring",
                  )}
                  key={key}
                  onClick={() => setColor(key)}
                  style={{ backgroundColor: TRAIL_COLORS[key] }}
                  type="button"
                />
              ))}
            </div>
          </div>

          <DialogFooter>
            <Button
              onClick={() => setOpen(false)}
              type="button"
              variant="outline"
            >
              Cancel
            </Button>
            <Button disabled={!canSubmit} type="submit">
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
