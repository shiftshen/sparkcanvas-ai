#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
BRANCH="${1:-$(git -C "$ROOT" branch --show-current)}"
REMOTE="${DEPLOY_REMOTE:-1panel-happy}"
DEPLOY_PATH="${DEPLOY_PATH:-/home/happy/apps/sparkcanvas-marketing}"

if [[ -z "$BRANCH" ]]; then
  echo "No current git branch found." >&2
  exit 1
fi

git -C "$ROOT" push origin "$BRANCH"

rsync -az --delete \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'backend/data/' \
  --exclude 'evidence/' \
  --exclude 'auth.json' \
  --exclude 'config/auth.json' \
  --exclude '.env' \
  --exclude '.env.production' \
  --exclude '.env.local' \
  --exclude '.env.*.local' \
  --exclude '*.tsbuildinfo' \
  "$ROOT"/ "$REMOTE:$DEPLOY_PATH/"

ssh "$REMOTE" "cd '$DEPLOY_PATH' && docker compose --env-file .env.production -f config/docker-compose.yml up -d --build --force-recreate backend frontend"
ssh "$REMOTE" "curl -fsS http://127.0.0.1:23080/api/auth/config >/dev/null && curl -fsS -H 'Authorization: Bearer demo-token' http://127.0.0.1:23080/api/ai/status >/dev/null"

echo "Deployed $BRANCH to $REMOTE:$DEPLOY_PATH"
