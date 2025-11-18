# Task Checklist

- Bootstrap Node.js locally (Node v22) even if system Node is missing: `bash scripts/ensure-local-node.sh`
- Use the repo-local npm wrapper so the bundled Node is picked up: `bash scripts/npm-local.sh <npm args>` (e.g., `bash scripts/npm-local.sh run build`)  Do not use buildDev.
