#!/usr/bin/env bash
set -euo pipefail

# Wrapper to always run npm using the repo-local Node.js toolchain.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCAL_NPM="$REPO_ROOT/.node/bin/npm"

bash "$SCRIPT_DIR/ensure-local-node.sh"
export PATH="$REPO_ROOT/.node/bin:$PATH"

if [[ $# -eq 0 ]]; then
  exec "$LOCAL_NPM"
else
  exec "$LOCAL_NPM" "$@"
fi
