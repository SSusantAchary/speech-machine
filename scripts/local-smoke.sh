#!/usr/bin/env bash
set -euo pipefail

API_URL="${API_URL:-http://localhost:8000}"
WEB_URL="${WEB_URL:-http://localhost:3000}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-change-me-strong}"

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: missing required command: $1" >&2
    exit 1
  fi
}

wait_for_url() {
  local name="$1"
  local url="$2"
  local attempts="${3:-60}"

  echo "Waiting for ${name}: ${url}"
  for _ in $(seq 1 "$attempts"); do
    if curl -fsS "$url" >/dev/null; then
      echo "OK: ${name}"
      return 0
    fi
    sleep 2
  done

  echo "ERROR: ${name} did not become ready: ${url}" >&2
  return 1
}

post_json() {
  local url="$1"
  local payload="$2"
  curl -fsS \
    -H "Content-Type: application/json" \
    -X POST "$url" \
    -d "$payload" \
    >/dev/null
}

need_cmd curl

wait_for_url "API health" "${API_URL}/health"
wait_for_url "API readiness" "${API_URL}/health/ready"
wait_for_url "Web" "${WEB_URL}"

setup_status="$(curl -fsS "${API_URL}/setup/status")"
setup_payload="$(printf '{"email":"%s","password":"%s"}' "$ADMIN_EMAIL" "$ADMIN_PASSWORD")"

if echo "$setup_status" | grep -q '"setup_required"[[:space:]]*:[[:space:]]*true'; then
  echo "Creating first local admin: ${ADMIN_EMAIL}"
  post_json "${API_URL}/setup" "$setup_payload"
else
  echo "Setup already completed"
fi

echo "Checking login endpoint for: ${ADMIN_EMAIL}"
post_json "${API_URL}/auth/login" "$setup_payload"

echo "Local smoke check passed"
