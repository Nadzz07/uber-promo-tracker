# Handover — Uber Eats Promo Tracker

Written 13 November 2026, at the point the previous developer stopped. Read this
first, then `README.md` (product rules), `RELEASE.md` (release procedure),
`BACKUPS.md` and `MAIL_REVIEW.md`.

The private counterpart to this document — file paths, data inventory, Mail
state and what must be transferred rather than cloned — is
`HANDOVER-PRIVATE.local.md`. It is git-ignored on purpose. Everything in *that*
file must be handed over directly, never through the repository.

---

## 1. What this is

A personal promo tracker for one person's Uber and Uber Eats accounts, used on an
iPhone as a home-screen web app.

- Live site: <https://nadzz07.github.io/uber-promo-tracker/>
- Repository: `github.com/Nadzz07/uber-promo-tracker` (public)
- Owner: Nadim (`Nadzz07`)
- Live revision at handover: `main` = `c73c591`
- Deployed by: GitHub Actions → GitHub Pages, guarded **manual** workflow
- Target device: iPhone 16 Pro Max, Safari, 393 × 852 pt (also checked at 440 × 956)

It is a static site: no server, no database in the cloud, no accounts, no
analytics. All private data lives on the owner's Mac and in each browser's
local storage. GitHub Pages receives only a sanitised snapshot.

That split is the single most important thing to understand before changing
anything.

---

## 2. The privacy boundary

| Layer | Holds | Leaves the Mac? |
| --- | --- | --- |
| Apple Mail + SQLite DB on the Mac | original messages, real emails, receipts, offer codes | No |
| `promos.json` / `history.json` | masked identities, offer facts, derived totals | Yes — committed and published |
| Browser local storage / IndexedDB | full emails, private finance vault, manual state | No |
| `dist/` | built allowlisted site | Yes (Pages artifact) |

Rules that must not be broken:

1. Only `promos.json` and `history.json` are committed from the data pipeline.
   Never commit a DB, CSV, MBOX, receipt export, vault transfer or `*.local.*`.
2. `build-site.js` publishes an explicit allowlist of application files (35 at
   handover). Adding a file to `dist/` requires adding it to that list; the
   reverse is automatic. Never turn it into a directory copy.
3. `public-snapshot.js` (`assertPublicSnapshot`) and `validate-public.js` reject
   a snapshot that contains private fields. `npm run build` calls the first, so a
   bad snapshot cannot even build.
4. Emails in the public snapshot are masked by `account-map.js`
   (`maskAccountAlias` → `ar…1p@icloud.com`). Full emails reach the device only
   through a private import the owner performs himself.
5. Private device data is never uploaded. It is exported/imported by the owner
   with the vault transfer files described in §6.

---

## 3. Current published state

From `promos.json` (`generatedAt` 2026-11-13T03:28Z, `demo: false`):

| Fact | Value |
| --- | --- |
| Accounts | 239 total, 217 marked accessible |
| Promo rows | 4,974 |
| Tracked orders / rides | 181 / 295 |
| Confirmed saved | £4,176.05 |
| Last successful Mail scan | 2026-11-13T03:21Z |
| Scan mode | `snapshot`, read-only |

These numbers move whenever Mail is rescanned. Do not hardcode them in tests;
tests read the snapshot or fixture data.

The site's "Up to date" badge means a successful scan within two hours. Older
than that and the UI shows *Update due* — that is data state, not a bug.

---

## 4. Repository map

The repo is large (≈660 entries) because the owner's local working files live in
the same folder. Only tracked files matter for the product.

### Application (published)

