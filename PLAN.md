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

### PR3 — Trails (multi-project) + IA + UI system (shipped)

- **Trails as projects.** Each Trail is a self-contained project with
  its own tldraw canvas and chat session. Metadata (name, description,
  color, timestamps) lives in a `trail-projects` IndexedDB store; canvas
  snapshots and chat history are now keyed per-trail in `trail-canvas` /
  `trail-chat` instead of a single global `main` key.
- **New information architecture.**
  - `/` — home page listing trails as cards, with create / rename /
    recolor / delete and an empty state.
  - `/trail/[id]` — the per-trail workspace (canvas + chat dock).
  - `/settings` — provider credentials, reachable from the home header
    and each trail's dock.
  - `/canvas` — redirects to the home page (back-compat).
- **One-time migration.** A pre-existing v1 global canvas + chat is
  folded into a "My first trail" project on first load.
- **shadcn/ui component layer** (`components/ui/*`) on Tailwind v4,
  themed to Trail's warm paper + forest palette via CSS design tokens.

### PR3.1 — Trail switcher + scenario test coverage (shipped)

- In-workspace **trail switcher** in the chat dock (jump between trails,
  "New trail", "All trails") so you don't round-trip through home.
- **Flagship scenario tests** (`lib/canvas/scenarios.test.ts`) driving the
  real `runSessionTurn` pipeline with canned-but-faithful agent streams:
  "apply for a US visa" → task flow; "sites like nytimes.com" → cluster.
- **Resilience scenario tests** (`lib/canvas/scenarios-resilience.test.ts`):
  grounding-failure → downgraded explore cluster; no-fetch → prior-knowledge
  link cluster; mid-run Stop → friendly "Stopped." with no half-built chain.

### PR4 — next iteration (prioritized)

Grounded in gaps found while testing PR3. Ordered by value/effort.

1. ~~**Surface the downgrade note in chat.**~~ ✅ Shipped — `ChatPanel` now
   posts a one-line note when a task downgrades to an explore cluster.
2. ~~**Reconcile task-flow orientation.**~~ ✅ Shipped — task flows now lay
   out as a **vertical** top-to-bottom column (`placeTileInColumn`); doc,
   code, and arrow routing agree.
3. ~~**Step state (todo / done).**~~ ✅ Shipped — optional `stepState` prop +
   header done-toggle (strikes the title, dims the tile). Downstream
   propagation still TODO.
4. **Tune the iframe load deadline.** The 1.5s `IframeBody` fallback fires on
   slow networks before a perfectly framable page finishes loading, demoting
   it to a screenshot/link unnecessarily. Make it adaptive (e.g. 4–5s, or
   cancel the timer on first `load` progress). *Small.*
5. ~~**Renderer CORS / CLI port wiring.**~~ ✅ Shipped — the `trail` CLI now
   passes the renderer URL to the browser bundle; plus a Chromium watchdog.
6. ~~**Auth-wall classifier.**~~ ✅ Shipped — `looksAuthWalled` (high-precision
   heuristic) downgrades obvious sign-in URLs to `link` tiles in both the
   agent's `nodeFromStep` and the URL-paste path.
7. **Related-sites embedding ranker.** Today the radial cluster spaces tiles
   uniformly. Rank by similarity to the seed and map similarity → proximity
   so the layout actually means something. *Medium/large. (Needs an
   embeddings API — same egress/keys constraint as the agent.)*
8. **Downstream done-propagation.** Marking a task step done could cascade /
   visually de-emphasize later steps. Needs the per-run flow graph. *Medium.*

### Backlog

- Multi-tab `BroadcastChannel` sync of canvas + chat state.
- Cost telemetry (per-session token + screenshot counts) in `/settings`.
- Sentry (or a slim self-hosted error sink) for the renderer process.
- Archive snapshots — keep the HTML + screenshot at the time a tile was
  created, so an answer reproduced months later still resolves.
- JSON export / import of a trail; home-page search / filter / reorder.
- Accessibility pass (focus order, keyboard nav of canvas tiles, ARIA on
  the switcher).
- An end-to-end agent test behind an opt-in env flag (real key) so the
  model + search + quote-validator path has at least one live smoke test.

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
