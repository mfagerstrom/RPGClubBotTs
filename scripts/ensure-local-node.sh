#!/usr/bin/env bash
set -euo pipefail

# Ensures a local Node.js binary exists at .node for environments without system Node.
NODE_VERSION="v18.20.5"
NODE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/.node"
NODE_BIN="$NODE_DIR/bin/node"

# Short-circuit if the right version is already present.
if [[ -x "$NODE_BIN" ]]; then
  current="$("$NODE_BIN" -v 2>/dev/null || true)"
  if [[ "$current" == "$NODE_VERSION" ]]; then
    exit 0
  fi
fi

echo "Downloading Node.js $NODE_VERSION to $NODE_DIR" >&2
TMP_ROOT="$(mktemp -d)"
TAR_PATH="$TMP_ROOT/node.tar.xz"
URL="https://nodejs.org/dist/$NODE_VERSION/node-$NODE_VERSION-linux-x64.tar.xz"

curl -fsSL "$URL" -o "$TAR_PATH"
rm -rf "$NODE_DIR"
mkdir -p "$NODE_DIR"
tar -xJf "$TAR_PATH" -C "$NODE_DIR" --strip-components=1

rm -rf "$TMP_ROOT"
echo "Node.js $NODE_VERSION installed to $NODE_DIR" >&2
