#!/usr/bin/env bash
# ZOLA STYLISH MANAGEMENT SYSTEM — start the server in the foreground.
# For an always-on server use PM2 instead: pm2 start ecosystem.config.js
set -euo pipefail
cd "$(dirname "$0")/../../backend"
[ -f ../.env ] || { echo "Run scripts/linux/setup.sh first."; exit 1; }
NODE_ENV=production exec node src/server.js
