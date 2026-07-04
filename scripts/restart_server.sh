#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LISTEN_PORT="${NBLD_GATEWAY_PORT:-6363}"
LISTEN_ADDR="${NBLD_GATEWAY_ADDR:-:6363}"
CHECK_BASE_URL="${NBLD_CHECK_BASE_URL:-http://127.0.0.1:6363}"
RUST_CHUNKGEN_BIN="${NBLD_RUST_CHUNKGEN_BIN:-/nbld/rust/chunkgen/target/release/chunkgen}"
INSTANCE_ID="restart-$(date -u +%Y%m%d%H%M%S)-$$"

mapfile -t PIDS < <(lsof -t -iTCP:"$LISTEN_PORT" -sTCP:LISTEN -n -P 2>/dev/null || true)
if [[ "${#PIDS[@]}" -gt 0 ]]; then
  kill "${PIDS[@]}" 2>/dev/null || true
  sleep 1
fi

cd "$ROOT_DIR/server"
LOG_FILE="${ROOT_DIR}/.nbld-server.log"
go build -o "$ROOT_DIR/.nbld-gateway" ./cmd/gateway
nohup env \
  NBLD_INSTANCE_ID="$INSTANCE_ID" \
  NBLD_GATEWAY_ADDR="$LISTEN_ADDR" \
  NBLD_RUST_CHUNKGEN_BIN="$RUST_CHUNKGEN_BIN" \
  "$ROOT_DIR/.nbld-gateway" >"$LOG_FILE" 2>&1 &
SERVER_PID=$!

cleanup() {
  if [[ "${1:-}" != "keep" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}

trap 'cleanup' EXIT

READY=0
for _ in $(seq 1 30); do
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
  echo "server failed to restart for instance $INSTANCE_ID" >&2
  exit 1
fi

echo "restarted instance $INSTANCE_ID"
echo "listen addr: $LISTEN_ADDR"
echo "check base url: $CHECK_BASE_URL"

if [[ "${1:-}" == "--hold" ]]; then
  trap - EXIT
  wait "$SERVER_PID"
  exit 0
fi

trap - EXIT
echo "log file: $LOG_FILE"
