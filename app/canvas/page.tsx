import { redirect } from "next/navigation";

/**
 * `/canvas` was the single global workspace in Trail v1. The workspace is now
 * per-Trail at `/trail/[id]`, so this route just sends people to the trail
 * list, where they can open or create one.
 */
export default function CanvasPage() {
  redirect("/");
}
