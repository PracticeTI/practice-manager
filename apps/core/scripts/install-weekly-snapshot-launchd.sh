#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SNAPSHOT_SCRIPT="$REPO_ROOT/scripts/create-weekly-snapshot.sh"

if [[ ! -x "$SNAPSHOT_SCRIPT" ]]; then
  chmod +x "$SNAPSHOT_SCRIPT"
fi

LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$LAUNCH_AGENTS_DIR/com.practice.weekly-snapshot.plist"
LABEL="com.practice.weekly-snapshot"
LOG_DIR="$HOME/Library/Logs"
OUT_LOG="$LOG_DIR/practice-weekly-snapshot.log"
ERR_LOG="$LOG_DIR/practice-weekly-snapshot.error.log"

mkdir -p "$LAUNCH_AGENTS_DIR"
mkdir -p "$LOG_DIR"

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>$SNAPSHOT_SCRIPT</string>
  </array>

  <key>WorkingDirectory</key>
  <string>$REPO_ROOT</string>

  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key>
    <integer>0</integer>
    <key>Hour</key>
    <integer>10</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>

  <key>EnvironmentVariables</key>
  <dict>
    <key>SNAPSHOT_NOTIFY</key>
    <string>1</string>
  </dict>

  <key>StandardOutPath</key>
  <string>$OUT_LOG</string>

  <key>StandardErrorPath</key>
  <string>$ERR_LOG</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$UID/$LABEL" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$UID" "$PLIST_PATH"
launchctl enable "gui/$UID/$LABEL"

echo "Installed weekly snapshot scheduler"
echo "- LaunchAgent: $PLIST_PATH"
echo "- Schedule: Sunday at 10:00 local time"
echo "- Log: $OUT_LOG"
echo "- Error log: $ERR_LOG"
echo
echo "To test immediately, run:"
echo "launchctl kickstart -k gui/$UID/$LABEL"
