#!/usr/bin/env bash
# Smoke test E2E FlowCBT: butuh API aktif di $BASE (default http://127.0.0.1:8080).
# Jalankan dulu: make dev-pg && make migrate && make api
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/e2e-smoke.mjs
