#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")/.."

DB_PATH="${1:-}"

if [[ -z "$DB_PATH" ]]; then
  echo "Usage: bash mac/migrate-legacy-db.sh /path/to/uber_promo_tracker.db"
  exit 1
fi

if [[ ! -f "$DB_PATH" ]]; then
  echo "Legacy database not found: $DB_PATH"
  exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "sqlite3 is required for the one-time legacy migration."
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required for the one-time legacy migration."
  exit 1
fi

TMP_EXPORT="./legacy-promos.local.json"

cleanup() {
  rm -f "$TMP_EXPORT"
}
trap cleanup EXIT

echo "Reading accepted legacy promos locally..."

sqlite3 -readonly -json "$DB_PATH" "
SELECT
  account_alias,
  platform,
  CASE
    WHEN promo_code IS NOT NULL AND TRIM(promo_code) <> '' THEN 1
    ELSE 0
  END AS has_code,
  discount_value,
  minimum_spend,
  expiry_timestamp,
  expiry_basis
FROM promos
WHERE rejected = 0
ORDER BY account_alias, id;
" > "$TMP_EXPORT"

node migrate-legacy-history.js   "$TMP_EXPORT"   "./history.local.json"   "./accounts.local.json"   "./history.json"

npm test

echo
echo "Legacy migration complete."
echo "Full migrated history is private in history.local.json."
echo "Alias mapping is private in accounts.local.json."
echo "The public history file does not expose legacy-only records."
echo
echo "Next on the Mac: bash mac/update-promos.sh"
