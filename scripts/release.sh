#!/usr/bin/env bash
set -euo pipefail

VERSION="${1:?Usage: ./scripts/release.sh <version>}"

if [ -n "$(git status --porcelain)" ]; then
  echo "ERROR: working tree is not clean"
  exit 1
fi

if [ "$(git branch --show-current)" != "main" ]; then
  echo "ERROR: releases must be cut from main"
  exit 1
fi

npm --workspace apps/web test -- --run
npm --workspace packages/shared exec tsc -- --noEmit
(cd apps/api && PYTHONPATH=src pytest -q)
docker compose build

git tag -a "${VERSION}" -m "Release ${VERSION}"
git push origin main --tags
