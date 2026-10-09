# Uber Eats Promo Tracker

[Open the tracker](https://nadzz07.github.io/uber-promo-tracker/).

Apple Mail and SQLite on the Mac hold the private account list, original message
evidence, receipts and promo codes. GitHub Pages receives masked identities,
offer facts and derived totals. Full login emails can be imported privately in
**More → Login emails** on each device. They stay in that browser, wrap without
ellipsis and are never uploaded.

## Dashboard and account rules

- **Total Accounts:** every account, including archived and deactivated history.
- **Accessible:** accounts marked accessible in the authoritative private list.
- **Archived:** accounts outside active rotation, including Deactivated accounts.
  Archive status is independent of login access and receipt usage.
- **Available Offers:** the number of accessible, unarchived accounts with current opportunities eligible
  under the account-used rule.
- **Used:** five unique Eats receipts, or at least one Eats plus one Ride receipt.
  Lime journeys are included in Rides. Used and Archived accounts are excluded
  from recommendations.
- **Not finished:** accessible accounts with a started, current promo that has
  uses remaining. For example, 3 of 5 used leaves 2; 4 of 5 leaves 1. Unused
  and expired offers do not enter this section. Lifetime receipt completion
  remains separate from individual offer progress.

Fully used includes **Finished · Expired** (at least one receipt-confirmed use
before expiry) and **Finished · Fully consumed** (every use receipt-confirmed).
**Expired · Unused** has no confirmed use and never counts as Fully used.
Partially used offers remain valid with confirmed usage and uses left. Actual
order counts are preserved; expiry never changes 1/5 into 5/5. Account Used
remains independent. Needs checking, manually done and ignored offers stay distinct. Manual offer changes are browser-local. Duplicate receipt
copies count once; newer charges and sparse copies retain supported facts.

Offers end at the earlier explicit deadline or 35 elapsed days from the first
observed matching offer email. The latter is labelled **Estimated end**; it
cannot establish activation time. Reminders do not restart the clock. Unpriced
marketing and uncertain terms cannot become ready discounts.

Confirmed savings use the larger of stated saving components and a stated
receipt savings total, counting that amount once. Uber Cash balance payments
are excluded unless explicit promotional evidence supports savings. Cash emails
show recorded offers and history, not a verified wallet balance or guaranteed
stacking. Missing Uber One estimates require explicit receipt samples; without
them the dashboard explains **Unavailable**, rather than implying zero benefit.

Home shows a compact account overview, confirmed Total saved, best accounts and
an order planner. Secondary savings, history, receipts and import information
are under More. Desktop uses responsive grids; mobile previews a shorter account
list with access to all results. **More → Appearance** controls colour and layout.
The mobile navigation supports tapping and held-finger sliding with physical
damped springs, subtle flex, edge reflections and two shadow depths. Chromium
uses a live SVG backdrop-refraction filter. Safari uses accessible glass because
WebKit does not render SVG backdrop displacement. Foreground contrast is bounded
against even unknown bright pixels. Haptic ticks are attempted at maximum flex
only where the Vibration API exists; iOS Safari cannot provide them. No screen
capture or private DOM copying is involved. Reduced motion,
keyboard access, dialog focus and local preferences are supported.

The website shows an imported snapshot. **Up to date** means a successful Mail
scan within two hours; **Update due**, **Snapshot**, **Syncing** and **Attention** reflect
the actual known scan state. Update due means the last import is over two hours
old. The status opens Sync & data; a gentle pulse represents a current import.
Snapshot preparation is separate from Mail scan time. Expiry counts refresh
while the page is open, including open account details.

## Private Mac setup

Use Node 22.13 or newer (24 recommended). Preserve existing local fixes and use
the separate-clone and backup procedure in [RELEASE.md](RELEASE.md).

```bash
npm ci --ignore-scripts
cp tracker.example.env tracker.local.env
```

Set the private database and authoritative CSV paths in `tracker.local.env`.
Keep `TRACKER_READ_ONLY_MAIL=true`, `APPLE_MAIL_MOVE_INBOX_RECEIPTS=false` and
`APPLE_MAIL_TRASH_ARCHIVED=false`. Mail Automation permission is required.

The private CSV accepts `email,can_login,login_method,account_status`. Login
methods are iCloud, Google or Both. Account status may be active, archived or
deactivated; deactivated accounts cannot be marked accessible. Missing configured
access lists block imports. Accounts outside the list are skipped.

```bash
bash mac/preview-sync.sh
node mac/validate-private-data.js --db /absolute/path/private.db --access /absolute/path/account-access.local.csv --output-dir tracker-validation.local.new
node mac/export-device-accounts.js --db /absolute/path/private.db --output device-accounts.local.json
```

Validation backs up the source and reparses a copy twice. Complete-source repairs
require every stored message; partial imports cannot rebuild offer clocks or
merge legacy receipt identities. Prior derived records remain recoverable in
private repair journals. Missing original evidence or unexplained discrepancies
block release. Only original Mail/MBOX evidence can establish receipt coverage.

Backups include committed WAL data and have owner-only permissions. Optional
`TRACKER_COMPRESS_BACKUPS=true` compresses generated backups only after verifying
the decompressed bytes; the original database is never compressed or removed.

Archived / Can't log in routing to recoverable Bin/Trash exists as an optional
utility with additional explicit opt-ins. It is disabled by the read-only safety
switch. With `APPLE_MAIL_ARCHIVED_KEEP_EVIDENCE=true`, routing keeps receipts and
confirmed or uncertain used-promo evidence. Account-qualified Message-IDs prevent
moving another account's copy. A read-only `--plan` must retain original sources
before an `--execute-verified-plan` move. Mutations use a newly resolved physical
account Inbox rather than the unified Inbox. Every move verifies the exact
removed object and recoverable original; any discrepancy halts further routing. Preview
never routes messages. Mail movement requires its own explicit authorization;
validation and interface work do not require it. Bin is never emptied.

## Tests and publication

```bash
npm run validate
npx playwright install chromium webkit
npm run test:browser
TRACKER_BROWSER_ENGINE=webkit npm run test:browser
npm run build
```

CI checks Node 22/24 on Linux/macOS and Chromium/WebKit. The build publishes only
17 allowlisted application files; tests, documentation and private files are
excluded. Keep regression tests so later updates cannot silently change receipts,
savings, privacy or controls.

Merge only after private original-source validation and all CI pass. Pages
deployment is a separate guarded manual workflow on clean main with
`private_data_verified=true`; verify the published snapshot and interactions.
After a successful read-only preview, `bash mac/install-automation.sh` installs
hourly safe-data sync. Hourly pushes do not deploy Pages automatically.

The planner estimates savings before delivery/service fees. It uses receipt fee
samples or a manual estimate for extra orders, a bounded allocation search (up
to 24 accounts) and a £1,000 basket limit. Restaurant, item and location eligibility
still depend on Uber. A displayed receipt total does not establish a live wallet
balance or prove unstated Uber One fee discounts.
