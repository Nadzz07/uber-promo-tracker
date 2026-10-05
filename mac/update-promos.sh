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
RECEIPT_SYNC_DAYS="${APPLE_MAIL_RECEIPT_SYNC_DAYS:-120}"
RECEIPT_ROUTE_DAYS="${APPLE_MAIL_RECEIPT_ROUTE_DAYS:-120}"
PRIVATE_DB="${TRACKER_PRIVATE_DB:-uber-tracker.local.db}"

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
echo "Receipt mailbox: $RECEIPT_FOLDER ($RECEIPT_SYNC_DAYS recent days)"
echo

if command -v git >/dev/null 2>&1; then
  git pull --ff-only
fi

# Verify the checked-out tracker before allowing it to move Mail messages.
npm test

echo
echo "Routing recent Uber Eats receipts from Inbox..."
osascript -l JavaScript mac/route-uber-receipts.js   "$RECEIPT_ROUTE_DAYS" "$RECEIPT_FOLDER"

echo
echo "Exporting recent Uber Mail..."
osascript -l JavaScript mac/export-uber-mail.js   "$PROMO_DAYS" "$PROMO_FOLDERS"   "$RECEIPT_SYNC_DAYS" "$RECEIPT_FOLDER"   > emails.local.json

node generate-promos.js   emails.local.json   promos.json   history.json   "$PRIVATE_DB"

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
