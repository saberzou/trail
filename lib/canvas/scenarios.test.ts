// @vitest-environment node
//
// Flagship scenario tests for the two things Trail's agent is *for*:
//
//   1. "apply for a US visa"  → a TASK flow: ordered, authoritative sites laid
//      out as a top-to-bottom column of steps wired by arrows.
//   2. "sites like nytimes.com" → an EXPLORE cluster: related sites fanned in a
//      radial ring around the seed tile, each joined to it by a spoke arrow.
//
// These drive the REAL session→canvas pipeline (`runSessionTurn`) with the
// exact SessionEvent stream the agent emits — only the model/search round-trip
// is replaced by a canned SSE body, so no API keys are needed. They assert the
// structure a user actually sees: tile count, ordering, layout geometry, and
// the arrows between tiles.
import type { TLShapeId } from "tldraw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionEvent, SessionRequest } from "@/lib/agent/session";
import { _resetLayoutStates, runSessionTurn } from "./agentClient";

const TILE_W = 320;
const TILE_H = 220;
const COLUMN_STEP = 260;
const RADIAL_RADIUS = 360;

type MockEditor = {
  createShape: ReturnType<typeof vi.fn>;
  createBindings: ReturnType<typeof vi.fn>;
  getViewportPageBounds: ReturnType<typeof vi.fn>;
};

function makeEditor(center = { x: 0, y: 0 }): MockEditor {
  return {
    createShape: vi.fn(),
    createBindings: vi.fn(),
    getViewportPageBounds: vi.fn(() => ({ center })),
  };
}

