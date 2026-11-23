#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "Usage: $0 <db-backup.sql.gz> <uploads-backup.tar.gz>"
  exit 1
fi

DB_BACKUP="$1"
UPLOADS_BACKUP="$2"

echo "Restoring PostgreSQL database from $DB_BACKUP..."
gunzip -c "$DB_BACKUP" | docker compose exec -T db psql -U "${POSTGRES_USER:-frame}" -d "${POSTGRES_DB:-frame_db}"

echo "Restoring uploaded evidence files from $UPLOADS_BACKUP..."
docker compose exec -T api tar -xzf - -C /app < "$UPLOADS_BACKUP"

echo "Restore complete."
