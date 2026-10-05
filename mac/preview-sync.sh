#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ -f tracker.local.env ]]; then
  # shellcheck disable=SC1091
  source tracker.local.env
fi

PROMO_FOLDERS="${APPLE_MAIL_PROMO_FOLDERS:-${APPLE_MAIL_PROMO_FOLDER:-INBOX}}"
PROMO_DAYS="${APPLE_MAIL_PROMO_DAYS:-60}"
RECEIPT_FOLDER="${APPLE_MAIL_RECEIPT_FOLDER:-Uber Receipts}"
CONFIGURED_RECEIPT_DAYS="${APPLE_MAIL_RECEIPT_DAYS:-90}"
PRIVATE_DB="${TRACKER_PRIVATE_DB:-uber-tracker.local.db}"
MOVE_INBOX_RECEIPTS="${APPLE_MAIL_MOVE_INBOX_RECEIPTS:-false}"

RECEIPT_DAYS="$CONFIGURED_RECEIPT_DAYS"
if (( RECEIPT_DAYS > 365 )); then
  echo "Routine receipt lookback was set to $RECEIPT_DAYS days."
  echo "Using 90 days for preview sync; historical receipts belong in mac/backfill-receipts.sh."
  RECEIPT_DAYS=90
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required. Install Node 22 or newer, then run this again."
  exit 1
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( NODE_MAJOR < 22 )); then
  echo "Node.js 22+ is required for the private SQLite store. Current: $(node --version)"
  exit 1
fi

TMP_DIR="$(mktemp -d)"
MOVE_FILE="receipt-moves.local.json"
trap 'rm -rf "$TMP_DIR"; rm -f "$MOVE_FILE"' EXIT

echo "Uber Eats Promo Tracker — private preview sync"
echo "Promo mailboxes: $PROMO_FOLDERS ($PROMO_DAYS days)"
echo "Receipt mailbox: $RECEIPT_FOLDER ($RECEIPT_DAYS days)"
echo "Public site: unchanged"
echo

echo "=== Exporting recent Mail ==="
osascript -l JavaScript mac/export-uber-mail.js \
  "$PROMO_DAYS" "$PROMO_FOLDERS" \
  "$RECEIPT_DAYS" "$RECEIPT_FOLDER" \
  > emails.local.json

node --input-type=module - <<'NODE'
import fs from "node:fs";

const data = JSON.parse(fs.readFileSync("emails.local.json", "utf8"));
const messages = data.messages || [];
const promo = messages.filter(message => message.mailbox === "promo");
const receipts = messages.filter(message => message.mailbox === "receipt");
const recipients = new Set(messages.map(message => message.recipient).filter(Boolean));

console.log("Exported Uber messages:", messages.length);
console.log("Promo-role messages:", promo.length);
console.log("Receipt-role messages:", receipts.length);
console.log("Unique recipient accounts in export:", recipients.size);
NODE

echo
echo "=== Running tests ==="
npm test

echo
echo "=== Importing into private SQLite ==="
node generate-promos.js \
  emails.local.json \
  "$TMP_DIR/promos.json" \
  "$TMP_DIR/history.json" \
  "$PRIVATE_DB"

if [[ "$MOVE_INBOX_RECEIPTS" == "true" ]]; then
  echo
  echo "=== Filing confirmed Inbox receipts ==="
  node mac/find-inbox-receipts.js emails.local.json "$MOVE_FILE"
  MOVE_RESULT="$(
    osascript -l JavaScript mac/move-inbox-receipts.js \
      "$MOVE_FILE" "$RECEIPT_FOLDER" "$PROMO_DAYS"
  )"
  echo "Inbox receipt filing: $MOVE_RESULT"
fi

echo
echo "Preview sync complete."
echo "Private SQLite has been updated."
echo "No Git commit or push was performed."
