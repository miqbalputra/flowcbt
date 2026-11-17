#!/usr/bin/env bash
# C-06: backup harian PostgreSQL FlowCBT ke direktori lokal, lalu (opsional) ke object storage.
# Usage: BACKUP_DIR=/var/backups/flowcbt DATABASE_URL='postgres://...' bash scripts/backup.sh
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/flowcbt}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="flowcbt-${STAMP}.dump"

: "${DATABASE_URL:?DATABASE_URL wajib di-set}"
mkdir -p "$BACKUP_DIR"

echo "==> pg_dump (custom format, compressed)"
pg_dump -Fc -Z6 "$DATABASE_URL" -o "${BACKUP_DIR}/${FILE}"

echo "==> checksum"
sha256sum "${BACKUP_DIR}/${FILE}" > "${BACKUP_DIR}/${FILE}.sha256"

echo "==> retensi ${RETENTION_DAYS} hari"
find "$BACKUP_DIR" -name 'flowcbt-*.dump' -mtime "+${RETENTION_DAYS}" -delete
find "$BACKUP_DIR" -name 'flowcbt-*.dump.sha256' -mtime "+${RETENTION_DAYS}" -delete

# Opsional: unggah ke object storage di LUAR VPS (RPO ≤ 5 menit butuh WAL archiving / managed backup).
if [[ -n "${BACKUP_S3_URI:-}" ]]; then
  echo "==> unggah ke ${BACKUP_S3_URI}"
  aws s3 cp "${BACKUP_DIR}/${FILE}" "${BACKUP_S3_URI}/${FILE}"
  aws s3 cp "${BACKUP_DIR}/${FILE}.sha256" "${BACKUP_S3_URI}/${FILE}.sha256"
fi

echo "SELESAI: ${BACKUP_DIR}/${FILE}"
