#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_PORT="${NBLD_WEB_PORT:-27777}"
LOG_FILE="${ROOT_DIR}/.nbld-web.log"
PID_FILE="${ROOT_DIR}/.nbld-web.pid"

mapfile -t PIDS < <(lsof -t -iTCP:"$WEB_PORT" -sTCP:LISTEN -n -P 2>/dev/null || true)
if [[ "${#PIDS[@]}" -gt 0 ]]; then
  kill "${PIDS[@]}" 2>/dev/null || true
  sleep 1
fi

cd "$ROOT_DIR/client/web"
npm run build

cd "$ROOT_DIR/client/web/dist"
setsid python3 -m http.server "$WEB_PORT" --bind 0.0.0.0 >"$LOG_FILE" 2>&1 < /dev/null &
WEB_PID=$!
printf '%s\n' "$WEB_PID" >"$PID_FILE"

for _ in $(seq 1 20); do
  if curl --silent --fail "http://127.0.0.1:${WEB_PORT}/" >/dev/null 2>&1; then
    disown "$WEB_PID" 2>/dev/null || true
    echo "web restarted on :$WEB_PORT"
    echo "log file: $LOG_FILE"
    echo "pid file: $PID_FILE"
    exit 0
  fi
  sleep 0.5
done

echo "web failed to start on :$WEB_PORT" >&2
exit 1
