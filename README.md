# Trail

A visual agent canvas for web tasks — drop URLs onto an infinite [tldraw](https://tldraw.dev) canvas, organize them spatially, and let an agent expand, archive, and annotate them.

> Status: **Phase 1** — canvas + custom shapes, browser-only provider settings, an agent loop that turns a typed prompt into a small set of result cards backed by web search + URL fetch, and a persisted canvas graph that survives reloads.

## Install (one-liner)

```bash
curl -fsSL https://raw.githubusercontent.com/saberzou/trail/main/install.sh | bash
```

This clones to `~/.local/share/trail`, installs deps, and puts `trail` on your PATH at `~/.local/bin/trail`. macOS + Linux. Requires `git`, Node.js, and `pnpm` (installer will set up `pnpm` via corepack if missing).

## Usage

```bash
trail              # start the dev server and open /canvas in your browser
trail status       # is it running? where?
trail stop         # shut it down
trail logs         # tail server log
trail update       # git pull + reinstall
trail rebuild      # nuke node_modules + .next, fresh install
trail help
```

Override the port with `TRAIL_PORT=4000 trail`.

## Settings

Open `/settings` from the gear icon on `/canvas` to save provider credentials for future agent runs.

Supported providers:

- AI: OpenAI, Anthropic, Google Gemini, DeepSeek, GitHub Copilot
- Search: Brave Search, Tavily

Keys stay in your browser. Trail encrypts the settings blob with AES-GCM using a non-extractable Web Crypto key stored in IndexedDB, and stores only ciphertext in IndexedDB. This protects against casual browser-profile disk inspection, but not against malicious JavaScript running on the Trail origin. The settings page includes a wipe-all control that deletes the local credential database.

## Develop

```bash
git clone https://github.com/saberzou/trail.git
cd trail
pnpm install
pnpm dev
# open http://127.0.0.1:3000/canvas
```

## Phase 1: prompt → search → fetch

Drop a **PromptNode** on the canvas (the seed one appears on first load), type a question, hit **Run**. The node calls `/api/agent/run`, which streams an [AI SDK](https://sdk.vercel.ai) tool loop wired to two tools:

- `web_search` — Brave Search or Tavily, whichever is configured.
- `fetch_url` — fetches a page, runs [@mozilla/readability](https://github.com/mozilla/readability) over the DOM, returns the extracted article text.

The agent's chosen sources materialize as **ResultNode** children below the prompt. From there you can **Explore similar** to spawn a follow-up PromptNode pre-seeded with the source's context, which auto-runs.

The entire graph (prompts, results, positions, edits) is persisted to IndexedDB (`trail-canvas` DB) with a 400ms debounce. Reload the page and the canvas comes back exactly as you left it. Wipe via browser devtools → Application → IndexedDB if you want a clean slate.

### Required keys

Configure in `/settings`:

- **One LLM provider** (required): OpenAI, Anthropic, Google Gemini, DeepSeek, or GitHub Copilot.
- **One web search provider** (required for Phase 1): Brave Search or Tavily.

Keys are encrypted with AES-GCM under a non-extractable Web Crypto key and stored in IndexedDB; nothing ships to a server other than the live request the agent makes when you click Run.

## Roadmap

See [`PLAN.md`](./PLAN.md).
