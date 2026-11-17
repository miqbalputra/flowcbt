#!/usr/bin/env bash
# C-06: restore dump ke database ephemeral untuk drill / pemulihan.
# Usage: DATABASE_URL='postgres://.../flowcbt_restore?sslmode=disable' bash scripts/restore.sh /path/to/dump
set -euo pipefail

DUMP="${1:?path dump wajib diisi}"
: "${DATABASE_URL:?DATABASE_URL target wajib di-set}"

if [[ -f "${DUMP}.sha256" ]]; then
  echo "==> verifikasi checksum"
  (cd "$(dirname "$DUMP")" && sha256sum -c "$(basename "$DUMP").sha256")
fi

echo "==> pastikan skema kosong / migrate up"
cd "$(dirname "$0")/../backend"
go run ./cmd/migrate -dir db/migrations up

echo "==> pg_restore --clean --if-exists"
pg_restore --clean --if-exists --no-owner --no-privileges -d "$DATABASE_URL" "$DUMP"

echo "==> verifikasi integritas dasar"
PGPASSWORD="${PGPASSWORD:-postgres}" psql "$DATABASE_URL" -Atc \
  "SELECT 'tenants=' || count(*) FROM tenants; SELECT 'users=' || count(*) FROM users;"

echo "SELESAI: restore terverifikasi"
