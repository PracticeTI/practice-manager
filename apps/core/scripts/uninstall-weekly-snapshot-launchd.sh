#!/bin/zsh

set -euo pipefail

LABEL="com.practice.weekly-snapshot"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"

launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true

if [[ -f "$PLIST_PATH" ]]; then
  rm -f "$PLIST_PATH"
  echo "Uninstalled weekly snapshot scheduler"
  echo "- Removed: $PLIST_PATH"
else
  echo "Weekly snapshot scheduler not found at $PLIST_PATH"
fi
