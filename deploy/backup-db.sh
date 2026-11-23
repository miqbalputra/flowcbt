#!/bin/bash
# Backup FlowCBT: pg_dump (container flowcbt-pg) -> gzip /opt/flowcbt/backups.
# Retensi: 14 dump terbaru disimpan, sisanya dihapus. Kembalikan dengan:
#   gunzip -c <file>.sql.gz | docker exec -i flowcbt-pg psql -U flowcbt -d flowcbt
set -euo pipefail
DIR=/opt/flowcbt/backups
CONTAINER=flowcbt-pg
mkdir -p "$DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$DIR/flowcbt-$STAMP.sql.gz"
docker exec "$CONTAINER" pg_dump -U flowcbt -d flowcbt | gzip -9 > "$OUT"
chmod 600 "$OUT"
# simpan maksimal 14 (7 hari x 2)
ls -1t "$DIR"/flowcbt-*.sql.gz 2>/dev/null | tail -n +15 | xargs -r rm -f
echo "backup ok: $OUT ($(du -h "$OUT" | cut -f1))"