| Area | Files |
| --- | --- |
| Shell / navigation | `index.html`, `desktop-shell.js`, `nav-gestures.js`, `interaction-motion.js` |
| Theming | `theme-palette.js`, `theme-system.css`, `appearance.js`, `liquid-glass.js/.css` |
| Layout / design | `reference-finish.css`, `home-design.css`, `main-pages.css`, `icon-layout.css`, `planner-design.css`, `receipt-insights.css`, `sync-data.css`, `ui-refinements.css`, `desktop-layout.css`, `app-select-menus.css`, `app-select-menus.js` |
| Accounts | `account-state.js`, `account-map.js`, `account-sheet-data.js`, `account-expiry-tooltip.js`, `account-id.js` |
| Offers / promos | `offer-state.js`, `offer-details.js`, `offer-time.js`, `offer-preferences.js`, `preference-picker.js`, `offers` logic inside `index.html` |
| Money | `receipt-financials.js`, `financial-ledger.js`, `savings-intelligence.js`, `finance-layout.js`, `receipt-insights.js`, `weekly-savings.js`, `cash-ledger.js`, `cash-planner.js`, `cash-reconstruction.js` |
| Private device data | `private-finance-vault.js`, `private-finance-ui.js`, `device-accounts.js`, `device-backup.js`, `device-file-key.js`, `manual-state.js`, `offer-local-edits.js`, `offer-edit-ui.js`, `receipt-import.js`, `account-import.js`, `sync-data.js` |
| Receipts | `receipt-identity.js`, `receipt-intelligence.js`, `receipt-parser.js`, `receipt-store.js`, `receipt-review-evidence.js`, `receipt-date.js`, `receipt-text.js` |
| Parsing engine | `parser.js`, `parser-v2/*` (`cash.js`, `classifier.js`, `discount.js`, `expiry.js`, `parser.js`, `sender.js`, `utils.js`), `parser-fingerprint.js` |
| Mail policy (shared with the Mac tools) | `mail-review-rules.js`, `mail-filing-rules.js`, `cleanup-policy.js`, `mail-cleanup.js`, `reviewed-cleanup-plan.js`, `identity.js` |
| Build / publish | `build-site.js`, `generate-promos.js`, `validate-public.js`, `public-snapshot.js`, `public-promo.js`, `validate-release.js` |
| Docs | `README.md`, `RELEASE.md`, `BACKUPS.md`, `MAIL_REVIEW.md`, `HANDOVER.md` |

### Mac-side tools (tracked, run locally)

`mac/` contains the Mail.app AppleScript and SQLite automation: sync
(`preview-sync.sh`, `update-promos.sh`, `backfill-receipts.sh`), private
validation (`validate-private-data.js`), account registry
(`import-account-access.js`, `export-device-accounts.js`), Mail movement
(`prepare-mail-review.js`, `execute-mail-cleanup.js`, `move-inbox-receipts.js`,
`file-verified-receipts.js`, `plan-inbox-routing.js`), private finance export /
import (`private-finance.js`) and scheduling (`install-automation.sh`,
`set-sync-schedule.sh`).

These require macOS, Apple Mail automation permission and the private paths in
`tracker.local.env`. They cannot run in CI, in a container, or on Linux. Treat
them as production: they touch the owner's real mailbox.

### Not tracked (owner-only)

Everything matching `*.local.*` or `*.local/` — private DBs, exports, vault
transfers, one-off scripts, verification screenshots, reports. `dist/` and
`node_modules/` are also ignored. See `HANDOVER-PRIVATE.local.md` for the
inventory; the new developer needs those files copied, not cloned.

---

## 5. How data reaches the site

Two independent pipelines. Keep them separate.

### 5.1 Mail → snapshot (data)

```
Apple Mail ──read-only AppleScript──▶ emails.local.json
                                        │
private DB (SQLite, Mac only) ──────────┤
                                        ▼
                        generate-promos.js ──▶ promos.json + history.json
                                        │              │
                            validate-public.js         ▼
                                        │        validate-private-data.js
                                        ▼              │
                                 commit (data only) ───┘
```

Commands (see `RELEASE.md` for the full guarded version):

