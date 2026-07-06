#!/usr/bin/env bash

# Shared runtime defaults. Override any value in the shell before calling scripts.
export NBLD_GATEWAY_ADDR="${NBLD_GATEWAY_ADDR:-:6363}"
export NBLD_CHECK_BASE_URL="${NBLD_CHECK_BASE_URL:-http://127.0.0.1:6363}"
export NBLD_DATABASE_URL="${NBLD_DATABASE_URL:-postgres://nbld:hyx115566@127.0.0.1:5432/nbld?sslmode=disable}"
export NBLD_REDIS_URL="${NBLD_REDIS_URL:-redis://127.0.0.1:6379/0}"
export NBLD_RUST_CHUNKGEN_BIN="${NBLD_RUST_CHUNKGEN_BIN:-/nbld/rust/chunkgen/target/release/chunkgen}"
