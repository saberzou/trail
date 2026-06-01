# Trail

A spatial canvas for the web, driven by an AI agent. Organize your work
into **Trails** — self-contained projects, each with its own canvas and
agent session. Inside a trail, talk to the master agent in a left chat
dock; the canvas fills with webpage tiles — live iframes, Playwright
screenshots, or rich link cards — laid out as task flows or exploration
clusters.

> Status: **v2** — Trails (per-project canvas + chat), a home page to
> manage them, and a shadcn/ui component layer. Playwright sidecar,
> three-mode `WebpageNode`, agent chat with URL-paste → tile. See
> [`PLAN.md`](./PLAN.md) for the roadmap.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/saberzou/trail/main/install.sh | bash
```

This clones to `~/.local/share/trail`, installs deps, and puts `trail`
on your PATH at `~/.local/bin/trail`. Requires `git`, Node ≥ 22.19,
and `pnpm` (installer can set up pnpm via corepack if missing). macOS
and Linux.

After the first install, download Chromium for the screenshot sidecar:

```bash
trail install-renderer
```

Then start everything:

```bash
trail              # starts Next.js + renderer, opens the home page in your browser
trail status       # show both PIDs and URLs
trail logs         # tail next.js + renderer logs (interleaved)
trail stop         # shut both down
trail restart      # stop + start
trail update       # git pull + reinstall deps
trail rebuild      # nuke node_modules + .next, reinstall, restart
trail help
```

Override the ports with `TRAIL_PORT=4000 trail` and
`TRAIL_RENDERER_PORT=4001 trail`.

## Usage today

- The home page (`/`) lists your **Trails**. Create one to start a new
  project — it opens a fresh canvas and agent session at `/trail/<id>`.
  Edit (rename / recolor / describe) or delete a trail from the `⋯`
  menu on its card. Each trail's canvas and chat are isolated from the
  others.
- Inside a trail, **paste a URL** (just the URL, by itself) and hit
  Send → it appears as a tile on the canvas. The renderer probes
  whether the page allows iframes; if yes it embeds live, if no it
  shows a Playwright screenshot, and if both fail it falls back to a
  link card.
- Drag, resize, zoom the canvas with tldraw's usual controls. The
  graph persists to IndexedDB (keyed per trail) and survives reload.
- Free-form chat with the master agent produces search-grounded
  summaries, task flows, and "find similar" expansions when an LLM
  provider is configured in Settings.

> Migrating from v1? Your previous single global canvas and chat are
> folded into a "My first trail" project automatically the first time
> the home page loads. `/canvas` now redirects to the trail list.

## Settings

Open `/settings` from the link in the home header or a trail's chat
dock to save provider credentials.

- AI: OpenAI, Anthropic, Google Gemini, DeepSeek, GitHub Copilot
- Search: Brave Search, Tavily

Keys stay in your browser. Trail encrypts the settings blob with
AES-GCM under a non-extractable Web Crypto key stored in IndexedDB
and stores only the ciphertext. **This protects against casual
disk-level inspection, not against malicious JavaScript running on the
Trail origin** — anything that can run in your browser tab can ask
the Crypto API to decrypt. `/settings` has a "wipe everything" button
that deletes the local credential database.

The Playwright sidecar at `127.0.0.1:3001` is loopback-only with CORS
restricted to the Trail app's origin. There's no auth header beyond
that — any process on the same machine can reach it, same as your
`$HOME` directory.

## Develop

```bash
git clone https://github.com/saberzou/trail.git
cd trail
pnpm install
pnpm exec playwright install chromium
pnpm renderer &      # start the sidecar on :3001
pnpm dev             # start Next.js on :3000
# open http://127.0.0.1:3000
```

Run tests with `pnpm test`, lint with `pnpm lint`, build with
`pnpm build`.

## Roadmap

See [`PLAN.md`](./PLAN.md) for the master plan: PR2b adds the
agent session and `build_flow` tool, PR2c adds the task / explore
layouts and step state.
