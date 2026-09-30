#!/usr/bin/env bash
# ZOLA STYLISH MANAGEMENT SYSTEM — first-time setup on Linux/macOS.
# Usage: bash scripts/linux/setup.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

command -v node >/dev/null || { echo "Node.js 20+ is required (https://nodejs.org)."; exit 1; }
major=$(node -p 'process.versions.node.split(".")[0]')
[ "$major" -ge 20 ] || { echo "Node.js 20+ is required (found $(node -v))."; exit 1; }

set +e
node scripts/configure-env.js
status=$?
set -e
if [ "$status" -eq 2 ]; then
  echo "Edit .env (DATABASE_PASSWORD, ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD), then run this script again."
  exit 1
fi

# Folders the server writes to (created up front for the systemd sandbox).
mkdir -p backend/storage/uploads backend/storage/backups backend/logs

npm --prefix backend ci --omit=dev --no-audit --no-fund
npm --prefix frontend ci --no-audit --no-fund
npm --prefix frontend run build
npm --prefix backend run setup:db

echo "Setup complete. Start with: bash scripts/linux/start.sh   (or: pm2 start ecosystem.config.js)"
