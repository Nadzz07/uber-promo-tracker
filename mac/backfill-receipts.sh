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
MOVE_INBOX_RECEIPTS="${APPLE_MAIL_MOVE_INBOX_RECEIPTS:-false}"

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
echo "Receipt mailbox: $RECEIPT_FOLDER"
echo "Inbox receipt discovery: enabled"
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
  echo
  echo "Chunk $CHUNK: $START to $END days ago"
  echo "  Reading filed receipts..."

  osascript -l JavaScript mac/export-uber-mail.js \
    0 "" "$END" "$RECEIPT_FOLDER" "$START" \
    > "$TMP_DIR/filed-receipts.json"

  node generate-promos.js \
    "$TMP_DIR/filed-receipts.json" \
    "$TMP_DIR/promos.json" \
    "$TMP_DIR/history.json" \
    "$PRIVATE_DB"

  echo "  Checking Inbox for receipts in the same date range..."

  osascript -l JavaScript mac/export-uber-mail.js \
    "$END" "INBOX" 0 "$RECEIPT_FOLDER" 0 "$START" \
    > "$TMP_DIR/inbox-candidates.json"

  node mac/find-inbox-receipts.js \
    "$TMP_DIR/inbox-candidates.json" \
    "$TMP_DIR/receipt-moves.json" \
    "$TMP_DIR/inbox-receipts.json"

  INBOX_RECEIPT_COUNT="$(
    node --input-type=module -e '
      import fs from "node:fs";
      const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
      console.log((data.messages || []).length);
    ' "$TMP_DIR/inbox-receipts.json"
  )"

  if (( INBOX_RECEIPT_COUNT > 0 )); then
    echo "  Importing $INBOX_RECEIPT_COUNT Inbox receipt(s)..."

    node generate-promos.js \
      "$TMP_DIR/inbox-receipts.json" \
      "$TMP_DIR/promos.json" \
      "$TMP_DIR/history.json" \
      "$PRIVATE_DB"

    if [[ "$MOVE_INBOX_RECEIPTS" == "true" ]]; then
      MOVE_RESULT="$(
        osascript -l JavaScript mac/move-inbox-receipts.js \
          "$TMP_DIR/receipt-moves.json" "$RECEIPT_FOLDER" "$END" "$START"
      )"
      echo "  Inbox receipt filing: $MOVE_RESULT"
    fi
  fi

  START="$END"
done

cp "$TMP_DIR/promos.json" promos.json
cp "$TMP_DIR/history.json" history.json

echo
echo "Historical receipt backfill complete."
echo "Private SQLite now contains receipts found both in $RECEIPT_FOLDER and Inbox."
echo "Run bash mac/update-promos.sh when you are ready to publish the refreshed safe snapshot."