function sseResponse(events: SessionEvent[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      for (const e of events) {
        controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

const baseReq: SessionRequest = {
  messages: [
    { id: "m1", role: "user", text: "apply for a US visa", createdAt: 1 },
  ],
  canvasContext: [],
  providerId: "openai",
  apiKey: "sk-test",
};

describe("scenario: apply for a US visa → task flow", () => {
  beforeEach(() => _resetLayoutStates());
  afterEach(() => _resetLayoutStates());

  // The ordered, authoritative steps a real "task" turn would emit. Login /
  // form-walled steps (DS-160, fee payment, scheduling) ship as `link` tiles;
  // informational pages ship as `screenshot`. This mirrors nodeFromStep().
  const visaFlow: SessionEvent[] = [
    {
      kind: "flow_meta",
      intent: "task",
      title: "Apply for a U.S. B-1/B-2 visitor visa",
      downgraded: false,
    },
    {
      kind: "node",
      nodeId: "step1",
      title: "Visitor visas (B-1/B-2) overview",
      url: "https://travel.state.gov/content/travel/en/us-visas/tourism-visit/visitor.html",
      hostname: "travel.state.gov",
      mode: "screenshot",
      summary: "Confirm the B-1/B-2 visitor visa is the right category.",
    },
    {
      kind: "node",
      nodeId: "step2",
      title: "Complete the DS-160 online form",
      url: "https://ceac.state.gov/genniv/",
      hostname: "ceac.state.gov",
      mode: "link",
      summary: "Fill out and submit Form DS-160; save the confirmation page.",
    },
    {
      kind: "node",
      nodeId: "step3",
      title: "Pay the visa application fee",
      url: "https://www.ustraveldocs.com/",
      hostname: "ustraveldocs.com",
      mode: "link",
      summary: "Create a profile and pay the MRV fee.",
    },
    {
      kind: "node",
      nodeId: "step4",
      title: "Schedule your visa interview",
      url: "https://www.ustraveldocs.com/schedule",
      hostname: "ustraveldocs.com",
      mode: "link",
      summary: "Book an appointment at your embassy or consulate.",
    },
    {
      kind: "node",
      nodeId: "step5",
      title: "Attend the interview at the U.S. Embassy",
      url: "https://www.usembassy.gov/",
      hostname: "usembassy.gov",
      mode: "screenshot",
      summary: "Bring your DS-160 confirmation, passport, and fee receipt.",
    },
    { kind: "done", runId: "visa-run" },
  ];

  it("lays the steps out as an ordered top-to-bottom column with connecting arrows", async () => {
    const editor = makeEditor({ x: 0, y: 0 });
    const fetchMock = vi.fn(async () => sseResponse(visaFlow));

    await runSessionTurn(
      editor as unknown as Parameters<typeof runSessionTurn>[0],
      baseReq,
      new AbortController().signal,
      { runId: "visa", fetchImpl: fetchMock as unknown as typeof fetch },
    );

    const shapes = editor.createShape.mock.calls.map((c) => c[0]);
    const tiles = shapes.filter((s) => s.type === "webpage");
    const arrows = shapes.filter((s) => s.type === "arrow");

    // Five real steps → five tiles, four arrows chaining them in order.
    expect(tiles).toHaveLength(5);
    expect(arrows).toHaveLength(4);

    // Order is preserved exactly as the agent emitted it.
    expect(tiles.map((t) => t.props.title)).toEqual([
      "Visitor visas (B-1/B-2) overview",
      "Complete the DS-160 online form",
      "Pay the visa application fee",
      "Schedule your visa interview",
      "Attend the interview at the U.S. Embassy",
    ]);
    expect(tiles[0].props.url).toContain("travel.state.gov");
    expect(tiles[1].props.url).toContain("ceac.state.gov");

    // Steps march top-to-bottom at a constant x (a readable checklist).
    for (let i = 1; i < tiles.length; i++) {
      expect(tiles[i].y - tiles[i - 1].y).toBe(COLUMN_STEP);
      expect(tiles[i].x).toBe(tiles[0].x);
    }

    // Login/form-walled steps degrade to link tiles (wider 360×200), the rest
    // are screenshot tiles (320×220) — so the user never stares at a blank
    // auth wall.
    expect(tiles[1].props.mode).toBe("link"); // DS-160
    expect(tiles[1].props.w).toBe(360);
    expect(tiles[0].props.mode).toBe("screenshot");
    expect(tiles[0].props.w).toBe(320);

    // The instruction rides along as the tile summary.
    expect(tiles[0].props.summary).toMatch(/B-1\/B-2 visitor visa/);

    // Each arrow is bound at both ends, chaining consecutive steps.
    expect(editor.createBindings).toHaveBeenCalledTimes(4);
    for (const call of editor.createBindings.mock.calls) {
      const [start, end] = call[0];
      expect(start.props.terminal).toBe("start");
      expect(end.props.terminal).toBe("end");
    }
  });
});

describe("scenario: sites like nytimes.com → exploration cluster", () => {
  beforeEach(() => _resetLayoutStates());
  afterEach(() => _resetLayoutStates());

  const related: SessionEvent[] = [
    {
      kind: "flow_meta",
      intent: "explore",
      title: "News sites related to nytimes.com",
      downgraded: false,
    },
    ...[
      [
        "The Washington Post",
        "https://www.washingtonpost.com/",
        "washingtonpost.com",
      ],
      ["The Guardian", "https://www.theguardian.com/", "theguardian.com"],
      ["Reuters", "https://www.reuters.com/", "reuters.com"],
      ["AP News", "https://apnews.com/", "apnews.com"],
      ["BBC News", "https://www.bbc.com/news", "bbc.com"],
      ["The Wall Street Journal", "https://www.wsj.com/", "wsj.com"],
    ].map(
      ([title, url, hostname], i): SessionEvent => ({
        kind: "node",
        nodeId: `rel${i}`,
        title,
        url,
        hostname,
        mode: "screenshot",
      }),
    ),
    { kind: "done", runId: "explore-run" },
  ];

  it("fans the related sites into a radial ring with spokes from the seed tile", async () => {
    const editor = makeEditor({ x: 0, y: 0 });
    const fetchMock = vi.fn(async () => sseResponse(related));
    // The seed (nytimes.com) tile already exists on the canvas; the cluster
    // forms around it and spokes bind back to it.
    const seedShapeId = "shape:nytimes-seed" as TLShapeId;
    const seed = { x: 1000, y: 1000 };

    await runSessionTurn(
      editor as unknown as Parameters<typeof runSessionTurn>[0],
      baseReq,
      new AbortController().signal,
      {
        runId: "explore",
        anchorPos: seed,
        anchorShapeId: seedShapeId,
        fetchImpl: fetchMock as unknown as typeof fetch,
      },
    );

    const shapes = editor.createShape.mock.calls.map((c) => c[0]);
    const tiles = shapes.filter((s) => s.type === "webpage");
    const arrows = shapes.filter((s) => s.type === "arrow");

    // Six related sites → six tiles + six spokes (one per tile).
    expect(tiles).toHaveLength(6);
    expect(arrows).toHaveLength(6);
    expect(tiles.map((t) => t.props.hostname)).toEqual([
      "washingtonpost.com",
      "theguardian.com",
      "reuters.com",
      "apnews.com",
      "bbc.com",
      "wsj.com",
    ]);

    // Every tile's CENTER sits on a circle of radius 360 around the seed —
    // i.e. a real radial cluster, not a pile at the viewport center.
    for (const t of tiles) {
      const cx = t.x + TILE_W / 2;
      const cy = t.y + TILE_H / 2;
      const dist = Math.hypot(cx - seed.x, cy - seed.y);
      expect(dist).toBeCloseTo(RADIAL_RADIUS, 5);
    }
    // The first related tile lands directly to the right of the seed (angle 0).
    expect(tiles[0].x + TILE_W / 2).toBeCloseTo(seed.x + RADIAL_RADIUS, 5);
    expect(tiles[0].y + TILE_H / 2).toBeCloseTo(seed.y, 5);

    // Each spoke starts at the seed tile and ends at a related tile.
    expect(editor.createBindings).toHaveBeenCalledTimes(6);
    for (const call of editor.createBindings.mock.calls) {
      const [start, end] = call[0];
      expect(start.props.terminal).toBe("start");
      expect(start.toId).toBe(seedShapeId);
      expect(end.props.terminal).toBe("end");
    }
  });
});
