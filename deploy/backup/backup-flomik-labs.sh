#!/usr/bin/env bash
set -euo pipefail

DB_PATH="${LL_DB_PATH:-/var/lib/flomik-labs/flomik-labs.sqlite}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/flomik-labs}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required for backups" >&2
  exit 1
fi

if [ ! -f "${DB_PATH}" ]; then
  echo "Database file not found: ${DB_PATH}" >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET_SQLITE="${BACKUP_DIR}/flomik-labs-${STAMP}.sqlite"

sqlite3 "${DB_PATH}" ".backup ${TARGET_SQLITE}"
gzip -f "${TARGET_SQLITE}"

find "${BACKUP_DIR}" -type f -name "flomik-labs-*.sqlite.gz" -mtime "+${RETENTION_DAYS}" -delete
