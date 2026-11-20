#!/usr/bin/env bash
#
# Drains the patient Quote Writer queue.
#
# The Quote Writer runs inside the app rather than in the worker service, because
# every line it writes is priced against `src/lib/ndisSupportCatalogue.js` — the
# single source of truth for NDIS price limits. This script is the local/ops way
# to drive that worker; in a deployment the worker service's
# QUOTE_WRITER_TRIGGER_URL (or a Vercel Cron) calls the same endpoint.
#
# Usage:
#   scripts/run-quote-writer.sh                 # http://localhost:3000
#   scripts/run-quote-writer.sh http://localhost:3000 5
#
# The endpoint authorises with the service shared secret, a superadmin token, or
# (outside production) no token at all.

set -euo pipefail

BASE_URL="${1:-http://localhost:3000}"
BATCH_SIZE="${2:-}"

BODY='{}'
if [[ -n "$BATCH_SIZE" ]]; then
    BODY="{\"batch_size\": ${BATCH_SIZE}}"
fi

curl --fail-with-body -sS -X POST "${BASE_URL}/api/database/quotes/run-jobs" \
    -H 'Content-Type: application/json' \
    -d "$BODY"
echo
