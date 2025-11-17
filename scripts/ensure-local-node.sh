#!/usr/bin/env bash
set -euo pipefail

# Ensures a local Node.js binary exists at .node for environments without system Node.
NODE_VERSION="v22.11.0"
NODE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.node"
NODE_BIN="$NODE_DIR/bin/node"
NPM_CLI="$NODE_DIR/lib/node_modules/npm/bin/npm-cli.js"
NPX_CLI="$NODE_DIR/lib/node_modules/npm/bin/npx-cli.js"

verify_install() {
  [[ -x "$NODE_BIN" ]] || return 1
  [[ -f "$NPM_CLI" && -f "$NPX_CLI" ]] || return 1
  [[ "$("$NODE_BIN" -v 2>/dev/null || true)" == "$NODE_VERSION" ]] || return 1
  "$NODE_BIN" "$NPM_CLI" --version >/dev/null 2>&1 || return 1
  "$NODE_BIN" "$NPX_CLI" --version >/dev/null 2>&1 || return 1
}

# Short-circuit if the right version is already present and usable.
if verify_install; then
  exit 0
fi

echo "Downloading Node.js $NODE_VERSION to $NODE_DIR" >&2
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

TAR_PATH="$TMP_ROOT/node.tar.xz"
EXTRACT_DIR="$TMP_ROOT/node-extracted"
URL="https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.xz"

curl -fsSL "$URL" -o "$TAR_PATH"
mkdir -p "$EXTRACT_DIR"
tar -xJf "$TAR_PATH" -C "$EXTRACT_DIR" --strip-components=1

# Replace existing install atomically to avoid half-written toolchains after interruptions.
rm -rf "$NODE_DIR"
mv "$EXTRACT_DIR" "$NODE_DIR"

echo "Node.js $NODE_VERSION installed to $NODE_DIR" >&2
