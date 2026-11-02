# Device backup contract

## Coverage inventory

The browser has one private ledger (`uber-tracker-finance-encrypted-v1`, local envelope version 2), seven allowlisted settings stores, and a non-exportable encryption key in IndexedDB. The old storage-key name is retained for compatibility; it does not describe current local storage as encrypted.

| Store | Included records |
| --- | --- |
| Private ledger | Imported receipt/account source records, receipt corrections and undo history, checked Cash snapshots and timestamps, offer/receipt reconciliation links and their provenance |
| `manual-state:v3` | Manual offer-use entries/history, ignored/finished/restored offer actions, account notes, archival and manually recorded completion |
| `device-accounts:v1` | Imported full email identities, saved login access and login method |
| `theme:v1`, `layout:v1`, `motion:v1` | Saved custom colour, layout and motion preferences |
| `planner-settings:v1`, `offer-preferences:v1` | Saved basket/order/fee preferences and preferred-offer settings |
| `trackerSource` inside the ledger | Account source observations plus available or manually/receipt-referenced offer/history source records with stable associations. Unreferenced expired published offers and derived account totals are not copied into the private ledger. New published records take precedence; missing restored records remain available. These are source snapshots, not extra monetary totals to add. |

Legacy offer flags are converted into the existing manual-state shape when no version-3 store exists. Optional categories absent from older files remain untouched. Temporary routes, scroll positions, caches, credentials, unrelated storage, key material, Mail folders and the Mac SQLite database are excluded. Published summaries are never added to receipt-derived savings or payment totals. Existing calculation and reconciliation functions recompute the views after restoration.

## File and encryption

Downloads are JSON containers: `uber-tracker-device-encrypted`, outer schema 1, AES-GCM with a random 96-bit IV and authenticated format identifier. The key remains non-exportable in the original origin/browser profile's IndexedDB.

Inside the ciphertext, the existing `uber-tracker-private-finance` schema-1 payload carries `deviceBackup`: format `uber-tracker-device-backup`, schema 2, ISO creation timestamp, explicit coverage and allowlisted setting values. Stable record IDs, original fields, financial unknowns, currencies and explicit zeroes are preserved. Offer-source coverage is declared only when those source records are present; `offerSourceScope` is `available-and-referenced`. Filenames contain the creation date/time. Only Save backup generates and hands off a download; the UI reports download initiation rather than a confirmed filesystem save.

**Portability limitation:** this encryption is browser-bound. A fresh browser cannot decrypt an existing device-encrypted backup without the original browser's key. Export does not claim cross-device recovery. No passphrase UI, shared key, plaintext fallback or key packaged with ciphertext has been added. Clearing site data destroys access to that key. Cross-device encrypted recovery needs a separately approved recovery/key-transfer architecture.

Existing inner schema-1 device backups remain supported as partial-category backups. Existing unencrypted private-finance transfer files remain supported by the established compatibility reader; new exports are always encrypted. Old passphrase-encrypted files require their original secret for conversion in the trusted Mac tooling; the browser preserves originals and reports that requirement without introducing lock or passphrase screens.

## Review and apply

Opening Export or Restore has no file-system side effects. Choose file and Change alone invoke the picker. Selection validates the envelope, supported versions/coverage, store shapes, relationships, unique receipt/account/history identities and source-offer associations before building a plan. All imported text is escaped and treated as data.

Preview and confirmation use the same plan. Proposed additions, updates, unchanged records, conflicts and rejected-record count are inspectable. A valid backup is accepted as a whole; malformed records reject the file, rather than being partially applied. Saved-value replacements need an explicit Keep saved / Use backup choice. Divergent correction or balance histories block restoration rather than selecting a winner by timestamp; resolve the affected record in its existing correction/balance flow first. Same-ID conflicting audit events are rejected. Missing records are merged, not deleted; repeated restoration does not sum uses or append copies of existing IDs.

Changes after preview invalidate the plan. Existing ledger coordination checks authoritative revisions across tabs, rechecks the setting baselines before writing, and restores previous values if a write fails. A pre-restore recovery snapshot uses the existing device-private recovery store; an encrypted recovery download is available through Backup details. This is browser-storage staging with rollback, not a claim of one atomic transaction across localStorage and IndexedDB. Other-tab ledger writes retain the existing revision conflict guard. After success the shared update callback reloads preferences, identities, usage, source projections and every downstream view. Published refresh never clears these device stores. No backup or restored private record is added to the public build allowlist.