```bash
bash mac/preview-sync.sh                     # read-only dry run
node generate-promos.js emails.local.json promos.json history.json "$TRACKER_PRIVATE_DB"
node validate-public.js                      # privacy + shape
node mac/validate-private-data.js --db "$TRACKER_PRIVATE_DB" \
  --access "$TRACKER_ACCOUNT_ACCESS" --output-dir tracker-validation.local.new
```

`validate-private-data.js` copies the DB, reparses every stored message twice
and must report `idempotent`, `backupCreated`, `publicPrivacyPassed` and
`receiptsWithoutReparseableEvidence == 0`. A non-zero exit blocks release. It
never modifies the source database.

`generate-promos.js` takes the message export plus the DB and writes the public
snapshot. Offer clocks, receipt-to-offer matching and savings all come from that
pass, so a partial message export produces a partial snapshot — the validator
catches this.

### 5.2 Code → site (release)

```
feature branch ──PR──▶ CI (validate + browser matrix) ──▶ merge to main
                                                            │
                        python3 deploy-verified.local.py ────┤
                                                            ▼
                             pages.yml (manual, private_data_verified=true)
                                                            ▼
                                                   GitHub Pages
```

CI: `.github/workflows/test.yml` runs `npm run validate` on Node 22/24, Linux
+ macOS, and the browser suite on Chromium, WebKit and Firefox. Deployment is
`.github/workflows/pages.yml`, `workflow_dispatch` only, and its `deploy` job is
gated on `private_data_verified=true` plus `ref == refs/heads/main`.

The release gate is `deploy-verified.local.py`. It refuses to run unless: the
checkout is clean `main`, the last Mail scan is under two hours old, private
full-source validation passes, the published JSON is byte-identical to the
validated output, and every CI check on that exact SHA is green. It then
dispatches `pages.yml` and verifies the run. Prefer it over hand-running steps.

Manual equivalent, when the script cannot be used:

```bash
# needs a GitHub token with repo + workflow scope in the macOS keychain
python3 deploy-verified.local.py --check-only     # dry run of every gate
# or, after gates pass:
git push origin main                              # data-only commits
gh workflow run pages.yml --ref main -f private_data_verified=true
```

`gh` is not installed on the owner's Mac; the scripts talk to the API with a
token from `git credential fill`. Two API details that cost time before:
job logs 302-redirect to a signed URL (follow redirects, send a `User-Agent`),
and a merge can return 405 when the base branch moved — re-read the PR's
`mergeable_state` before retrying.

### 5.3 Automation on the Mac

Two launch agents, installed by `mac/install-automation.sh`:

| Agent | Runs | Does |
| --- | --- | --- |
| `com.nadzz07.uber-promo-tracker` | every 86,400 s (daily) | `hourly-sync.local.sh` → `mac/update-promos.sh`, reconcile, `deploy-verified.local.py` |
| `com.nadzz07.uber-promo-cleanup` | separate schedule | reviewed Mail cleanup policy |

Despite the "hourly" filename, the tracker agent is daily at handover. Hourly
syncs push safe data only; **Pages deployment stays a separate verified action**.
`mac/update-promos.sh` refuses to run on a non-`main` branch or a dirty checkout,
and refuses to push commits that contain anything other than `promos.json` /
`history.json`.

Mail routing flags stay off in `tracker.local.env`
(`TRACKER_READ_ONLY_MAIL=true`,
`APPLE_MAIL_MOVE_INBOX_RECEIPTS=false`, `APPLE_MAIL_TRASH_ARCHIVED=false`). Mail
movement requires its own explicit, bounded, digest-approved run.

---

## 6. Device-side private data

The phone/browser holds three things the snapshot cannot carry:

1. **Full login emails** — More → Login emails → "Choose private file"
   (`device-accounts.local.json`).
2. **Receipt and account vault** — More → Sync & data → Import / update receipts
   (`private-finance-current.local.json`).
3. **Manual state** — corrections, manual uses, preferences, theme. Local only.

Both transfer files are produced on the Mac:

