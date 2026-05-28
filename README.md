# Trail

A visual agent canvas for web tasks — drop URLs onto an infinite [tldraw](https://tldraw.dev) canvas, organize them spatially, and let an agent expand, archive, and annotate them.

> Status: **Phase 0.5** — canvas + custom `WebpageNode` with three render modes, plus browser-only provider settings. Agent loop, projects, and persistence land in Phase 1+.

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

## Roadmap

See [`PLAN.md`](./PLAN.md).
