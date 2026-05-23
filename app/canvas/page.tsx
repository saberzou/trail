"use client";

import dynamic from "next/dynamic";

const TrailCanvas = dynamic(
  () =>
    import("@/components/canvas/TrailCanvas").then(
      (module) => module.TrailCanvas,
    ),
  { ssr: false },
);

export default function CanvasPage() {
  return <TrailCanvas />;
}
