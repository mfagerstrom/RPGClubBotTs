#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

bash "$SCRIPT_DIR/ensure-local-node.sh"
export PATH="$REPO_ROOT/.node/bin:$PATH"

if [[ $# -eq 0 ]]; then
  exec npm
else
  exec npm "$@"
fi
