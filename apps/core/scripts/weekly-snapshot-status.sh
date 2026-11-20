#!/bin/zsh

set -euo pipefail

REPO_SLUG="${REPO_SLUG:-one}"
SNAPSHOT_BASE_DIR="${SNAPSHOT_BASE_DIR:-$HOME/Backups/practice-snapshots}"
LAST_RUN_FILE="$SNAPSHOT_BASE_DIR/${REPO_SLUG}-last-run.txt"

if [[ ! -f "$LAST_RUN_FILE" ]]; then
  echo "No weekly snapshot has been created yet."
  exit 0
fi

echo "Weekly Snapshot Status"
echo "======================"
cat "$LAST_RUN_FILE"
echo
echo "Recent snapshots:"
ls -lh "$SNAPSHOT_BASE_DIR"/${REPO_SLUG}-*.tar.gz 2>/dev/null | tail -5 || echo "No snapshots found."
