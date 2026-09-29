#!/usr/bin/env bash
# ZOLA STYLISH MANAGEMENT SYSTEM — database backup plus a copy of uploaded files.
# Suitable for cron, e.g. nightly at 23:30:
#   30 23 * * * /opt/zola-stylish/scripts/linux/backup.sh >> /var/log/zola-backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/../.."
npm --prefix backend run backup --silent
stamp=$(date +%Y%m%d-%H%M)
if [ -d backend/storage/uploads ]; then
  tar -czf "backend/storage/backups/uploads-$stamp.tar.gz" -C backend/storage uploads
  echo "Uploaded files archived to backend/storage/backups/uploads-$stamp.tar.gz"
fi
