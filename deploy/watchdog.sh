#!/bin/bash
# Watchdog FlowCBT — dipanggil systemd tiap 5 menit (flowcbt-watchdog.timer).
# Cek: API /readyz (kedua pool DB), frontend, container DB, unit layanan.
# Gagal → WARNING di journald + status file; kirim webhook bila
# WATCH_WEBHOOK_URL di-set (opsional; Slack/Telegram/Discord masuk).
set -u
FAILS=0
LOGS=()

check() { # nama, perintah
  if ! eval "$2" >/dev/null 2>&1; then
    FAILS=$((FAILS+1)); LOGS+=("$1")
  fi
}

check "api /readyz" "curl -fsS --max-time 5 http://127.0.0.1:8080/readyz"
check "frontend :5173" "curl -fsS --max-time 5 -o /dev/null http://127.0.0.1:5173/login"
check "container flowcbt-pg" "docker inspect -f '{{.State.Running}}' flowcbt-pg | grep -q true"
for u in flowcbt-api flowcbt-webserve flowcbt-worker; do
  check "unit $u" "systemctl is-active --quiet $u"
done

STATUS="ok"
if [ "$FAILS" -gt 0 ]; then
  STATUS="down:$(IFS=,; echo "${LOGS[*]}")"
  echo "WATCHDOG WARNING — $FAILS layanan bermasalah: $STATUS" >&2
  HOOK=$(grep -E '^WATCH_WEBHOOK_URL=' /opt/flowcbt/flowcbt.env 2>/dev/null | cut -d= -f2-)
  if [ -n "${HOOK:-}" ]; then
    curl -fsS --max-time 5 -X POST -H 'Content-Type: application/json' \
      -d "{\"text\":\"FlowCBT WATCHDOG: $STATUS\"}" "$HOOK" >/dev/null 2>&1 || true
  fi
fi
echo "watchdog status=$STATUS" > /opt/flowcbt/status.txt
[ "$FAILS" -eq 0 ]
