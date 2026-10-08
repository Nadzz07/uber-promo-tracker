# Liquid glass UI and offer-count repair — local Codex handoff

Branch: `fix/liquid-glass-ui`. Based on `4d5d1fc` (the Mac session's fully
reconciled receipt-charge snapshot), preserving the transport-charge and desktop
savings fixes already merged in PRs #33 and #34. Neither public JSON file is
changed by this branch. This cloud is Linux with no Mac database or Apple Mail.

## Changes to pick up

- Follow-up layout redesign: More → Appearance → Layout now offers Auto, Mobile
  and Desktop, saved per browser. Auto changes at 980px; forced Mobile stays a
  centred phone layout (up to 480px) even on a computer. Forced Desktop adapts
  down to phone widths without horizontal scrolling. Switching preserves current
  view, manual usage, filters, account mappings, theme and financial data.
- Desktop now has its own `desktop-layout.css`: compact header with horizontal
  glass navigation, three equal summary cards, a two-column planner/discovery
  workspace, account grids and a six-card settings grid. The old sidebar and
  oversized Home panel are removed. Keep this stylesheet separate from phone
  styling; the public allowlist includes it.
- The repeated More kicker/title are replaced by one “Settings & tools” heading;
  More appears once in navigation. Phone Home geometry was compared to the previous
  branch version and remained identical.

- Clear header: explicit stacking, safe-area spacing, no text glow/blur, and an
  11px high-contrast update timestamp. Title/timestamp geometry is tested.
- Phone navigation: a compact glass capsule, 14px side margins, 8px above the
  bottom safe area. Neutral dark active lens, specular borders, spectral rim
  while dragging, spring settling, click/drag and keyboard navigation. Desktop
  uses a horizontal header capsule. Reduced motion and opaque fallback work. This is web CSS
  glass; iPhone Safari still needs an on-device check.
- More → Appearance: draggable colour wheel, keyboard controls, exact colour
  picker, brightness, presets/reset. Accent text, highlights and ambient light
  follow the selected colour. Saved per browser, brightened for readability when
  needed. Warning colours keep their status meaning.
- More → Login emails: full private aliases imported by account reference,
  displayed without ellipses in lists/planner/details, searchable and copyable
  in details. References, masks and addresses are checked. No network upload;
  browser local storage only. Forget removes the saved copy. Public JSON stays
  masked. The read-only Mac exporter creates an owner-only ignored file.
- Removed the thin recommendation border. Desktop privacy copy now sits below
  the dashboard, avoiding a blank grid row above it.
- Without receipt fee samples or a manual estimate, the planner stays at one
  order and says savings are before delivery/service fees. Unknown costs no
  longer imply known zero-cost extra orders.

## Why “96 orders” needs a local reparse

The current snapshot has 55 offers with 96 uses and two with 26. The old regex
could match the last two digits of an unrelated number before “orders,” including
1996/2026, without requiring offer wording. The fix reads the entire count and
requires explicit next/first/on/off/valid-for wording. It never blindly replaces
96 with five; genuine explicit larger counts remain supported.

Legacy counts above ten lack an explicit-count marker and stay out of
recommendations until original messages are reparsed. Their titles explain the
uncertainty, and manual “Used 1 order” is disabled while their count needs review.
Normal five-use offers continue working. New public projections carry only the
boolean `usesVerified`; original terms and snippets remain private.

Corrected terms change the offer fingerprint. The importer retains the old row
as `parser_superseded` private evidence and publishes its corrected replacement.
It preserves the earlier first-offer date for the 35-day rule. It deletes no
accounts, receipts or Mail messages. Code changes invalidate the incremental
scan cache. Manual uses against an old erroneous ID stay in browser storage but
are not silently transferred to another offer; review affected pending uses.

## Minimal safe Mac completion

Local Codex: inspect Git status, private paths and existing local fixes first.
Integrate without resetting/replacing the working checkout. If dirty, review this
branch in a separate clone outside it:

```bash
git clone --branch fix/liquid-glass-ui --single-branch https://github.com/Nadzz07/uber-promo-tracker.git uber-tracker-ui-review
cd uber-tracker-ui-review
npm ci --ignore-scripts
```

Use the authoritative existing access CSV and reconciled DB. Reparse a backed-up
COPY into a NEW directory (this leaves the source DB unchanged):

```bash
node mac/validate-private-data.js --db "/absolute/path/to/verified-private.db" --access "/absolute/path/to/account-access.local.csv" --output-dir tracker-validation.local.ui
```

Inspect the report and representative original offers: actual use counts,
earliest offer dates, no lost receipts, repeatability and receipt-backed savings.
Investigate any changed amounts against receipts. The cloud cannot establish
whether those 55 counts came from year text; raw messages must establish the
real counts. Missing evidence requires read-only export per RELEASE.md. No Mail
moving/trashing/deleting is authorised. Publish only when discrepancies are
resolved and private-source verification passes.

Export full aliases from the validated copy, without modifying it:

```bash
node mac/export-device-accounts.js --db tracker-validation.local.ui/verification.local.db --output device-accounts.local.json
```

It refuses to overwrite exports. Transfer this private file to your own phone,
for example via AirDrop. Choose More → Login emails → Import private login emails.
Details then has Copy login email. Import on each device/browser where needed;
there is no cross-device identity sync. Keep the file off Git and Pages.

After verification, copy ONLY the generated `promos.json` and `history.json` into
the clean release checkout, then:

```bash
npm run validate
npx playwright install chromium webkit
npm run test:browser
TRACKER_BROWSER_ENGINE=webkit npm run test:browser
npm run build
```

Review/commit the masked refresh and merge after all code/data checks pass. If the
PR has merged meanwhile, regenerate on latest clean main instead of restoring an
old snapshot. Publish with the guarded workflow described in RELEASE.md:

```bash
gh workflow run pages.yml --ref main -f private_data_verified=true
```

Check the Pages run and live site. In iPhone Safari and installed web app mode,
check notch clearance, timestamp contrast, capsule bottom position while
scrolling, dragging between tabs, long full emails/copy, colour changes/reload,
sheet scrolling and focus. Never restore an old DB or overwrite local fixes to
make checks pass.

## Cloud verification and limits

Full automated suite, privacy/consistency, syntax, build and expanded Chromium
flows pass. Seven new regression groups cover layout selection, count extraction, legacy uncertainty,
non-destructive fingerprint correction, colour contrast, identity validation and
read-only export permissions/source preservation. Browser coverage includes
320–1440px layouts, header geometry, nav drag/keyboard, private import/search/
copy/reload/forget with no upload, colour wheel/persistence, unknown fees, review
counts, focus, reduced motion and network failures. Layout tests also cover saved
overrides, Auto/resize, keyboard radio selection, forced Desktop at 320–1440px,
forced Mobile on a wide display, menu heading duplication and unchanged manual
usage/savings. Screens were visually checked
against the unchanged public snapshot. CI adds WebKit browser coverage and keeps
macOS/Linux Node 22/24 coverage.

Real-source reparse, private phone import and iPhone Safari checks need the local
session. This document and the PR communicate the changes to local Codex; cloud
cannot send instructions directly into a separate VS Code chat. No merge or
deployment follows from synthetic tests alone.
