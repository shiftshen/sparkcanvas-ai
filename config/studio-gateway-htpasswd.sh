#!/bin/sh
# Runs inside the official nginx image's /docker-entrypoint.d before nginx starts.
# Generates /etc/nginx/.htpasswd from env so no credential is committed to git.
set -eu

if [ -n "${STUDIO_BASIC_AUTH_USER:-}" ] && [ -n "${STUDIO_BASIC_AUTH_PASSWORD:-}" ]; then
  apk add --no-cache apache2-utils >/dev/null 2>&1 || true
  htpasswd -bc /etc/nginx/.htpasswd "$STUDIO_BASIC_AUTH_USER" "$STUDIO_BASIC_AUTH_PASSWORD"
  echo "studio-gateway: htpasswd generated for user '$STUDIO_BASIC_AUTH_USER'"
else
  # Fail closed: an empty htpasswd makes auth_basic reject every request rather
  # than accidentally exposing the unauthenticated studio API.
  echo "studio-gateway: STUDIO_BASIC_AUTH_USER/PASSWORD not set — denying all requests" >&2
  : > /etc/nginx/.htpasswd
fi
