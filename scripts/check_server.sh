#!/usr/bin/env bash

set -euo pipefail

CHECK_BASE_URL="${NBLD_CHECK_BASE_URL:-http://127.0.0.1:6363}"

curl --fail --silent "$CHECK_BASE_URL/healthz"
echo

LOGIN_RESPONSE="$(curl --fail --silent \
  -X POST "$CHECK_BASE_URL/api/v1/session/guest" \
  -H 'Content-Type: application/json' \
  -d '{"deviceId":"local-dev"}')"

echo "$LOGIN_RESPONSE"
echo

TOKEN="$(printf '%s' "$LOGIN_RESPONSE" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')"

curl --fail --silent \
  -X POST "$CHECK_BASE_URL/api/v1/world/enter" \
  -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\"}"
echo

EVENT_LOG="$(mktemp)"
EVENT_PID=""

cleanup() {
  if [[ -n "$EVENT_PID" ]]; then
    kill "$EVENT_PID" 2>/dev/null || true
    wait "$EVENT_PID" 2>/dev/null || true
  fi
  rm -f "$EVENT_LOG"
}

trap cleanup EXIT

curl --fail --silent --no-buffer "$CHECK_BASE_URL/api/v1/world/events?token=$TOKEN" >"$EVENT_LOG" &
EVENT_PID="$!"
sleep 1

curl --fail --silent \
  -X POST "$CHECK_BASE_URL/api/v1/world/move" \
  -H 'Content-Type: application/json' \
  -d "{\"token\":\"$TOKEN\",\"position\":{\"x\":12.5,\"y\":-3.25}}"
echo

curl --fail --silent "$CHECK_BASE_URL/api/v1/world/state?token=$TOKEN"
echo

for _ in $(seq 1 20); do
  if grep -q 'player_moved' "$EVENT_LOG"; then
    break
  fi
  sleep 0.2
done

grep 'data:' "$EVENT_LOG" | head -n 2

cd /nbld/server
NBLD_WS_CHECK_HTTP_BASE_URL="$CHECK_BASE_URL" go run ./cmd/wscheck
