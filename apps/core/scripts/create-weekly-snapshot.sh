#!/bin/zsh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

if ! command -v git >/dev/null 2>&1; then
	echo "Error: git is required but was not found in PATH."
	exit 1
fi

if ! git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
	echo "Error: $REPO_ROOT is not a git repository."
	exit 1
fi

REPO_SLUG="${REPO_SLUG:-one}"
SNAPSHOT_BASE_DIR="${SNAPSHOT_BASE_DIR:-$HOME/Backups/practice-snapshots}"
KEEP_WEEKS="${KEEP_WEEKS:-12}"
SNAPSHOT_NOTIFY="${SNAPSHOT_NOTIFY:-0}"

WEEK_KEY="$(date +%Y-W%V)"
SNAPSHOT_NAME="${REPO_SLUG}-${WEEK_KEY}.tar.gz"
SNAPSHOT_PATH="$SNAPSHOT_BASE_DIR/$SNAPSHOT_NAME"

CURRENT_BRANCH="$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)"
HEAD_COMMIT_SHORT="$(git -C "$REPO_ROOT" rev-parse --short HEAD)"
HEAD_COMMIT_FULL="$(git -C "$REPO_ROOT" rev-parse HEAD)"
CREATED_AT_UTC="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

WORKTREE_STATUS="clean"
if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
	WORKTREE_STATUS="dirty"
fi

mkdir -p "$SNAPSHOT_BASE_DIR"

TEMP_DIR="$(mktemp -d)"
cleanup() {
	rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

mkdir -p "$TEMP_DIR/repo"
git -C "$REPO_ROOT" archive --format=tar HEAD | tar -xf - -C "$TEMP_DIR/repo"

cat > "$TEMP_DIR/SNAPSHOT_METADATA.txt" <<EOF
repo_slug=$REPO_SLUG
created_at_utc=$CREATED_AT_UTC
branch=$CURRENT_BRANCH
head_commit_short=$HEAD_COMMIT_SHORT
head_commit_full=$HEAD_COMMIT_FULL
worktree_status=$WORKTREE_STATUS
snapshot_file=$SNAPSHOT_NAME
EOF

ARCHIVE_ITEMS=("repo" "SNAPSHOT_METADATA.txt")

if [[ "$WORKTREE_STATUS" == "dirty" ]]; then
	git -C "$REPO_ROOT" diff > "$TEMP_DIR/UNCOMMITTED_WORKTREE.diff"
	git -C "$REPO_ROOT" diff --staged > "$TEMP_DIR/UNCOMMITTED_STAGED.diff"
	git -C "$REPO_ROOT" ls-files --others --exclude-standard > "$TEMP_DIR/UNTRACKED_FILES.txt"
	ARCHIVE_ITEMS+=("UNCOMMITTED_WORKTREE.diff" "UNCOMMITTED_STAGED.diff" "UNTRACKED_FILES.txt")
fi

tar -czf "$SNAPSHOT_PATH" -C "$TEMP_DIR" "${ARCHIVE_ITEMS[@]}"

if [[ "$KEEP_WEEKS" =~ ^[0-9]+$ ]] && [[ "$KEEP_WEEKS" -gt 0 ]]; then
	DAYS_TO_KEEP=$((KEEP_WEEKS * 7))
	find "$SNAPSHOT_BASE_DIR" -type f -name "${REPO_SLUG}-*.tar.gz" -mtime "+$DAYS_TO_KEEP" -delete
fi

SNAPSHOT_SIZE="$(du -h "$SNAPSHOT_PATH" | awk '{print $1}')"

LAST_RUN_FILE="$SNAPSHOT_BASE_DIR/${REPO_SLUG}-last-run.txt"
cat > "$LAST_RUN_FILE" <<EOF
created_at_utc=$CREATED_AT_UTC
archive=$SNAPSHOT_PATH
size=$SNAPSHOT_SIZE
branch=$CURRENT_BRANCH
commit=$HEAD_COMMIT_SHORT
status=$WORKTREE_STATUS
EOF

echo "Weekly snapshot created"
echo "- Archive: $SNAPSHOT_PATH"
echo "- Size:    $SNAPSHOT_SIZE"
echo "- Branch:  $CURRENT_BRANCH"
echo "- Commit:  $HEAD_COMMIT_SHORT"
echo "- Status:  $WORKTREE_STATUS"
echo "- LastRun: $LAST_RUN_FILE"

if [[ "$SNAPSHOT_NOTIFY" == "1" ]]; then
	if command -v osascript >/dev/null 2>&1; then
		osascript -e "display notification \"$SNAPSHOT_NAME ($SNAPSHOT_SIZE)\" with title \"Snapshot Completed\" subtitle \"$CURRENT_BRANCH @ $HEAD_COMMIT_SHORT\""
	fi
fi
