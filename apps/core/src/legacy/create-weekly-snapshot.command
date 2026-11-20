#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SNAPSHOT_SCRIPT="$SCRIPT_DIR/scripts/create-weekly-snapshot.sh"

if [[ ! -x "$SNAPSHOT_SCRIPT" ]]; then
  chmod +x "$SNAPSHOT_SCRIPT"
fi

"$SNAPSHOT_SCRIPT"
STATUS=$?

echo
if [[ $STATUS -eq 0 ]]; then
  echo "Snapshot completed successfully."
else
  echo "Snapshot failed with exit code $STATUS."
fi

echo
read "?Press Enter to close... "

exit $STATUS
