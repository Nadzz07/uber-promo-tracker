#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Uber Eats Promo Tracker — Mac setup"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is missing. Install Node 22 or newer before continuing."
  exit 1
fi

NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
if (( NODE_MAJOR < 22 )); then
  echo "Node.js 22+ is required. Current: $(node --version)"
  exit 1
fi

echo "Node: $(node --version)"
node mac/init-private-db.js "${TRACKER_PRIVATE_DB:-uber-tracker.local.db}"

echo
echo "Apple Mail folders visible to scripting:"
osascript -l JavaScript mac/list-mailboxes.js

echo
echo "Copy tracker.example.env to tracker.local.env if you need custom folders."
echo "Multiple promo folders can be pipe-separated in APPLE_MAIL_PROMO_FOLDERS."
echo "Set APPLE_MAIL_RECEIPT_FOLDER if your receipt folder has a different name."
echo
echo "Then run:"
echo "  bash mac/update-promos.sh"
