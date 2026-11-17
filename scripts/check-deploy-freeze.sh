#!/usr/bin/env bash
# C-08: gate deploy freeze. Exit 0 = aman deploy, exit 1 = ada ujian aktif.
# Usage: API_ORIGIN=https://api.domain.com INTERNAL_TOKEN='...' bash scripts/check-deploy-freeze.sh
set -euo pipefail

: "${API_ORIGIN:?API_ORIGIN wajib di-set}"
: "${INTERNAL_TOKEN:?INTERNAL_TOKEN wajib di-set}"

RESP="$(curl -fsS -m 10 -H "Authorization: Bearer ${INTERNAL_TOKEN}" \
  "${API_ORIGIN}/internal/active-exams")"
N="$(printf '%s' "$RESP" | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["active_exams"])')"

echo "active_exams=${N}"
if [[ "$N" -gt 0 ]]; then
  echo "DEPLOY FREEZE: ${N} ujian sedang berlangsung. Tunda deploy."
  exit 1
fi
echo "AMAN: tidak ada ujian aktif."
