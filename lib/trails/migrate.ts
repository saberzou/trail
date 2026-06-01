import { nanoid } from "nanoid";
import { LEGACY_KEY as CANVAS_LEGACY } from "@/lib/canvas/persistence";
import { LEGACY_KEY as CHAT_LEGACY } from "@/lib/chat/persistence";
import { openTrailDb } from "@/lib/idb/open";
import { listTrails, putTrail } from "./persistence";
import type { Trail } from "./types";

function snapshotHasShapes(snap: unknown): boolean {
  if (!snap || typeof snap !== "object") return false;
  const store = (snap as { store?: Record<string, unknown> }).store;
  return !!store && Object.keys(store).length > 0;
}

function historyHasMessages(hist: unknown): boolean {
  if (!hist || typeof hist !== "object") return false;
  const messages = (hist as { messages?: unknown[] }).messages;
  return Array.isArray(messages) && messages.length > 0;
}

/**
 * Trail v1 kept a single global canvas + chat under the IDB key "main".
 * The first time the v2 (per-Trail) UI loads, fold that orphaned state into
 * a real Trail so nothing the user built is lost. Runs at most once: it only
 * fires when the trails DB is empty, and it deletes the legacy "main" keys
 * after re-keying so a later "delete all trails" can't resurrect it.
 */
export async function migrateLegacyTrail(): Promise<Trail | null> {
  if ((await listTrails()).length > 0) return null;

  const canvasDb = await openTrailDb("trail-canvas", "snapshots", 1);
  let canvasSnap: unknown;
  try {
    canvasSnap = await canvasDb.get("snapshots", CANVAS_LEGACY);
  } finally {
    canvasDb.close();
  }

  const chatDb = await openTrailDb("trail-chat", "history", 1);
  let chatHist: unknown;
  try {
    chatHist = await chatDb.get("history", CHAT_LEGACY);
  } finally {
    chatDb.close();
  }

  const hasCanvas = snapshotHasShapes(canvasSnap);
  const hasChat = historyHasMessages(chatHist);
  if (!hasCanvas && !hasChat) return null;

  const now = Date.now();
  const trail: Trail = {
    id: nanoid(),
    name: "My first trail",
    description: "Imported from your earlier Trail session.",
    color: "forest",
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
  };
  await putTrail(trail);

  if (hasCanvas) {
    const cd = await openTrailDb("trail-canvas", "snapshots", 1);
    try {
      await cd.put("snapshots", canvasSnap, trail.id);
      await cd.delete("snapshots", CANVAS_LEGACY);
    } finally {
      cd.close();
    }
  }
  if (hasChat) {
    const hd = await openTrailDb("trail-chat", "history", 1);
    try {
      await hd.put("history", chatHist, trail.id);
      await hd.delete("history", CHAT_LEGACY);
    } finally {
      hd.close();
    }
  }

  return trail;
}
