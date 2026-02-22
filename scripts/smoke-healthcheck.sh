#!/usr/bin/env bash
set -euo pipefail

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required for smoke check" >&2
  exit 1
fi

PORT="${PORT:-3000}"
DB_FILE="$(mktemp /tmp/flomik-labs-ci-db-XXXXXX.sqlite)"
LOG_FILE="$(mktemp /tmp/flomik-labs-ci-log-XXXXXX.txt)"
HEALTH_FILE="$(mktemp /tmp/flomik-labs-ci-health-XXXXXX.json)"
SERVER_PID=""

cleanup() {
  if [ -n "${SERVER_PID}" ] && kill -0 "${SERVER_PID}" >/dev/null 2>&1; then
    kill "${SERVER_PID}" >/dev/null 2>&1 || true
    wait "${SERVER_PID}" >/dev/null 2>&1 || true
  fi
  rm -f "${DB_FILE}" "${LOG_FILE}" "${HEALTH_FILE}"
}

trap cleanup EXIT

LL_DB_PATH="${DB_FILE}" HOST="127.0.0.1" PORT="${PORT}" npm start >"${LOG_FILE}" 2>&1 &
SERVER_PID=$!

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >"${HEALTH_FILE}" 2>/dev/null; then
    break
  fi
  sleep 1
done

if [ ! -s "${HEALTH_FILE}" ]; then
  echo "Health endpoint did not respond in time" >&2
  cat "${LOG_FILE}" >&2
  exit 1
fi

if ! grep -q '"ok":true' "${HEALTH_FILE}"; then
  echo "Health endpoint response does not contain ok=true" >&2
  cat "${HEALTH_FILE}" >&2
  exit 1
fi

echo "Smoke check passed: /api/health"
