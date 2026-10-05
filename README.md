# Uber Eats Promo Tracker

An automated, account-aware Uber Eats promo finder designed to answer one question quickly: which account should be used for an order?

## Current architecture

`Apple Mail on Mac → local email export → parser.js → processor.js → generate-promos.js → promos.json → GitHub Pages`

The public site reads only `promos.json`. Raw email bodies stay on the Mac in `emails.local.json`, which is ignored by Git.

## What already works

- Publishes Uber Eats promos only; ride and Uber One offers are excluded from the public tracker.
- Ignores normal Uber receipts.
- Extracts percentage or fixed discounts, minimum spend, promo codes and expiry dates.
- Understands multi-use offers such as “40% off your next 5 trips, up to £10 per trip”.
- Calculates total potential saving for per-use caps.
- Removes duplicate and expired promos.
- Ranks the most valuable promo first.
- GitHub Pages dashboard loads `promos.json` automatically.
- GitHub Actions tests the promo engine on every code change.
- Mac scripts are included to read matching messages from Apple Mail, generate promo data, and publish changes.

## Tests

```bash
npm test
```

## Generate promos locally

The generator defaults to private local input:

```bash
npm run generate -- emails.local.json promos.json
```

`emails.example.json` contains synthetic examples only. Never commit real mailbox exports.

## Mac setup

Once this repository is cloned on the Mac:

1. Open Mail and make sure iCloud Mail is signed in and synced.
2. Run:
   ```bash
   bash mac/update-promos.sh
   ```
3. macOS may ask permission for Terminal/osascript to control Mail. Allow it.
4. Confirm `promos.json` is updated and pushed.
5. To run the same update automatically every hour:
   ```bash
   bash mac/install-automation.sh
   ```

The exporter looks back 45 days and only reads messages whose sender or subject contains “Uber”. Raw message data remains local; the public repository receives only the parsed promo fields.

## Public site

GitHub Pages serves the dashboard from the `main` branch. While real Mail data is not yet connected, `promos.json` is clearly marked as demo data.


## Legacy Mac project review

The earlier Mac project was reviewed and its useful ideas have been folded into this version without publishing its private database or configuration.

Useful behaviours now carried forward include:

- validating a real Uber sender when Mail provides sender data
- recognising Apple's Uber relay sender shape
- parsing Uber Cash offers
- handling “first N orders” multi-use offers
- handling both “minimum spend £15” and “£15 minimum spend”
- keeping activation-based expiry wording unknown instead of inventing an expiry date

The older project also contained a SQLite history model and account-alias matching. That idea is now implemented in the new tracker without exposing the actual aliases.

## Anonymous account matching

Apple Mail recipient addresses are used locally to keep offers from different Uber accounts separate. The real aliases stay only in the Git-ignored `accounts.local.json` file. Public promo data uses stable anonymous labels such as `A001`, `A002`, etc.

The tracker treats same-account offers as related context only. It does **not** assume they can be combined or stacked unless the offer terms explicitly say so.


## Anonymous multi-account support

The legacy Mac database showed that the tracker needs to treat recipient aliases as separate Uber accounts.

The current version now:

- reads the recipient address locally from Apple Mail when available
- deduplicates identical promos **within** an account, not across different accounts
- detects related fixed/Uber Cash offers only on the same account
- stores the real alias only in `accounts.local.json` on the Mac
- assigns stable anonymous labels such as `A001`, `A002`, etc.
- publishes only those anonymous labels to `promos.json` and `history.json`
- lets the public dashboard filter offers by anonymous account

`accounts.local.json` is ignored by Git and must remain private.


## Legacy SQLite migration

The old Python/SQLite tracker can be imported **locally on the Mac** without publishing the old database or its account aliases.

The migration uses a two-tier history model:

- `history.local.json` — full private history used by the tracker; Git-ignored
- `history.json` — public dashboard projection containing only offers observed by the new live scanner

The temporary SQLite export contains only the legacy account alias, normalised discount/minimum-spend/expiry fields, and a boolean indicating whether a code existed. It does **not** export old senders, message IDs, subjects, or actual promo codes, and it is deleted when the migration finishes.

Run on the Mac:

```bash
bash mac/migrate-legacy-db.sh "/path/to/uber_promo_tracker.db"
```

Then scan current Apple Mail and publish current data:

```bash
bash mac/update-promos.sh
```

Legacy-only records stay private. If the new live scanner later sees the same offer/account again, the public history can show that offer under its anonymous account label while still keeping the real alias private.


## Spend-specific deal intelligence

The dashboard can compare active Uber Eats promos against a planned order amount such as £15, £25 or £40.

For a single transaction it:

- rejects promos whose minimum spend is not met
- calculates percentage savings from the planned spend
- applies the per-use or maximum saving cap
- treats fixed discounts as the saving for that one use
- treats Uber Cash as nominal cash value up to the transaction amount
- does **not** multiply a multi-use promo by all future uses when deciding what saves the most right now
- can filter the recommendation by service and anonymous account

The OLED dashboard is account-first: Best deal, £15 off £15, Uber Cash, and Multiple promos. A basket helper then recommends the best account for a planned order total.


## Receipt intelligence and basket splitting

The tracker now treats Uber Eats receipt emails as a separate private evidence source instead of letting receipt text pass through the promo parser.

Private receipt flow:

`Apple Mail → receipt parser → receipts.local.json → account matching → promo-use evidence → sanitised account insights`

`receipts.local.json` is Git-ignored. It retains parsed receipt evidence locally so usage history survives beyond the 45-day Apple Mail lookback.

When a receipt contains a Promotion amount, the tracker compares that amount against eligible promos on the same recipient-email account. It only marks a promo as receipt-confirmed used when the match is sufficiently unique. Ambiguous matches do not consume an offer automatically.

For multi-use offers, confirmed receipts decrement `usesRemaining` rather than deleting the whole promotion after the first use.

The public payload receives only sanitised derived fields such as masked account identity, remaining uses, receipt-confirmed state, aggregate order count, aggregate observed promo savings, and an aggregate fee estimate. Raw receipts, full account aliases, merchant details, individual basket values and actual promo codes remain private.

### Account identity

The recipient email remains the real private account identity. The public dashboard shows a masked form such as `na…07@icloud.com`; the anonymous `A001` reference remains the internal join key.

### Manual Used / Ignore

The dashboard also supports manual `Used`, `Ignore`, `Undo`, and `Mark account done` actions. These choices are stored in browser `localStorage` only and are excluded from recommendations and basket plans on that browser. Receipt-confirmed usage cannot be undone from the public page.

### Basket optimiser

The optimiser can split a planned basket across multiple Uber Eats accounts. It assumes one tracked account promo per order, evaluates minimum spends and caps, and subtracts an estimated incremental fee for each added order.

The fee input is prefilled from the aggregate delivery + service + small-order fees observed in private receipts when enough parsed data exists. It can always be overridden manually.

The optimiser maximises net saving first and prefers fewer orders when the saving is tied. It uses at most one order per account in a plan, which keeps recommendations practical and avoids pretending multiple account promos can be stacked on one checkout.

The plan is advisory: restaurant-specific offers, item eligibility, geographic restrictions and live checkout conditions can still change the final result.
