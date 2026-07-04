#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_FILE="$ROOT_DIR/.nbld-dev.log"

while true; do
  if bash "$ROOT_DIR/scripts/dev_stack.sh" >>"$LOG_FILE" 2>&1; then
    exit 0
  fi

  printf '%s dev_stack failed, retrying in 2s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" >>"$LOG_FILE"
  sleep 2
done
