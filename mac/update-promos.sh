#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Updating Uber Promo Tracker from Apple Mail..."

if command -v git >/dev/null 2>&1; then
  git pull --ff-only
fi

osascript -l JavaScript mac/export-uber-mail.js 45 > emails.local.json

npm test
npm run generate -- emails.local.json promos.json

if ! command -v git >/dev/null 2>&1; then
  echo "Git is not installed. promos.json was generated locally but was not published."
  exit 0
fi

git add promos.json

if git diff --cached --quiet; then
  echo "No promo changes to publish."
  exit 0
fi

git commit -m "Update promos from Apple Mail"
git push

echo "Promo dashboard update published."
