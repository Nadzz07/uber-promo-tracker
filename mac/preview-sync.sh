#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
source mac/common.sh
require_runtime
load_recent_config
acquire_sync_lock
npm test
export_recent_mail
node generate-promos.js emails.local.json "$TMP_DIR/promos.json" "$TMP_DIR/history.json" "$PRIVATE_DB"
node validate-public.js "$TMP_DIR/promos.json" "$TMP_DIR/history.json"
echo "Private preview complete. SQLite is updated; no Mail messages were moved or deleted and no Git commit or push was performed."
