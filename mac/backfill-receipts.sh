#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f tracker.local.env ]]; then
  # shellcheck disable=SC1091
  source tracker.local.env
fi

RECEIPT_FOLDER="${APPLE_MAIL_RECEIPT_FOLDER:-Uber Receipts}"
RECENT_DAYS="${APPLE_MAIL_RECEIPT_DAYS:-90}"
HISTORY_DAYS="${APPLE_MAIL_RECEIPT_HISTORY_DAYS:-3650}"
CHUNK_DAYS="${APPLE_MAIL_RECEIPT_BACKFILL_CHUNK_DAYS:-180}"
PRIVATE_DB="${TRACKER_PRIVATE_DB:-uber-tracker.local.db}"

if (( RECENT_DAYS > 365 )); then
  RECENT_DAYS=90
fi

if (( HISTORY_DAYS <= RECENT_DAYS )); then
  echo "No historical receipt range remains to backfill."
  exit 0
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Historical receipt backfill"
echo "Mailbox: $RECEIPT_FOLDER"
echo "Range: $RECENT_DAYS to $HISTORY_DAYS days ago"
echo "Chunk size: $CHUNK_DAYS days"
echo

npm test

START="$RECENT_DAYS"
CHUNK=0

while (( START < HISTORY_DAYS )); do
  END=$(( START + CHUNK_DAYS ))
  if (( END > HISTORY_DAYS )); then
    END="$HISTORY_DAYS"
  fi

  CHUNK=$(( CHUNK + 1 ))
  echo "Chunk $CHUNK: $START to $END days ago"

  osascript -l JavaScript mac/export-uber-mail.js \
    0 "" "$END" "$RECEIPT_FOLDER" "$START" \
    > "$TMP_DIR/receipts.json"

  node generate-promos.js \
    "$TMP_DIR/receipts.json" \
    "$TMP_DIR/promos.json" \
    "$TMP_DIR/history.json" \
    "$PRIVATE_DB"

  START="$END"
done

cp "$TMP_DIR/promos.json" promos.json
cp "$TMP_DIR/history.json" history.json

echo
echo "Historical receipt backfill complete."
echo "Private SQLite now contains the accumulated history."
echo "Run bash mac/update-promos.sh when you are ready to publish the refreshed safe snapshot."
