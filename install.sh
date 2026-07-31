#!/bin/sh
# sirkimi installer — downloads the latest skimi binary from GitHub Releases.
#
#   curl -fsSL https://raw.githubusercontent.com/sirrayi/sirkimi/main/install.sh | sh
#
# Env overrides:
#   SIRKIMI_VERSION   install a specific tag (default: latest release)
#   SIRKIMI_BIN_DIR   install location (default: ~/.local/bin)

set -eu

REPO="sirrayi/sirkimi"
BIN_NAME="skimi"
BIN_DIR="${SIRKIMI_BIN_DIR:-$HOME/.local/bin}"

say() { printf '%s\n' "$*"; }
fail() { say "error: $*" >&2; exit 1; }

need() { command -v "$1" >/dev/null 2>&1 || fail "missing required tool: $1"; }
need curl
need unzip

# ── Platform detection ────────────────────────────────────────────────
os=$(uname -s)
arch=$(uname -m)
case "$os" in
  Darwin) target_os="darwin" ;;
  Linux)  target_os="linux" ;;
  *)      fail "unsupported OS: $os (Windows users: download skimi.exe from https://github.com/$REPO/releases)" ;;
esac
case "$arch" in
  x86_64|amd64)  target_arch="x64" ;;
  arm64|aarch64) target_arch="arm64" ;;
  *)             fail "unsupported architecture: $arch" ;;
esac
target="${target_os}-${target_arch}"

# ── Resolve version ───────────────────────────────────────────────────
if [ "${SIRKIMI_VERSION:-}" != "" ]; then
  tag="$SIRKIMI_VERSION"
else
  tag=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | cut -d '"' -f 4) \
    || fail "could not resolve latest release"
fi
[ "$tag" != "" ] || fail "no release found for $REPO"

asset="kimi-code-${target}.zip"
base="https://github.com/$REPO/releases/download/$tag"
tmpdir=$(mktemp -d)
trap 'rm -rf "$tmpdir"' EXIT

say "Installing sirkimi $tag ($target)..."
curl -fsSL "$base/$asset" -o "$tmpdir/$asset" || fail "download failed: $base/$asset"

# ── Verify checksum when available ────────────────────────────────────
if curl -fsSL "$base/$asset.sha256" -o "$tmpdir/$asset.sha256" 2>/dev/null; then
  expected=$(cut -d ' ' -f 1 < "$tmpdir/$asset.sha256")
  if command -v shasum >/dev/null 2>&1; then
    actual=$(shasum -a 256 "$tmpdir/$asset" | cut -d ' ' -f 1)
  else
    actual=$(sha256sum "$tmpdir/$asset" | cut -d ' ' -f 1)
  fi
  [ "$expected" = "$actual" ] || fail "checksum mismatch (expected $expected, got $actual)"
fi

# ── Install ───────────────────────────────────────────────────────────
unzip -o -q "$tmpdir/$asset" -d "$tmpdir"
[ -f "$tmpdir/$BIN_NAME" ] || fail "archive did not contain $BIN_NAME"

mkdir -p "$BIN_DIR"
mv "$tmpdir/$BIN_NAME" "$BIN_DIR/$BIN_NAME"
chmod +x "$BIN_DIR/$BIN_NAME"

# Unsigned binaries trip macOS Gatekeeper on first run; strip quarantine
# here so users never see the prompt.
if [ "$target_os" = "darwin" ]; then
  xattr -d com.apple.quarantine "$BIN_DIR/$BIN_NAME" 2>/dev/null || true
fi

say "Installed $BIN_NAME to $BIN_DIR/$BIN_NAME"
case ":$PATH:" in
  *":$BIN_DIR:"*) ;;
  *) say "note: $BIN_DIR is not on your PATH — add it, e.g.:  export PATH=\"$BIN_DIR:\$PATH\"" ;;
esac
say "Run: $BIN_NAME"
