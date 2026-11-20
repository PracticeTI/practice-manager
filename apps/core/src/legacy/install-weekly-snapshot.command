#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INSTALL_SCRIPT="$SCRIPT_DIR/scripts/install-weekly-snapshot-launchd.sh"

if [[ ! -x "$INSTALL_SCRIPT" ]]; then
  chmod +x "$INSTALL_SCRIPT"
fi

"$INSTALL_SCRIPT"
STATUS=$?

echo
if [[ $STATUS -eq 0 ]]; then
  echo "Weekly scheduler installed successfully."
else
  echo "Install failed with exit code $STATUS."
fi

echo
read "?Press Enter to close... "

exit $STATUS
