#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="/nbld"
REMOTE_NAME="${NBLD_GIT_REMOTE_NAME:-origin}"
REMOTE_URL="${NBLD_GIT_REMOTE_URL:-https://github.com/silent-QAQ/nbld.git}"
BRANCH_NAME="${NBLD_GIT_BRANCH:-main}"
COMMIT_PREFIX="${NBLD_GIT_COMMIT_PREFIX:-chore: auto sync}"
PROXY_URL="${NBLD_GIT_HTTPS_PROXY:-http://127.0.0.1:7890}"

cd "${ROOT_DIR}"

if ! command -v git >/dev/null 2>&1; then
  echo "git is required" >&2
  exit 1
fi

if [ ! -d .git ]; then
  git init
  git branch -M "${BRANCH_NAME}"
fi

if ! git remote get-url "${REMOTE_NAME}" >/dev/null 2>&1; then
  git remote add "${REMOTE_NAME}" "${REMOTE_URL}"
else
  git remote set-url "${REMOTE_NAME}" "${REMOTE_URL}"
fi

if [ -n "${PROXY_URL}" ]; then
  export HTTPS_PROXY="${PROXY_URL}"
  export HTTP_PROXY="${PROXY_URL}"
fi

git add -A

if git diff --cached --quiet; then
  echo "no changes to sync"
  exit 0
fi

timestamp="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"
git commit -m "${COMMIT_PREFIX} ${timestamp}"
git push -u "${REMOTE_NAME}" "${BRANCH_NAME}"