```bash
node mac/export-device-accounts.js --db "$TRACKER_PRIVATE_DB" --output device-accounts.local.json
node mac/private-finance.js export --output private-finance-current.local.json
```

If a device shows masked emails, "Usage not checked", em-dash savings tiles or
zeroed averages, the private import is missing — the layout is fine and the
public data is being displayed. Do not "fix" the UI for that.

iOS Safari evicts website data after roughly seven days without a visit. That
will silently wipe theme, imports and manual state; the app then opens on
product defaults. Tell the owner to add the tracker to the Home Screen, and
expect to re-import after a long absence.

---

## 7. Design system — the rules that get enforced

- **Theme tokens only.** `test-theme-system.js` fails the build on hex or `rgba()`
  in the CSS files. Use `var(--color-*)` and `color-mix()`. A new literal colour
  needs a token first.
- **Hue-driven palette.** `theme-palette.js` derives everything from
  `DEFAULT_HUE` (currently **283**, purple). `basePaletteCss()` is inlined into
  `index.html` at build time, so the first paint is already themed.
  `appearance.js` migrates stored legacy defaults forward
  (`LEGACY_BLUE_COLOUR` → product default) so a browser that kept an old value
  still lands on the reference look.
- **Compact scale.** The reference is measured on a 440 pt-wide iPhone and the
  implementation targets 393 × 852. Sizes are literal px, not rem/vw, with
  `-webkit-text-size-adjust:100%`. Navigation is 66 px tall with a 12 px bottom
  gap. `reference-finish.css` holds the compact overrides for Home, the account
  card, offer terms and Accounts.
- **Anchors before edits.** Several regressions came from editing a block that
  matched in more than one place. Verify the anchor and make one atomic patch;
  the suites are not a substitute for reading the diff.
- **Assertions follow the design.** Where an old test contradicts an owner
  reference (wording, heights, chart hit areas), the test is updated with the
  design decision recorded in the commit message, not quietly loosened.

Reference screenshots the owner supplied live in the conversation attachments,
not the repo. Ask for them again if you need pixel measurements; they are the
authority for layout, and the accent in them is purple (`#d87dfc` at hue 283).

---

## 8. Tests

```bash
npm run validate        # 54 node scripts (52 in npm test) + public data + syntax
npm run test:browser    # 33 browser scripts (Playwright)
npm run test:browser    # with TRACKER_BROWSER_ENGINE=webkit / firefox
npm run build           # dist/ + cache-busted asset URLs
```

Both must be green before a merge; CI enforces them. Notes that save time:

- The browser suite serves `dist/`, so **run `npm run build` first**.
- `test-weekly-savings-browser.js` taps the real `.weekly-savings-hits rect`
  centres. The SVG box is wider than the hit rects; measuring the SVG geometry
  produces false failures.
- `test-compact-393-browser.js` asserts the compact Home fits without scrolling
  and that the stats card is within the fold.
- `test-theme-system.js` is the colour gate described above.
- `test-mail-owner-exclusions.js` and `test-mail-master-rules.js` encode the
  owner's 27 named exclusions and the master Mail rules. Treat them as the
  specification for Mail behaviour.
- `test-offer-reference-browser.js` is **stale**: it targets
  `.offer-preview-card`, which was removed when offer search was unified into
  Accounts. It is not part of `test:browser`, so it fails in isolation. Delete it
  or rewrite it against the current offers markup.
- There is no `timeout` binary on this Mac by default (`coreutils` not
  installed); use plain `node <test>` loops.

---

## 9. Mail behaviour (the fragile part)

Owner's expectations, encoded in the rules modules and tests:

- **Never Bin a login or security code**, in any language. `identity.js`
  `isProtectedSecurityEmail()` covers 13 languages; extend it rather than adding
  ad-hoc subject matches.
- Promo mail is grouped per campaign by `identity.js` `campaignTermKey()` so
  reminders do not restart an offer clock.
- Keep £10 / £12 / £15 off £15 and Uber Cash offers in the Inbox. Uber Cash
  counts as a promo; it only moves to Bin when no account can log in.
