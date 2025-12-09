#!/bin/bash
# Wrapper to run npm/npx using the local Node if available

SCRIPT_DIR=$(dirname "$(readlink -f "$0")")
LOCAL_NODE_DIR="$SCRIPT_DIR/../.node"
LOCAL_NODE_BIN="$LOCAL_NODE_DIR/bin"

if [ -d "$LOCAL_NODE_BIN" ]; then
  export PATH="$LOCAL_NODE_BIN:$PATH"
fi

# Check if 'npm' is available
if ! command -v npm &> /dev/null; then
    echo "Error: npm not found. Ensure Node.js is installed or bootstrap the local environment."
    exit 1
fi

# Execute the passed command
exec npm "$@"
