#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${1:-./backups}"
TS="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "Backing up PostgreSQL database..."
docker compose exec -T db pg_dump -U "${POSTGRES_USER:-frame}" "${POSTGRES_DB:-frame_db}" | gzip > "$BACKUP_DIR/frame-db-$TS.sql.gz"

echo "Backing up uploaded evidence files..."
docker compose exec -T api tar -czf - -C /app uploads > "$BACKUP_DIR/frame-uploads-$TS.tar.gz"

echo "Backup complete:"
ls -lh "$BACKUP_DIR/frame-db-$TS.sql.gz" "$BACKUP_DIR/frame-uploads-$TS.tar.gz"
