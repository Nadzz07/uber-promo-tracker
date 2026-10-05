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
  echo "Using 90 days for the normal sync; historical receipts belong in mac/backfill-receipts.sh."
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

echo "Updating Uber Eats Promo Tracker..."
echo "Promo mailboxes: $PROMO_FOLDERS ($PROMO_DAYS days)"
echo "Receipt mailbox: $RECEIPT_FOLDER ($RECEIPT_DAYS days)"

if command -v git >/dev/null 2>&1; then
  git pull --ff-only
fi

osascript -l JavaScript mac/export-uber-mail.js \
  "$PROMO_DAYS" "$PROMO_FOLDERS" \
  "$RECEIPT_DAYS" "$RECEIPT_FOLDER" \
  > emails.local.json

npm test
node generate-promos.js \
  emails.local.json \
  promos.json \
  history.json \
  "$PRIVATE_DB"

if [[ "$MOVE_INBOX_RECEIPTS" == "true" ]]; then
  node mac/find-inbox-receipts.js emails.local.json receipt-moves.local.json
  MOVE_RESULT="$(
    osascript -l JavaScript mac/move-inbox-receipts.js \
      receipt-moves.local.json "$RECEIPT_FOLDER" "$PROMO_DAYS"
  )"
  echo "Inbox receipt filing: $MOVE_RESULT"
  rm -f receipt-moves.local.json
fi

if ! command -v git >/dev/null 2>&1; then
  echo "Git is unavailable. Public JSON was generated locally but not published."
  exit 0
fi

git add promos.json history.json

if git diff --cached --quiet; then
  echo "No public tracker changes to publish."
  exit 0
fi

git commit -m "Update Uber Eats tracker from Apple Mail"
git push

echo "Tracker update published."
