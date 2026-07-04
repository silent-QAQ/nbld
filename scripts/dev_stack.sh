#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/nbld_env.sh"
SERVER_PID=""
INSTANCE_ID="dev-$(date -u +%Y%m%d%H%M%S)-$$"
READY=0
LISTEN_ADDR="${NBLD_GATEWAY_ADDR:-:6363}"
CHECK_BASE_URL="${NBLD_CHECK_BASE_URL:-http://127.0.0.1:6363}"

cleanup() {
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}

trap cleanup EXIT

cd "$ROOT_DIR/server"
NBLD_INSTANCE_ID="$INSTANCE_ID" \
  NBLD_GATEWAY_ADDR="$LISTEN_ADDR" \
  NBLD_DATABASE_URL="$NBLD_DATABASE_URL" \
  NBLD_REDIS_URL="$NBLD_REDIS_URL" \
  go run ./cmd/gateway &
SERVER_PID="$!"

for _ in $(seq 1 20); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    wait "$SERVER_PID"
  fi

  HEALTHZ_RESPONSE="$(curl --silent --fail "$CHECK_BASE_URL/healthz" 2>/dev/null || true)"
  if [[ -n "$HEALTHZ_RESPONSE" ]]; then
    RESPONSE_INSTANCE_ID="$(printf '%s' "$HEALTHZ_RESPONSE" | sed -n 's/.*"instanceId":"\([^"]*\)".*/\1/p')"
    if [[ "$RESPONSE_INSTANCE_ID" == "$INSTANCE_ID" ]]; then
      READY=1
      break
    fi
  fi

  sleep 0.5
done

if [[ "$READY" -ne 1 ]]; then
  echo "server failed to become ready for instance $INSTANCE_ID" >&2
  exit 1
fi

if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  wait "$SERVER_PID"
fi

echo "using instance $INSTANCE_ID"
echo "listen addr: $LISTEN_ADDR"
echo "check base url: $CHECK_BASE_URL"

if [[ "${1:-}" == "--hold" ]]; then
  wait "$SERVER_PID"
  exit 0
fi

if [[ "${1:-}" == "--health-only" ]]; then
  exit 0
fi

NBLD_CHECK_BASE_URL="$CHECK_BASE_URL" bash "$ROOT_DIR/scripts/check_server.sh"
