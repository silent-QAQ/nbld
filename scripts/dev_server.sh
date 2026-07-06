#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$ROOT_DIR/scripts/nbld_env.sh"

cd "$ROOT_DIR/server"
exec go run ./cmd/gateway
