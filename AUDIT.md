# Engineering audit — 6 October 2026

The existing Home / Accounts / Used / More interface, private Mac SQLite source of truth, sanitised GitHub Pages snapshot and access-gated ordering flow are retained. This release does not seed accounts, receipts, savings or offers in public data.

## Findings and fixes

| Area | Finding | Correction |
| --- | --- | --- |
| Offer usage | A newer reminder became the receipt matching start date and could restore consumed uses | Match from the earliest observed email; retain the latest terms separately |
| Expiry | Exact time was dropped from public data; browser timezone and day rounding could keep an expired offer active | Shared Europe/London time handling, exact expiry in JSON, same boundary in matching and UI |
| Used view | Expired offers without fully consumed receipt uses were removed from the current snapshot | Retain closed offers and load matching history for review |
| Receipt parser | Loose money labels could parse total savings as the final charge; HTML entities and order-ID wording were missed | Anchored labels, HTML text handling, grouped GBP amounts and Order ID support |
| Rides/bikes | An Eats footer could prevent transport classification or contaminate Eats matching | Transport evidence takes priority; transport Inbox receipts participate in historical backfill |
| Receipt identity | Parser upgrades and sparse duplicate copies could duplicate receipts or overwrite known amounts | Migrate Message-ID keys, reuse stored receipt identity and preserve richer amount fields |
| First-N orders | Uber Cash matching could prevent the same Eats order counting toward its order allowance | Reconcile order-count usage independently of a cash match |
| Savings/fees | Receipts with unparsed fees were included as zero-fee samples | Average only receipts with observed fee fields |
| Access import | Reset happened before validation; spreadsheet status/CSV quoting could silently disable accounts | Parse and validate the entire list first, reject ambiguity, apply in one transaction |
| Privacy | Raw email subjects were copied to public titles | Build titles from offer facts; validate public fields, emails, private values and generation consistency |
| Database | A failure partway through a scan could leave partial state | Transactional import/reconciliation and owner-only database files |
| Sync | Concurrent runs, truncated exports and unrelated staged files could affect publishing | Shared lock, temporary export/snapshots, clean-main checks and explicit two-file commits |
| Mail | Metadata length mismatches and changing positional indexes could read or move the wrong message | Reject inconsistent indexes, verify message identity, report failed moves without identifiers |
| Backfill | Zero-size chunks could loop forever; chunks used moving date anchors; private runs dirtied public files | Validate ranges, use one anchor, leave public checkout untouched |
| Automation | XML-sensitive folder names could break the LaunchAgent | Escape XML, verify plist before reload, restrict log/plist permissions |
| UI | History fetch failure blocked the dashboard; learned fees became zero after reload; dialog focus escaped | Independent fetch handling, retry action, preserve automatic fee setting, keyboard focus containment and restoration |
| Planner | An allocation grid could miss an otherwise eligible single order with a penny minimum | Always evaluate the exact single-order basket; bound very large workloads |
| Release | Pages uploaded the entire checkout and ran independently of tests | Allowlisted site artifact and deployment dependent on tests, privacy checks and build |

## Validation

- Existing parser, SQLite, integration, usage, routing and dashboard tests remain in place.
- Added audit regressions for the failure modes above, including rollback, owner-only files, failed exports and overlapping syncs.
- Added Chromium tests at phone and desktop widths: eligibility, learned fees, manual receipt reconciliation, exact-time expiry, dialog keyboard focus, partial network failure and retry.
- CI tests Node 22/24 on Linux/macOS; a separate browser job tests the rendered app.
- The real access CSV was reconciled against its current source workbook and imported privately. No rows or identifiers are included here.
- The uploaded legacy test database was opened read-only, imported privately, checked against its original bytes, and kept historical. No legacy data was published.

## Remaining validation and limits

A live Apple Mail scan and LaunchAgent run must still be checked on the user's Mac. This environment cannot grant or exercise its Mail Automation permissions. Validate preview sync first, inspect the local results, then run the normal publisher.

Receipt email time is an order-time proxy. No order ID means deduplication relies on the available timestamp and amounts. Sender/display-name classification is a parsing hint, not an authentication check. Ambiguous matches and unknown expiry stay out of recommendations.

Manual changes remain local to a browser and reconciliation is count-based. Splits use a bounded allocation grid and candidate set; restaurant, item and location restrictions still need checking when ordering. See README for those bounds and for recovery steps.

## Platform references

- [Node SQLite API](https://nodejs.org/download/release/v22.13.1/docs/api/sqlite.html)
- [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

## Visual design validation

The interface uses layered frosted glass, restrained jade highlights, clearer typography and a desktop planner/discovery workspace. Mobile keeps the single-column ordering flow and reachable navigation. Motion uses short opacity/transform transitions and respects reduced-motion preferences. Browser checks cover 320, 390, 768 and 1440 pixel widths, keyboard focus, modal interactions and network recovery. Synthetic browser fixtures are intercepted only during tests and are never published. An existing test-code collision with private historical data was replaced with an explicitly synthetic fixture.
