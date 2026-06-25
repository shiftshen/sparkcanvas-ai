#!/usr/bin/env bash
# Deploy ONLY the WGOS studio stack (studio + studio-gateway) to 1.83, leaving
# the marketing backend/frontend services untouched. Requires STUDIO_BASIC_AUTH_USER
# and STUDIO_BASIC_AUTH_PASSWORD to be present in the server's .env.production.
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
  --exclude 'output/' \
  --exclude 'auth.json' \
  --exclude 'config/auth.json' \
  --exclude '.env' \
  --exclude '.env.production' \
  --exclude '.env.local' \
  --exclude '.env.*.local' \
  --exclude '*.tsbuildinfo' \
  "$ROOT"/ "$REMOTE:$DEPLOY_PATH/"

# Build + (re)create only the studio services. Marketing backend/frontend stay up.
ssh "$REMOTE" "cd '$DEPLOY_PATH' && docker compose --env-file .env.production -f config/docker-compose.yml up -d --build studio studio-gateway"

# Health: gateway must demand auth (401 without creds) and serve the studio (200 with creds).
ssh "$REMOTE" "bash -lc 'set -u; set -a; [[ -f .env.production ]] && source .env.production; set +a; for i in \$(seq 1 40); do noauth=\$(curl -sS -o /dev/null -w \"%{http_code}\" http://127.0.0.1:23090/ || true); authed=\$(curl -sS -o /dev/null -w \"%{http_code}\" -u \"\${STUDIO_BASIC_AUTH_USER}:\${STUDIO_BASIC_AUTH_PASSWORD}\" http://127.0.0.1:23090/ || true); if [[ \"\$noauth\" == \"401\" && \"\$authed\" == \"200\" ]]; then echo \"studio gateway healthy (no-auth=401 authed=200)\"; exit 0; fi; sleep 3; done; echo \"studio gateway health check failed (no-auth=\$noauth authed=\$authed)\" >&2; exit 1'"

echo "Deployed studio ($BRANCH) to $REMOTE:$DEPLOY_PATH (gateway on :23090)"
echo "Next: point studio.xmanx.com -> 127.0.0.1:23090 in 1panel (TLS), and ensure DNS A record exists."
