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
ssh "$REMOTE" "bash -lc 'set -u; set -a; [[ -f .env.production ]] && source .env.production; set +a; health_token=\"\${SPARKCANVAS_AUTH_TOKEN:-demo-token}\"; for i in \$(seq 1 40); do auth_status=\$(curl -sS -o /dev/null -w \"%{http_code}\" http://127.0.0.1:23080/api/auth/config || true); ai_status=\$(curl -sS -o /dev/null -w \"%{http_code}\" -H \"Authorization: Bearer \$health_token\" http://127.0.0.1:23080/api/ai/status || true); if [[ \"\$auth_status\" == \"200\" && \"\$ai_status\" == \"200\" ]]; then exit 0; fi; sleep 3; done; echo \"marketing health check timed out\" >&2; exit 1'"

echo "Deployed $BRANCH to $REMOTE:$DEPLOY_PATH"
