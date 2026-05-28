# Trail

A visual agent canvas for web tasks — drop URLs onto an infinite [tldraw](https://tldraw.dev) canvas, organize them spatially, and let an agent expand, archive, and annotate them.

> Status: **Phase 0** — canvas + custom `WebpageNode` with three render modes (live iframe, screenshot, archived HTML). Agent loop, projects, and persistence land in Phase 1+.

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
