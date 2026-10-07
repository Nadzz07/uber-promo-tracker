#!/bin/bash
# Shared runtime, configuration and exclusive lock for every Mail sync entry point.
umask 077
if [[ -f tracker.local.env ]]; then source tracker.local.env; fi

require_runtime() {
  if ! command -v node >/dev/null 2>&1 || ! node --input-type=module -e 'import { DatabaseSync } from "node:sqlite"; const db = new DatabaseSync(":memory:"); db.close();' >/dev/null 2>&1; then
    echo "Node.js 22.13 or newer with built-in SQLite is required." >&2
    exit 1
  fi
}

positive_days() {
  local value="$1" label="$2"
  if [[ ! "$value" =~ ^[0-9]{1,5}$ ]] || (( 10#$value < 1 || 10#$value > 36500 )); then
    echo "$label must be a positive whole number of days (1–36500)." >&2
    exit 1
  fi
  printf '%d' "$((10#$value))"
}

acquire_sync_lock() {
  TRACKER_LOCK=".tracker-sync.lock"
  if ! mkdir "$TRACKER_LOCK" 2>/dev/null; then
    echo "Another sync holds .tracker-sync.lock. Let it finish before retrying." >&2
    echo "After a crashed run, verify its recorded PID is no longer running before removing the lock directory." >&2
    exit 1
  fi
  printf '%s\n' "$$" > "$TRACKER_LOCK/pid"
  TMP_DIR=""
  trap '[[ -z "$TMP_DIR" ]] || rm -rf "$TMP_DIR"; rm -f "$TRACKER_LOCK/pid"; rmdir "$TRACKER_LOCK" 2>/dev/null || true' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  TMP_DIR="$(mktemp -d)"
}

load_recent_config() {
  PROMO_FOLDERS="${APPLE_MAIL_PROMO_FOLDERS:-${APPLE_MAIL_PROMO_FOLDER:-INBOX}}"
  PROMO_DAYS="$(positive_days "${APPLE_MAIL_PROMO_DAYS:-35}" APPLE_MAIL_PROMO_DAYS)"
  RECEIPT_FOLDER="${APPLE_MAIL_RECEIPT_FOLDER:-Uber Receipts}"
  RECEIPT_DAYS="$(positive_days "${APPLE_MAIL_RECEIPT_DAYS:-90}" APPLE_MAIL_RECEIPT_DAYS)"
  if (( RECEIPT_DAYS > 365 )); then RECEIPT_DAYS=90; fi
  PRIVATE_DB="${TRACKER_PRIVATE_DB:-uber-tracker.local.db}"
  MOVE_INBOX_RECEIPTS="${APPLE_MAIL_MOVE_INBOX_RECEIPTS:-true}"
  if [[ "$MOVE_INBOX_RECEIPTS" != true && "$MOVE_INBOX_RECEIPTS" != false ]]; then
    echo "APPLE_MAIL_MOVE_INBOX_RECEIPTS must be true or false." >&2; exit 1
  fi
}

export_recent_mail() {
  echo "Exporting recent Mail..."
  osascript -l JavaScript mac/export-uber-mail.js \
    "$PROMO_DAYS" "$PROMO_FOLDERS" "$RECEIPT_DAYS" "$RECEIPT_FOLDER" \
    > "$TMP_DIR/emails.json"
  node --input-type=module -e 'import fs from "node:fs"; const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!Array.isArray(p.messages)) throw new Error("Invalid Mail export"); console.log("Exported messages: " + p.messages.length);' "$TMP_DIR/emails.json"
  cp "$TMP_DIR/emails.json" emails.local.json.tmp
  mv emails.local.json.tmp emails.local.json
}

file_imported_receipts() {
  if [[ "$MOVE_INBOX_RECEIPTS" == true ]]; then
    node mac/find-inbox-receipts.js emails.local.json "$TMP_DIR/receipt-moves.json"
    if ! osascript -l JavaScript mac/move-inbox-receipts.js "$TMP_DIR/receipt-moves.json" "$RECEIPT_FOLDER" "$PROMO_DAYS"; then
      echo "Receipt filing failed; imported data is safe. Filing can be retried on the next sync." >&2
    fi
  fi
}
