#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
source mac/common.sh
require_runtime
load_recent_config
acquire_sync_lock

# Never mix a data sync with someone's code work or unrelated staged files.
if [[ "$(git branch --show-current)" != main ]]; then
  echo "Publishing requires the main branch. Use mac/preview-sync.sh on other branches." >&2; exit 1
fi
if [[ -n "$(git status --porcelain --untracked-files=normal)" ]]; then
  echo "The checkout has pending changes. Commit or move them before publishing; private preview remains available." >&2; exit 1
fi
git pull --ff-only origin main
# A previous failed push may leave data-only commits. Never push unrelated local code.
if git log --format= --name-only origin/main..HEAD | sed '/^$/d' | grep -Ev '^(promos|history)\.json$' >/dev/null; then
  echo "Local commits include code changes. Publish those through a reviewed PR first." >&2; exit 1
fi
SYNC_HEAD="$(git rev-parse HEAD)"
npm test
export_recent_mail
node generate-promos.js emails.local.json "$TMP_DIR/promos.json" "$TMP_DIR/history.json" "$PRIVATE_DB"
node validate-public.js "$TMP_DIR/promos.json" "$TMP_DIR/history.json"
file_imported_receipts
if [[ "$(git rev-parse HEAD)" != "$SYNC_HEAD" || "$(git branch --show-current)" != main ]]; then
  echo "The checkout changed during the scan. Private import is safe; rerun publishing from a stable main branch." >&2; exit 1
fi
cp "$TMP_DIR/promos.json" promos.json.tmp
cp "$TMP_DIR/history.json" history.json.tmp
mv promos.json.tmp promos.json
mv history.json.tmp history.json
if ! git diff --quiet -- promos.json history.json; then
  # --only prevents an unrelated file staged during the scan joining this commit.
  git commit --only -m "Update Uber Eats tracker from Apple Mail" -- promos.json history.json
fi
PUBLISH_HEAD="$(git rev-parse HEAD)"
if git log --format= --name-only "origin/main..$PUBLISH_HEAD" | sed '/^$/d' | grep -Ev '^(promos|history)\.json$' >/dev/null; then
  echo "Code commits appeared during the scan. Data was retained locally; nothing was pushed." >&2; exit 1
fi
git push origin "$PUBLISH_HEAD:refs/heads/main"
echo "Tracker update published."
