#!/usr/bin/env bash
# Regenerasi ikon PNG (binary tak disimpan di git — snapshot GitHub via API
# hanya mendukung teks). Jalankan SETELAH clone:  ./scripts/make-icons.sh
set -e
cd "$(dirname "$0")/.."
cur=""
while IFS= read -r line; do
  case "$line" in
    "==FILE:"*) cur="${line#==FILE:}"; mkdir -p "$(dirname "$cur")"; printf '' > "/tmp/flowcbt-icon.b64" ;;
    "") [ -n "$cur" ] && base64 -d /tmp/flowcbt-icon.b64 > "$cur" && echo "OK $cur" && cur="" ;;
    *) [ -n "$cur" ] && printf '%s' "$line" >> /tmp/flowcbt-icon.b64 ;;
  esac
done < scripts/icons.b64.txt
if command -v git >/dev/null 2>&1; then git add frontend/public/*.png backend/public/*.png 2>/dev/null; fi
