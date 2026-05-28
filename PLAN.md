# Trail — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** A self-hosted, single-user web app where an AI agent turns any prompt into a living, spatial canvas of web pages — explorable like Pinterest, structured like a task graph when needed, archived so it never rots.

**Architecture:**
Next.js 15 (App Router) + tldraw v3 SDK for the canvas. Custom tldraw shapes (`WebpageNode`, `StickyNode`, `StepNode`) hold web artifacts. A backend agent loop (Node, streaming via Vercel AI SDK) reads canvas state, calls Brave/Tavily for search, Playwright for screenshot + HTML archive, and an LLM (Claude Opus 4.7 via Saber's existing Hermes/Copilot relay or direct Anthropic) for classification, summarization, and "find similar" expansion. State lives in SQLite (Drizzle ORM) — projects, nodes, edges, sticky notes, snapshots. Screenshots and HTML snapshots saved to local disk under `data/snapshots/<project>/<node>/`. Each node carries three render modes — live iframe, screenshot card, or self-hosted archived HTML — auto-selected from the page's `X-Frame-Options` / `CSP` headers.

**Tech Stack:**
- Frontend: Next.js 15, React 19, TypeScript, tldraw v3, TailwindCSS, shadcn/ui for chrome
- Backend: Next.js Route Handlers + Server Actions, Vercel AI SDK (`ai` package) for streaming, Anthropic SDK
- Data: SQLite + Drizzle ORM, local FS for blobs
- Web tooling: Playwright (`playwright-core` + Chromium), Brave Search API, Tavily API (`tavily-js`), `@mozilla/readability` for content extraction
- Dev: pnpm, biome (lint + format), vitest, playwright test
- Deploy: self-hosted on Saber's machine, `pnpm dev` for now; Docker compose in Phase 2

---

## Guiding Principles

- **Canvas is shared memory.** The agent reads the canvas (your selections, sticky notes, existing nodes) and writes back to it. Sticky notes are first-class agent instructions.
- **Mode is a runtime decision, not a separate product.** Main agent classifies each user message as `explore` or `task` and routes; user can flip manually per project.
- **Snapshots are mandatory.** Every node gets a Playwright screenshot + HTML archive at creation time. The canvas never rots.
- **Three render modes per node, auto-detected:** live iframe (when allowed), screenshot card (default fallback), archived HTML (served from our origin, always works).
- **DRY, YAGNI, TDD, frequent commits.** Every task ships green tests and a commit.

---

## Phase 0 — Spike (proves the rendering works)

### Task 0.1: Scaffold the Next.js project

**Objective:** Empty Next.js 15 + TS + Tailwind + Biome project, committed.

**Files:**
- Create: `package.json`, `tsconfig.json`, `biome.json`, `next.config.ts`, `app/layout.tsx`, `app/page.tsx`, `app/globals.css`

**Steps:**
1. `pnpm create next-app@latest trail --typescript --tailwind --app --src-dir=false --import-alias="@/*" --turbopack` then `cd trail`
2. `pnpm add -D @biomejs/biome vitest @testing-library/react @testing-library/jest-dom jsdom`
3. `pnpm dlx @biomejs/biome init`
4. Verify: `pnpm dev` shows the Next.js welcome page at `http://localhost:3000`
5. Commit: `git init && git add . && git commit -m "chore: scaffold Next.js 15 + TS + Tailwind + Biome"`

### Task 0.2: Mount tldraw with a single hardcoded WebpageNode

**Objective:** tldraw renders fullscreen with one custom shape — a card showing title + thumbnail URL + summary text. Hardcoded, no data layer.

**Files:**
- Create: `app/canvas/page.tsx`
- Create: `components/canvas/TrailCanvas.tsx`
- Create: `components/canvas/shapes/WebpageNode.tsx`
- Create: `components/canvas/shapes/WebpageNodeUtil.ts`

**Steps:**
1. `pnpm add tldraw@latest` (verify v3.x)
2. Create `WebpageNodeUtil.ts` extending `ShapeUtil<WebpageNodeShape>` with props `{ url, title, summary, screenshotUrl, mode: 'iframe'|'screenshot'|'archive' }`. Default to `screenshot` mode for now.
3. Create `WebpageNode.tsx` React component: 320×240 rounded card, image top, title + truncated summary, "open" button. Tailwind styling.
4. `TrailCanvas.tsx`: `<Tldraw shapeUtils={[WebpageNodeUtil]} onMount={editor => editor.createShape(...)} />` — create one hardcoded node on mount.
5. `app/canvas/page.tsx` is a thin client component that imports `TrailCanvas` dynamically (`{ ssr: false }`).
6. Verify: visit `/canvas`, see one card on the canvas, drag it around, zoom works.
7. Commit: `feat: render WebpageNode on tldraw canvas`

### Task 0.3: Three render modes inside WebpageNode

**Objective:** Same node component branches on `mode` prop — `iframe` shows live `<iframe sandbox>`, `screenshot` shows `<img>`, `archive` shows self-hosted HTML in iframe pointing at `/archive/<id>.html`. No real data yet — just three hardcoded examples on the canvas.

**Steps:**
1. Extend `WebpageNode.tsx` with switch on `mode`.
2. Add three hardcoded nodes in `TrailCanvas` onMount: one Wikipedia URL (iframe mode), one Amazon product (screenshot mode, use placeholder image), one fake archive (archive mode, placeholder HTML in `public/archive-demo.html`).
3. Verify visually: all three render correctly, iframe loads Wikipedia, archive loads our placeholder.
4. Commit: `feat: three render modes per WebpageNode`

**Phase 0 exit criteria:** Canvas renders, custom shape works, three render modes visible. ~1 evening of work.

---

## Phase 0.5 — BYO Provider Settings

**Status:** Complete.

Trail now has a `/settings` page for client-side provider credentials. Settings are encrypted with AES-GCM using a non-extractable Web Crypto key in IndexedDB, and the encrypted settings blob is also stored in IndexedDB. Saved API keys are masked in the UI, users can wipe all credentials, configured providers can be selected as defaults, and `/canvas` links to settings with a gear icon.

Supported providers:

- AI: OpenAI, Anthropic, Google Gemini, DeepSeek, GitHub Copilot
- Search: Brave Search, Tavily

No provider is wired into the canvas or agent loop in this phase.

---

## Phase 1 — Exploration MVP

### Task 1.1: SQLite + Drizzle schema for projects, nodes, edges

**Objective:** Persistent storage layer with one default project.

**Files:**
- Create: `db/schema.ts`, `db/index.ts`, `drizzle.config.ts`
- Modify: `package.json` (add scripts)

**Schema tables:**
- `projects` (id, name, mode, createdAt, updatedAt)
- `nodes` (id, projectId, type, x, y, width, height, props JSON, createdAt)
- `edges` (id, projectId, fromNodeId, toNodeId, label, createdAt)
- `sticky_notes` (id, projectId, x, y, text, author: 'user'|'agent', createdAt)
- `snapshots` (id, nodeId, url, finalUrl, title, summary, screenshotPath, archivePath, frameMode, fetchedAt)

**Steps:**
1. `pnpm add drizzle-orm better-sqlite3 && pnpm add -D drizzle-kit @types/better-sqlite3`
2. Write `schema.ts` with above tables, all timestamps as Unix integers.
3. `drizzle.config.ts` pointing at `data/trail.db`.
4. Add scripts: `"db:generate": "drizzle-kit generate"`, `"db:migrate": "drizzle-kit migrate"`.
5. Generate + run initial migration. Seed one default project named "Inbox".
6. Write `tests/db/schema.test.ts` — vitest opens an in-memory DB, inserts a project + node, reads back, asserts shape.
7. Run: `pnpm vitest run` — expect green.
8. Commit: `feat(db): sqlite schema for projects, nodes, edges, snapshots`

### Task 1.2: Web scraper service — Brave search + Playwright snapshot

**Objective:** A `scrapeUrl(url)` function that returns `{ title, summary, screenshotPath, archivePath, frameMode }` and stores the artifacts on disk.

**Files:**
- Create: `lib/scraper/index.ts`
- Create: `lib/scraper/playwright.ts`
- Create: `lib/scraper/frame-mode.ts`
- Create: `lib/scraper/readability.ts`
- Create: `tests/scraper/frame-mode.test.ts`

**Steps:**
1. `pnpm add playwright-core @mozilla/readability jsdom` then `pnpm exec playwright install chromium`
2. `frame-mode.ts`: send a `HEAD` request, parse `x-frame-options` and `content-security-policy: frame-ancestors`. Return `iframe` if allowed, else `screenshot`. Always also produce `archive` as a fallback.
3. `playwright.ts`: launches chromium, navigates to URL, waits for `networkidle`, captures full-page PNG to `data/snapshots/<projectId>/<nodeId>.png`, saves rendered HTML to `<nodeId>.html`. Rewrites relative URLs in the HTML to absolute so the archive renders standalone.
4. `readability.ts`: Mozilla Readability over the rendered HTML → article title + main text → return first 500 chars as `summary`.
5. `index.ts` orchestrates: `frame-mode` check → playwright snapshot → readability summary → return composite object.
6. Test `frame-mode.test.ts` with mocked fetch: `X-Frame-Options: DENY` → `screenshot`, no header → `iframe`, `CSP: frame-ancestors 'none'` → `screenshot`.
7. Run: `pnpm vitest run` — green.
8. Commit: `feat(scraper): frame-mode detection + playwright snapshots + readability summary`

### Task 1.3: Search providers — Brave (breadth) + Tavily (similar)

**Objective:** `search(query)` uses Brave for fresh keyword search; `findSimilar(url, hint?)` uses Tavily's neural search to expand from an existing node.

**Files:**
- Create: `lib/search/brave.ts`, `lib/search/tavily.ts`, `lib/search/index.ts`
- Create: `.env.local.example`
- Create: `tests/search/index.test.ts` (with nock or vi.mock for HTTP)

**Steps:**
1. `pnpm add tavily zod`
2. `brave.ts`: `searchBrave(query, count=10)` → fetch `https://api.search.brave.com/res/v1/web/search` with `X-Subscription-Token`, return `{ url, title, description }[]`.
3. `tavily.ts`: `findSimilarTavily(url, hint)` → use `tavily.search({ query: hint || url, includeDomains: [], maxResults: 5, searchDepth: 'advanced' })`.
4. `index.ts` exposes `search()` and `findSimilar()` with consistent return type.
5. `.env.local.example`: `BRAVE_API_KEY=`, `TAVILY_API_KEY=`, `ANTHROPIC_API_KEY=`.
6. Tests mock the HTTP calls and assert shape mapping.
7. Commit: `feat(search): Brave + Tavily providers behind unified interface`

### Task 1.4: Agent loop — intent classifier + tool calls

**Objective:** A streaming Server Action `runAgent(projectId, message)` that classifies intent (`explore` | `task`), calls tools, and emits canvas mutations.

**Files:**
- Create: `lib/agent/index.ts`
- Create: `lib/agent/tools.ts`
- Create: `lib/agent/prompts.ts`
- Create: `app/api/agent/route.ts` (streaming POST endpoint)
- Create: `tests/agent/classifier.test.ts`

**Tools exposed to LLM:**
- `searchWeb(query)` → Brave
- `findSimilar(nodeId, hint?)` → Tavily seeded from node URL
- `createWebpageNode(projectId, url, x, y)` → scrapes + persists + returns nodeId
- `createStickyNote(projectId, text, x, y)` → persists
- `connectNodes(fromId, toId, label?)` → edge
- `setProjectMode(projectId, 'explore'|'task')`

**Steps:**
1. `pnpm add ai @ai-sdk/anthropic`
2. `prompts.ts`: system prompt defines Trail's role, available tools, layout heuristics (place new nodes in a 320px grid, prefer right/down of seed node).
3. `tools.ts`: each tool wrapped with `tool({ description, parameters: zod, execute })`.
4. `index.ts`: `runAgent` calls `streamText({ model: anthropic('claude-opus-4-5-20250929'), tools, messages, maxSteps: 12 })`. Streams to the route.
5. Route handler returns `result.toDataStreamResponse()`.
6. Classifier test: stub LLM call, assert that "apply for US visa" routes to `task`, "research mid-century lamps" routes to `explore`.
7. Commit: `feat(agent): streaming agent loop with tool calls`

### Task 1.5: Wire the canvas to the agent — chat input + live mutations

**Objective:** A small chat input at the bottom of the canvas; submitting calls `runAgent`; new nodes appear on the tldraw canvas as they're created.

**Files:**
- Create: `components/canvas/ChatInput.tsx`
- Create: `hooks/useAgentStream.ts`
- Modify: `components/canvas/TrailCanvas.tsx`

**Steps:**
1. `ChatInput.tsx`: fixed bottom-center, autosize textarea, Cmd+Enter submits.
2. `useAgentStream.ts`: wraps `useChat` from `ai/react`, intercepts tool-call events, calls `editor.createShape()` / `editor.createBinding()` accordingly.
3. Update `TrailCanvas` to subscribe and apply mutations.
4. Manual verify: type "find me three good mid-century floor lamps," watch three WebpageNodes appear with screenshots.
5. Commit: `feat: chat input wired to agent, live canvas mutations`

### Task 1.6: Sticky notes as bidirectional comms

**Objective:** Right-click → "Add sticky note." Agent reads all sticky notes in viewport when running, can also drop its own (different color: yellow for user, blue for agent).

**Files:**
- Create: `components/canvas/shapes/StickyNoteUtil.ts`
- Modify: `lib/agent/index.ts` (read sticky notes from project before each run)

**Steps:**
1. Custom `StickyNoteShape` with `{ text, author }` props.
2. Toolbar button + keyboard shortcut `S` to drop a sticky.
3. Agent's input context now includes "Recent sticky notes:" section pulled from DB.
4. Test by adding a sticky "only show options under $300" before re-running expansion — verify agent honors it.
5. Commit: `feat: sticky notes as user→agent and agent→user channel`

### Task 1.7: "Expand similar" node action

**Objective:** Each WebpageNode has a "+ similar" button → calls `findSimilar(nodeId)` → adds 3-5 children with edges from the seed node.

**Steps:**
1. Add action button to `WebpageNode.tsx`.
2. Hook calls `/api/agent` with synthesized prompt: "expand similar to <nodeId>".
3. Agent uses Tavily, lays children to the right of seed, connects with edges labeled "similar."
4. Commit: `feat: expand-similar action on WebpageNodes`

### Task 1.8: Persistence — load canvas state on mount, autosave on change

**Steps:**
1. On mount, fetch `/api/projects/:id/state` → rebuild tldraw shapes from DB.
2. tldraw `editor.store.listen()` → debounced 1s → POST diffs to `/api/projects/:id/state`.
3. Manual verify: refresh page, canvas restored exactly.
4. Commit: `feat: persistent canvas state per project`

**Phase 1 exit criteria:** Type prompt → canvas fills with real pages, snapshots taken, sticky notes work, refresh preserves state. End-to-end demoable.

---

## Phase 2 — Projects, Overview, Archive Serving

### Task 2.1: Multi-project, project switcher

- New tables already exist. Add `app/projects/page.tsx` overview grid (project name, mode badge, node count, last-updated, thumbnail = first node's screenshot).
- "New project" button → creates row → routes to `/canvas/<id>`.
- Sidebar in canvas view with switcher.
- Commit: `feat: multi-project + overview grid`

### Task 2.2: Archive route — serve self-hosted HTML

- `app/archive/[snapshotId]/route.ts` returns the archived HTML with proper headers (own CSP, no `X-Frame-Options`).
- WebpageNode in `archive` mode points its iframe here.
- Commit: `feat: serve archived HTML from local snapshots`

### Task 2.3: Export project as JSON

- `pnpm add jszip` — bundle DB rows + screenshots + archives into a zip.
- Download button on overview.
- Commit: `feat: export project as zip`

### Task 2.4: Auto-flip mode + manual override

- Project header shows current mode with a toggle.
- Agent re-classifies if user message contradicts current mode (e.g., a task-style request inside an explore project surfaces a "switch mode?" toast).
- Commit: `feat: mode toggle + auto-flip prompts`

---

## Phase 3 — Task Flow Mode

### Task 3.1: `StepNode` custom shape

- New shape with `{ title, description, status: 'todo'|'doing'|'done'|'blocked', requiredUrls: string[] }`.
- Different visual from WebpageNode — narrower, status pill, checkbox.

### Task 3.2: Task graph generation

- New agent tool `createTaskGraph(projectId, goal)` → LLM produces ordered steps with dependencies → creates StepNodes laid out as DAG (top-to-bottom) with edges as deps.
- Each step can have attached WebpageNodes (the forms, info pages it needs) as children.

### Task 3.3: Status syncing

- Click checkbox on StepNode → updates DB → unlocks downstream nodes visually (greyed → active when all parents done).

---

## Phase 4 — Polish & Magic

- iPad-friendly touch layout pass (tldraw supports it; just need bigger hit targets and a gesture rethink for the chat input).
- Cross-project semantic search ("find that lamp page from last month") via embeddings — `pnpm add @lancedb/lancedb` or pgvector if migrating off SQLite.
- Multi-agent: split researcher / organizer / critic into separate streams that can work different canvas regions concurrently.
- Background re-snapshotting cron — re-fetch stale snapshots weekly so archives stay current.
- Shareable read-only project links (sets stage for the "if Saber uses it daily, share with team" gate).

---

## Open Questions to Resolve Before Phase 1

1. **LLM source.** Direct Anthropic key, or proxy through Saber's Hermes gateway (`http://localhost:8765`) to reuse his Copilot Opus 4.7 quota? My recommendation: direct Anthropic in v1 (simpler), swap to Hermes relay once we want to share with others without paying for their LLM use.
2. **Where does Trail live?** New repo at `~/code/trail/` (clean room) vs. inside `~/.hermes/projects/trail/` (lives with the agent family). Recommend new repo — different release cadence.
3. **Auth.** Phase 1 is localhost-only, no auth. The moment we go beyond Saber's machine (even self-hosted on a VPS), we need at least HTTP basic auth or a magic-link login. Defer to Phase 2.

---

## Execution Handoff

Plan saved at `~/.hermes/plans/2026-05-23-trail.md`. Recommended execution path: use `subagent-driven-development` to dispatch each task in sequence — fresh subagent per task, spec-compliance review then code-quality review, only advance when both pass. Phase 0 (3 tasks, ~1 evening) is the right first slice — proves rendering works before committing to the full Phase 1 lift.
