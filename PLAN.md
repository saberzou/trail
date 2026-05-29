# Trail — v2 Plan

A spatial canvas for the web, driven by an AI agent. You talk to one master
agent in the left dock; the canvas fills with **webpage tiles** — live pages,
screenshots, or rich link cards. The agent can plan a sequence of pages for
a task (vertical task flow) or fan out related sources for exploration
(radial cluster), grounded in search results with verbatim quotes.

This file is the roadmap. For quick-start instructions, see
[`README.md`](./README.md).

---

## Product vision

- **One master agent in a left chat dock.** Free-form chat plus the URL-paste
  shortcut. The agent has tools for search, fetch, and canvas authorship.
- **A canvas of webpage tiles.** Each tile is a custom tldraw shape with
  three render modes — live `iframe` when the site allows framing, a
  Playwright `screenshot` when it doesn't, and a `link` card as the
  final fallback (auth walls, screenshot failures, sidecar down).
- **Two output modes.**
  - **Task flow** — a top-to-bottom column of tiles, the steps needed to
    finish a goal ("apply for a passport"), with a done-toggle on each step.
  - **Exploration cluster** — a radial fan of related sources around a seed
    tile, for research and shopping.
- **Search grounding with verbatim-quote validation.** When the agent claims
  a fact about a page, it cites a `sourceQuote` from that page's extracted
  text. A validator rejects model output where the quote isn't actually a
  substring of the source — so the model can't pad with made-up citations.
- **Link mode for auth-walled flows.** Pages behind a login (e.g. a personal
  bank dashboard, a Stripe checkout the user has to complete) are added as
  link cards with a one-click "open in new tab." The user finishes the
  human-only step out-of-canvas and comes back.
- **Local Playwright sidecar.** A separate Node process at
  `127.0.0.1:3001` runs Chromium for screenshots and an iframeability probe.
  The browser calls it directly — no Next.js API proxy in the path. Loopback
  binding is the trust boundary.

---

## Architecture sketch

```
+--------------------+        +----------------------+
| Browser (Next.js)  |        | trail-renderer.mjs   |
|                    |        | Node + Playwright    |
| ChatPanel  ───────▶│ POST   │                      |
| WebpageNode shape  │ /probe │ /probe   /screenshot |
|                    │ /shot  │ /health              |
| IndexedDB:         │        │ Disk cache:          |
|  - trail-canvas    │        │  ~/.trail/cache/     |
|  - trail-chat      │        │   screenshots/<sha>  |
|  - trail-settings  │        │                      |
+---------┬──────────+        +----------------------+
          │ same-origin
          ▼
+--------------------+
| Next.js server     |
| /api/copilot/*     |  (OAuth dance only)
+--------------------+
```

Two processes, supervised by the `trail` CLI: PID file per process,
`/health` probe before the CLI considers the sidecar ready, a `tail -f`
view over both logs.

---

## Roadmap

### PR1 — Foundation + teardown (merged)

- Next.js 15 + tldraw v3 scaffold.
- `/settings` page with AES-GCM-encrypted provider credentials in
  IndexedDB.
- Canvas persists tldraw snapshots to IndexedDB with debounced saves.
- `trail` CLI for starting/stopping Next.js, log tailing, rebuilds.

### PR2a — Playwright sidecar + ChatPanel + WebpageNode rewrite (this PR)

- `scripts/trail-renderer.mjs` — local Node sidecar that launches
  Chromium, exposes `/screenshot`, `/probe`, and `/health`, caches PNGs
  on disk for 24h keyed by `sha256(url + viewport)`.
- `WebpageNode` rewritten with three render modes (iframe / screenshot /
  link), auto-fallback to link mode on iframe-blocked or screenshot
  failure, sandbox locked to `allow-scripts allow-forms` (without
  `allow-same-origin`, which would defeat sandboxing).
- `ChatPanel` left dock with URL-paste detection → a pasted URL becomes
  a canvas tile placed at the current viewport center.
- `lib/idb/saver.ts` extracted so canvas + chat share one debounced
  saver.
- `lib/chat/persistence.ts` for IndexedDB chat history with version
  handling.
- `trail` CLI supervises both Next.js + renderer with separate PIDs
  and log files; new `trail install-renderer` downloads Chromium.

### PR2b — Master agent session

- `/api/agent/session` SSE route + `lib/agent/session.ts` driving a
  streamed loop over the AI SDK.
- `build_flow` structured-output tool defined with Zod — the model
  returns a typed list of `{ url, title, summary, sourceQuote }`
  objects.
- `sourceQuote` validator — for each returned tile, verifies the quote
  is a verbatim substring of the page's extracted text. Mismatches
  retry with the failing item flagged; persistent failures get
  downgraded to a `link` tile without a summary.
- Retry/downgrade policy: 1 retry, then degrade silently and surface a
  one-line note in chat.

### PR2c — Layouts + step state

- Vertical **task layout** — top-to-bottom column with consistent
  spacing, edges as straight verticals between steps.
- Radial **explore layout** — seed at center, related tiles distributed
  around with proximity ∝ similarity (initially uniform; PR3 adds an
  embedding ranker).
- `stepState` prop on `WebpageNode` (`todo` / `done`) and a
  done-toggle in the header bar that propagates to downstream tiles.

### Beyond PR2c

- Related-sites embedding ranker so the radial layout is meaningful.
- Multi-tab `BroadcastChannel` sync of canvas + chat state.
- Cost telemetry (per-session token + screenshot counts) in `/settings`.
- Sentry (or a slim self-hosted error sink) for the renderer process.
- Archive snapshots — keep the HTML + screenshot at the time a tile was
  created, so an answer reproduced months later still resolves.
- Multi-project workspaces, project switcher, JSON export (was Phase 2
  of the original plan; deferred until single-project feels right).

---

## Open questions

1. **Search providers.** Brave + Tavily are configured in
   `/settings` from PR1, but PR2b is the first time we actually call
   them. Order of preference and fallback semantics TBD when we wire
   the tool.
2. **Auth-walled detection.** Iframe + screenshot can both succeed on
   a login page that's useless to the user. PR2b will likely need a
   "this page wants a login" classifier so the agent can downgrade to
   a `link` card with instructions.
3. **Renderer lifecycle.** Today the sidecar runs as long as the user's
   `trail` session is up. If Chromium dies, we don't restart it. PR2b
   or earlier should add a watchdog.

See [`README.md`](./README.md) for install and usage.
