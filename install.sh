#!/usr/bin/env bash
# Trail installer — clones the repo, installs deps, and puts `trail` on PATH.
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/saberzou/trail/main/install.sh | bash
#
# What it does:
#   - clones (or updates) saberzou/trail into ~/.local/share/trail
#   - installs pnpm deps
#   - symlinks ~/.local/bin/trail -> repo's scripts/trail
#   - adds ~/.local/bin to PATH in your shell rc if missing
#
# Override with env vars:
#   TRAIL_HOME=/custom/path       (default: ~/.local/share/trail)
#   TRAIL_BIN=/custom/bin         (default: ~/.local/bin)
#   TRAIL_REPO_URL=git@...        (default: https://github.com/saberzou/trail.git)

set -euo pipefail

TRAIL_HOME="${TRAIL_HOME:-$HOME/.local/share/trail}"
TRAIL_BIN="${TRAIL_BIN:-$HOME/.local/bin}"
TRAIL_REPO_URL="${TRAIL_REPO_URL:-https://github.com/saberzou/trail.git}"

bold() { printf "\033[1m%s\033[0m\n" "$*"; }
info() { printf "  %s\n" "$*"; }
die()  { printf "\033[31merror:\033[0m %s\n" "$*" >&2; exit 1; }

bold "Trail installer"
info "repo:    $TRAIL_REPO_URL"
info "install: $TRAIL_HOME"
info "bin:     $TRAIL_BIN/trail"
echo

# ---- prerequisites ---------------------------------------------------------
command -v git >/dev/null  || die "git is required"
command -v node >/dev/null || die "Node.js is required (https://nodejs.org)"

if ! command -v pnpm >/dev/null; then
  info "pnpm not found — installing via corepack..."
  if command -v corepack >/dev/null; then
    corepack enable >/dev/null 2>&1 || true
    corepack prepare pnpm@latest --activate >/dev/null
  else
    die "pnpm not found and corepack unavailable. Install pnpm: https://pnpm.io/installation"
  fi
fi

# ---- clone or update -------------------------------------------------------
mkdir -p "$(dirname "$TRAIL_HOME")"
if [[ -d "$TRAIL_HOME/.git" ]]; then
  bold "Updating existing checkout"
  (cd "$TRAIL_HOME" && git pull --ff-only)
else
  bold "Cloning repo"
  git clone --depth 1 "$TRAIL_REPO_URL" "$TRAIL_HOME"
fi

# ---- install deps ----------------------------------------------------------
bold "Installing dependencies"
(cd "$TRAIL_HOME" && pnpm install --prefer-offline)

# ---- symlink CLI -----------------------------------------------------------
mkdir -p "$TRAIL_BIN"
ln -sf "$TRAIL_HOME/scripts/trail" "$TRAIL_BIN/trail"
chmod +x "$TRAIL_HOME/scripts/trail"
bold "Installed: $TRAIL_BIN/trail"

# ---- PATH check ------------------------------------------------------------
if ! echo ":$PATH:" | grep -q ":$TRAIL_BIN:"; then
  shell_rc=""
  case "${SHELL:-}" in
    */zsh)  shell_rc="$HOME/.zshrc" ;;
    */bash) shell_rc="$HOME/.bashrc" ;;
    */fish) shell_rc="$HOME/.config/fish/config.fish" ;;
  esac
  if [[ -n "$shell_rc" ]]; then
    {
      echo ""
      echo "# Added by Trail installer"
      echo "export PATH=\"$TRAIL_BIN:\$PATH\""
    } >> "$shell_rc"
    info "Added $TRAIL_BIN to PATH in $shell_rc"
    info "Run:  source $shell_rc   (or open a new terminal)"
  else
    info "Add this to your shell rc:  export PATH=\"$TRAIL_BIN:\$PATH\""
  fi
fi

echo
bold "Done. Try it:"
echo "  trail              # start dev server + open /canvas"
echo "  trail status"
echo "  trail help"
