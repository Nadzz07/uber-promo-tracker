# Phone UI and source validation handoff

Branch: `fix/unfinished-cash-phone-ui`, based on release `6e677ba`.
Work uses a separate Mac clone. Original checkouts, private databases, access
lists, raw messages and prior validation copies remain preserved.

## Account and Cash views

- **Not finished** replaces “2+ orders left.” Accessible accounts stay visible
  while receipt progress is incomplete or a live offer remains. Four of five
  promo uses consumed leaves one use here. Unused accounts and expired offers
  on incomplete accounts remain visible. Receipt-complete accounts leave only
  when they have no usable offer left.
- Receipt completion still means five unique Eats receipts, or at least one
  Eats plus one ride/bike receipt. Offer consumption is separate. Cards/details
  explain progress and remaining offers. Home previews eight accounts and links
  to the full matching list.
- **Uber Cash** shows current recorded offers and Cash history, including
  receipt-complete accounts. An email amount is an offer value, not proof of
  today's wallet balance. Expired/history entries have explicit status.
- Cash + promo requires separate current offers on one accessible account. It
  does not promise stacking or add email values to confirmed receipt savings.
  Planner recommendations retain the existing Used/Archived eligibility rule.
- Policy deadlines say **Estimated end** and explain the 35-day tracking rule.
  Explicit earlier deadlines remain authoritative.

## Phone layout and appearance

The compact **Plan your order** card has an editable basket subtotal, clear
one-account result, wrapped full login email and separate offer/subtotal lines.
Savings are before delivery/service fees. Without receipt fee samples or a
manual fee estimate, unknown extra-order fees do not justify a split.

`ui-refinements.css` loads after desktop styles. Neutral dark surfaces and the
selected accent replace fixed green ambient tints on the background, cards,
navigation, sheets and progress. Warning colours retain their status meaning.
Appearance/layout preferences remain browser-local.

`nav-gestures.js` supports tapping or holding the bottom capsule, sliding a
finger across its tabs and releasing to select. It handles cancellation,
pointer capture and Safari compatibility clicks. Mouse/keyboard control,
reduced motion and desktop navigation remain supported.

Full addresses require **More → Login emails → Import private login emails** on
each device/browser. References and masks are checked; addresses wrap without
ellipses and remain searchable/copyable. Import, persistence and forgetting stay
local. No private mapping is uploaded. Updated sites preserve saved mappings,
preferences and manual marks for unchanged offer IDs. Marks against superseded
IDs remain stored but do not transfer to corrected offers; review affected
pending uses. CSS/JS assets and nested imports share a code digest to avoid
incompatible cached modules.

## Original-source corrections

Membership footers previously changed a primary food/ride coupon's service or
percentage value. Parsing now follows primary context and quantified terms.
Genuine membership trials remain separate. Unpriced marketing, unverified
membership eligibility, purchased/earned balances and future referral rewards
do not invent ready discounts.

Corrected fingerprints retain superseded rows privately. Incremental imports
preserve valid reminder clocks and cannot borrow from superseded or
different-service siblings. Complete-source reconstruction runs only after
every stored message is covered. It derives earliest dates/latest accepted
metadata from matching current fingerprints. Partial or missing-source imports
fail before reconstruction; the import transaction rolls back. A private
repair journal retains prior derived dates/pointers. Receipts, usage and
historical rows remain preserved.

The earlier UI release corrected 57 invalid large-count entries. Its 2,007
record snapshot is historical. Current public offers contain no unverified
96/26-use count or unpriced generic “Offer” title.

## Safe Mac verification and publication

Inspect existing checkouts and preserve local fixes first. Follow
[RELEASE.md](RELEASE.md), using a new clone and a backed-up private copy:

```bash
git clone --branch fix/unfinished-cash-phone-ui https://github.com/Nadzz07/uber-promo-tracker.git uber-tracker-followup-review
cd uber-tracker-followup-review
npm ci --ignore-scripts
node mac/validate-private-data.js --db "/absolute/path/to/verified-private.db" --access "/absolute/path/to/account-access.local.csv" --output-dir tracker-validation.local.new
```

Review complete-source coverage, original receipt evidence, family dates,
statuses and masked totals. Any unexplained discrepancy blocks publication.
Copy only validated `promos.json` and `history.json` to the release branch:

```bash
npm run validate
npx playwright install chromium webkit
npm run test:browser
TRACKER_BROWSER_ENGINE=webkit npm run test:browser
npm run build
```

Check the actual built snapshot in both engines at phone/desktop widths, with
private identity import tested locally without upload. Merge only after real
source validation and all CI pass. Pages deployment remains a guarded manual
workflow on clean main. Verify deployed bytes and live interactions.

## Evidence and remaining checks

The preserved 25,045 messages are reparsed on copied databases. All 147 Eats and
232 ride/bike receipts reconcile with original evidence. Confirmed savings
remain £3,382.60; Cash email values do not increase that total.

The date audit traced 154 inherited clocks, including 23 public Eats clocks, to
rejected/different-family donors. All 308 donor/corrected-first sources matched
original raw messages. Reconstruction corrects those clocks, keeps true earlier
reminders, and recovers 70 expired private membership families hidden by stale
source pointers.

The receipt ZIP has 567 physical messages. Mail displays 532; duplicate copies
explain why message counts exceed 379 unique receipts. The 106 review messages
remain backed up privately for separately authorized mailbox filing. This
follow-up does not move or delete Mail.

Browser checks cover held drags, native taps, Safari compatibility clicks,
theme persistence, layouts, identity privacy and account/Cash filtering.
Desktop WebKit cannot establish physical iPhone notch/installed-app behavior.
Fresh arrivals since the preserved scan and hourly automation still require
macOS Mail access and a successful read-only preview. Keep routing off; never
overwrite the original database or reset Git history to make checks pass.
