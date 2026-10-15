#!/usr/bin/env bash
# Times /health and a week of /api/schedule (NFR-01, NFR-02).
# Usage: BASE_URL=https://<app>.vercel.app COOKIE='planning_session=...' scripts/time-schedule.sh
# Copy COOKIE from the browser's devtools after signing in. Locally, leave COOKIE out to use the dev identity.
set -euo pipefail
BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
FROM="$(date -d "-$(( ($(date +%u) - 1) )) days" +%F)"
TO="$(date -d "$FROM +6 days" +%F)"
curl -sI "$BASE_URL/health" | grep -i x-vercel-id || true
for i in 1 2 3 4 5; do curl -s -o /dev/null -w "health   %{http_code} %{time_total}s\n" "$BASE_URL/health"; done
for i in 1 2 3 4 5; do curl -s -o /dev/null -w "schedule %{http_code} %{time_total}s\n" ${COOKIE:+-H "Cookie: $COOKIE"} "$BASE_URL/api/schedule?from=$FROM&to=$TO"; done
