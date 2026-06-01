/**
 * A Trail is a self-contained project: its own canvas, its own chat session.
 * The metadata here lives in the `trail-projects` IndexedDB database; the
 * heavy per-trail state (tldraw snapshot, chat history) lives in the
 * `trail-canvas` / `trail-chat` databases keyed by the trail's id.
 */
export type Trail = {
  id: string;
  name: string;
  description: string;
  /** One of TRAIL_COLORS — drives the card accent. */
  color: TrailColor;
  createdAt: number;
  updatedAt: number;
  /** Last time the trail's workspace was opened — drives "Recent" sorting. */
  lastOpenedAt: number;
};

export type TrailColor =
  | "forest"
  | "olive"
  | "clay"
  | "ochre"
  | "slate"
  | "plum";

/** Accent swatches for trail cards, in the warm Trail palette. */
export const TRAIL_COLORS: Record<TrailColor, string> = {
  forest: "#2f4f34",
  olive: "#5f6f52",
  clay: "#9c5b4b",
  ochre: "#b07d2b",
  slate: "#4a5560",
  plum: "#6b4a63",
};

export const TRAIL_COLOR_KEYS = Object.keys(TRAIL_COLORS) as TrailColor[];

export type NewTrailInput = {
  name: string;
  description?: string;
  color?: TrailColor;
};