- Receipts are filed to the `Uber Receipts` mailbox after import.
- Non-Uber Mail goes to Amazon / Others — never Bin. That includes MFA and
  code emails from other providers.
- "Welcome to Uber / Uber Eats!" stays in the Inbox. Uber One welcome mail goes
  to Others.
- Expiry: use the stated window from the first email; with no stated window the
  expiry is **unknown**, not a 35-day guess. Expired with unknown usage is left
  for review; used/partly-used expired keeps one latest copy in Archive and
  Bins duplicates; confirmed-unused expired fixed offers are all Binned.
- Every movement is bounded, planned read-only first, reconciled against live
  message IDs, approved by digest, then executed and re-verified. Apple Mail
  renumbers IDs, so verification matches on subject + date + account, never on
  the ID alone. Bin is never emptied.

Mail runs are the one part of this project where a mistake is unrecoverable by
git. Always `--plan` first, always keep a copy, and never widen a run beyond the
approved digest.

---

## 10. Known open items at handover

UI, in the order they were being worked:

1. **Accounts third tab wording.** Live reads `Can't log in 22`; the owner's
   reference reads `Needs check 183`. These are different sets in the data, so
   this is a product decision (relabel vs. change the filter) before it is a
   code change. Do not relabel without changing the filter.
2. **Filter chip text.** `Offers 3 selected` in the build vs a shorter
   `3 selected` in the reference.
3. **Physical device verification.** All layout work was verified in Chromium
   at 393 × 852 with the private vault imported. It has not been re-checked on
   the owner's actual iPhone after the latest changes.
4. **Periods without recorded promo values** show an em-dash on Savings /
   Insights tiles. That is honest unknown, not zero — do not fill it.
5. **Account counts differ from the reference screenshots** (239 vs 236, 36 vs
   26 ready) because the snapshot gained accounts after the references were
   captured. Data, not layout.

Operational:

6. `test-offer-reference-browser.js` stale (see §8).
7. The owner must re-import the two private transfer files after any iOS storage
   eviction, and should add the tracker to the Home Screen to slow it down.

---

## 11. First hour on this project

1. `git clone`, `npm ci --ignore-scripts`, `npm run validate` (no private data
   needed for unit tests).
2. Get the private inventory from the outgoing developer (§12). Without it you
   can run the app against public data, but not the Mail pipeline.
3. `npm run build`, serve `dist/` (`npx http-server dist -p 5173`), open at
   393 × 852 and click through Home, Accounts, Account details, Savings,
   Insights, Finances, More, Sync & data. Also `node mac/` tools only run on
   macOS with Mail automation permission — see §5.1.
4. Read `README.md` end to end once. It is the product specification, and most
   "bugs" reported later are described there as intended behaviour.
5. Before touching Mail: run `bash mac/preview-sync.sh` and confirm it is
   read-only, and keep the three safety flags true.

---

## 12. What to transfer, what to revoke

Transfer directly, never through git (details and paths:
`HANDOVER-PRIVATE.local.md`):

- the owner-only SQLite database(s) and the authoritative account access CSV
- `tracker.local.env`
- the `*.local.*` helper scripts used for Mail review, publishing and deploys
- the two device transfer files, if the owner wants a known-good import
- the conversation attachments with the reference screenshots

The outgoing developer should keep no live access: revoke their GitHub
collaboration and any personal access tokens they created. Nothing else is
stored off the Mac — there are no cloud services, API keys or third-party
accounts in this project.

Questions the owner will ask, and the answers:

- *"Why does my phone look different?"* — either a cached old asset (hard reload
  / re-add), lost storage (re-import), or genuinely a layout change; check the
  served asset `?v=` hash against `dist/`.
- *"Why is Usage not checked?"* — the private import is missing on that device.
- *"Why is my total lower?"* — public snapshots exclude receipts with unknown
  amounts; the vault import restores them.
