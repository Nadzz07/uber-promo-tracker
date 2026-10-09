#!/bin/bash
# Shared runtime, configuration and exclusive lock for every Mail sync entry point.
umask 077
if [[ -f tracker.local.env ]]; then source tracker.local.env; fi
export TRACKER_ACCOUNT_ACCESS TRACKER_PRIVATE_DB TRACKER_FULL_RESCAN TRACKER_COMPRESS_BACKUPS

run_tracker_tests() {
  env -u TRACKER_ACCOUNT_ACCESS -u TRACKER_ALLOW_UNKNOWN_ACCOUNTS -u TRACKER_PRIVATE_DB -u TRACKER_FULL_RESCAN npm test
}

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
  TRACKER_ACCOUNT_ACCESS="${TRACKER_ACCOUNT_ACCESS:-account-access.local.csv}"
  export TRACKER_ACCOUNT_ACCESS
  export TRACKER_ALLOW_UNKNOWN_ACCOUNTS=0
  if [[ ! -f "$TRACKER_ACCOUNT_ACCESS" ]]; then
    echo "An existing authoritative account access CSV is required before Mail sync." >&2; exit 1
  fi
  node --input-type=module -e 'import fs from "node:fs"; import { parseAccessList } from "./access-list.js"; parseAccessList(fs.readFileSync(process.argv[1], "utf8"));' "$TRACKER_ACCOUNT_ACCESS"
  MOVE_INBOX_RECEIPTS="${APPLE_MAIL_MOVE_INBOX_RECEIPTS:-false}"
  TRASH_ARCHIVED_MAIL="${APPLE_MAIL_TRASH_ARCHIVED:-false}"
  if [[ "$MOVE_INBOX_RECEIPTS" != true && "$MOVE_INBOX_RECEIPTS" != false ]]; then
    echo "APPLE_MAIL_MOVE_INBOX_RECEIPTS must be true or false." >&2; exit 1
  fi
  if [[ "$TRASH_ARCHIVED_MAIL" != true && "$TRASH_ARCHIVED_MAIL" != false ]]; then
    echo "APPLE_MAIL_TRASH_ARCHIVED must be true or false." >&2; exit 1
  fi
}

export_recent_mail() {
  echo "Exporting recent Mail..."
  node mac/export-known-messages.js "${PRIVATE_DB:-uber-tracker.local.db}" > "$TMP_DIR/known-messages.json"
  osascript -l JavaScript mac/export-uber-mail.js \
    "$PROMO_DAYS" "$PROMO_FOLDERS" "$RECEIPT_DAYS" "$RECEIPT_FOLDER" 0 0 "" "$TMP_DIR/known-messages.json" \
    > "$TMP_DIR/emails.json"
  node --input-type=module -e 'import fs from "node:fs"; const p=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(!Array.isArray(p.messages)) throw new Error("Invalid Mail export"); console.log("Exported messages: " + p.messages.length);' "$TMP_DIR/emails.json"
  # Receipt discovery needs the full receipt window in Inbox too. Previously
  # Inbox ages 35–90 days fell between the promo scan and historical backfill.
  osascript -l JavaScript mac/export-uber-mail.js "$RECEIPT_DAYS" "INBOX" 0 "$RECEIPT_FOLDER" 0 0 "" "$TMP_DIR/known-messages.json" > "$TMP_DIR/inbox-candidates.json"
  node mac/find-inbox-receipts.js "$TMP_DIR/inbox-candidates.json" "$TMP_DIR/inbox-receipt-ids.json" "$TMP_DIR/inbox-receipts.json"
  node --input-type=module - "$TMP_DIR/emails.json" "$TMP_DIR/inbox-receipts.json" <<'JS'
import fs from 'node:fs';
import { messageKey } from './identity.js';
const [mainPath, inboxPath] = process.argv.slice(2);
const main = JSON.parse(fs.readFileSync(mainPath));
const inbox = JSON.parse(fs.readFileSync(inboxPath));
const unique = new Map();
for (const message of [...main.messages, ...inbox.messages]) unique.set(messageKey(message), message);
main.messages = [...unique.values()];
fs.writeFileSync(mainPath + '.tmp', JSON.stringify(main));
fs.renameSync(mainPath + '.tmp', mainPath);
JS
  cp "$TMP_DIR/emails.json" emails.local.json.tmp
  mv emails.local.json.tmp emails.local.json
}

file_imported_receipts() {
  # An explicit second opt-in protects existing local configs that enabled routing.
  if [[ "${TRACKER_READ_ONLY_MAIL:-true}" != false ]]; then return; fi
  if [[ "$MOVE_INBOX_RECEIPTS" != true && "$TRASH_ARCHIVED_MAIL" != true ]]; then
    return
  fi

  # Routing is planned only after generate-promos has committed the private
  # receipt/account evidence. Mail movement can therefore fail without losing
  # receipt history or savings.
  local preservation_args=()
  if [[ "${APPLE_MAIL_ARCHIVED_KEEP_EVIDENCE:-true}" == true ]]; then preservation_args+=(--keep-receipts-and-used-promos); fi
  node mac/plan-inbox-routing.js \
    emails.local.json "$PRIVATE_DB" \
    "$TMP_DIR/receipt-moves.json" "$TMP_DIR/archived-trash.json" "${preservation_args[@]}"
  local audit_dir="mail-routing.local.$(date -u +%Y%m%dT%H%M%SZ)-$$"
  mkdir "$audit_dir"
  cp "$TMP_DIR/receipt-moves.json" "$audit_dir/receipt-moves.local.json"
  cp "$TMP_DIR/archived-trash.json" "$audit_dir/archived-bin.local.json"

  if [[ "$MOVE_INBOX_RECEIPTS" == true ]]; then
    if ! osascript -l JavaScript mac/move-inbox-receipts.js "$TMP_DIR/receipt-moves.json" "$RECEIPT_FOLDER" "$PROMO_DAYS" > "$audit_dir/receipt-result.local.json"; then
      echo "Receipt filing failed; imported data is safe. Filing can be retried on the next sync." >&2
    fi
  fi

  if [[ "$TRASH_ARCHIVED_MAIL" == true ]]; then
    if ! osascript -l JavaScript mac/trash-archived-inbox.js "$TMP_DIR/archived-trash.json" "$PROMO_DAYS" > "$audit_dir/bin-result.local.json"; then
      echo "Archived-account Bin routing failed; imported data is safe and affected messages remain in Inbox." >&2
    fi
  fi
}
