# Uber Eats Promo Tracker

A private, account-aware Uber Eats promotion intelligence system built around one practical question:

**Which email/account should I use for this order, and should I split the basket across multiple accounts?**

The Mac does the private work. GitHub Pages only receives a sanitised snapshot for the phone/desktop dashboard.

## Architecture

```text
Apple Mail on Mac
  ├─ promo mailbox / Inbox
  └─ Uber Receipts mailbox
          ↓
Mail exporter
          ↓
Parser v2
  ├─ sender analysis
  ├─ offer classification
  ├─ discount/minimum-spend/code extraction
  ├─ exact / estimated / unknown expiry
  └─ evidence + confidence
          ↓
uber-tracker.local.db          ← PRIVATE, Git-ignored
  ├─ accounts + can-login state
  ├─ Mail messages/evidence
  ├─ durable offers/history
  ├─ receipts
  └─ receipt-to-offer matches
          ↓
receipt usage + savings intelligence
          ↓
sanitiser
          ↓
promos.json + history.json     ← PUBLIC safe projection only
          ↓
GitHub Pages mobile-first dashboard
```

## Privacy model

Private on the Mac:

- full Hide My Email / recipient aliases
- actual promo codes
- raw Uber message bodies
- parser evidence snippets
- receipt merchant/order details
- account login-access list
- the private SQLite database
- legacy database content

Public JSON contains only safe derived information such as:

- masked account email, e.g. `na…07@icloud.com`
- internal anonymous account ref
- whether that masked account is usable for recommendations
- discount/minimum-spend/expiry fields
- remaining-use state
- aggregate receipt savings/order counts
- aggregate fee estimate

Never commit `uber-tracker.local.db`, `emails.local.json`, access lists, legacy DBs, `.env` files or raw Mail exports.

## Account identity and login access

The **recipient email is the Uber Eats account identity**.

Each newly discovered recipient alias is automatically added to the private account registry. There are only two login states:

- **Can log in**
- **Can't log in**

Newly discovered accounts default to **Can't log in**. This is deliberate: the basket optimiser must never recommend an account that has not been confirmed usable.

The public UI shows the masked email. Internal refs such as `A001` are join keys and are not the normal user-facing identity.

### Import an access list

CSV format:

```csv
email,can_login
alias-one@icloud.com,true
alias-two@icloud.com,false
```

Then:

```bash
node mac/import-account-access.js account-access.local.csv --reset
```

If you only have the list of accounts you **can** log into, create a text file containing one email per line:

```text
alias-one@icloud.com
alias-three@icloud.com
```

Then run:

```bash
node mac/import-account-access.js accessible-accounts.local.txt --reset
```

`--reset` first marks every known account inaccessible, then applies the file. Future newly discovered accounts again default to inaccessible until added to your list.

## Parser v2

The parser is split into distinct stages under `parser-v2/` rather than growing one giant regex file:

- `sender.js` — Uber domain, Apple relay shape and display-name fallback
- `classifier.js` — Uber Eats / ride / Uber One / unwanted-category classification
- `discount.js` — fixed, percentage, Uber Cash, caps, uses, minimum spend and code
- `expiry.js` — expiry extraction and evidence
- `parser.js` — structured result assembly
- `utils.js` — normalisation/date/evidence utilities

Structured offer types include:

- `uber_cash`
- `fixed_order_discount`
- `multi_order_discount`
- `percentage_discount`
- `ride_fixed_discount`
- `ride_percentage_discount`
- `reminder`
- `non_promo`

Ride classifications are retained privately for correct parsing, but the public tracker publishes **Uber Eats only**.

### Expiry model

Expiry is intentionally one of:

- **exact** — explicit terms such as “Expires 20 Mar 2026 12:00AM”
- **estimated** — wording such as “valid for 14 days” where the starting point is reliably the email date
- **unknown** — no expiry is stated, or wording depends on an unknown account-activation date

For account-activation wording such as “valid for 35 days since it was applied to the account”, the parser deliberately leaves expiry unknown.

The rule is:

> correct + unknown is better than incorrect + precise.

Private evidence stores the source wording that justified extracted fields.

## Deterministic current/history logic

Bulk Mail reprocessing must not make an older email overwrite a newer one.

Every parsed message stores its sent date. Durable offers track `first_sent_at` and `last_sent_at`, and newer source emails update the canonical offer record deterministically.

Repeated reminder emails for the same offer family use a stable offer fingerprint that does **not** change merely because an updated reminder contains a different expiry date.

## Receipts and savings

Receipts are a separate evidence source, not promo emails.

The receipt parser extracts, when present:

- subtotal
- Promotion discount
- delivery fee
- service fee
- small-order fee
- tip
- Uber Cash / credits used
- final total
- order ID
- order date
- recipient account

Receipt evidence can:

- confirm that an account has been used
- confirm a specific promo when the amount uniquely matches
- decrement multi-use offers
- mark single-use offers used
- estimate the real extra cost of splitting baskets
- build lifetime savings/order statistics

Chronology is enforced: a receipt from before a promo email cannot consume that later promo.

Lifetime **Total saved** currently means observed receipt Promotion discounts plus observed Uber Cash/credits used. These are also shown separately in Savings insights.

## Basket optimiser

The dashboard can optimise a planned basket across up to four accounts/orders.

It:

- considers **only accounts marked Can log in**
- enforces minimum spend
- applies percentage caps
- handles fixed discounts and Uber Cash
- assumes one tracked account promo per order
- subtracts an estimated extra-order fee
- maximises net saving
- prefers fewer orders when net saving ties
- prefers earlier expiry when two offers save the same amount
- excludes receipt-confirmed used and manually Used/Ignore offers

The extra-order fee is prefilled from observed receipt delivery/service/small-order fees when available and can be overridden.

## Dashboard

The site is mobile-first because the primary use is while ordering food.

Main navigation:

- **Deals** — basket optimiser, quick categories and best usable accounts
- **Accounts** — searchable accounts you can actually log into
- **Used** — receipt-confirmed/manual used and ignored promos
- **Menu** — inaccessible accounts, savings insights, scan/data health and history

Inaccessible accounts are deliberately hidden from the normal ordering flow.

The UI uses softer charcoal surfaces rather than pure OLED black, equal-size quick tiles, compact phone spacing, and “saving on this basket” instead of “potential value”.

## Mac setup

Requires **Node.js 22 or newer** because the private store uses Node's built-in SQLite API.

From the GitHub repo folder:

```bash
bash mac/setup-v2.sh
```

This:

1. verifies Node 22+
2. creates/opens `uber-tracker.local.db`
3. prints the Apple Mail mailbox names visible to scripting

Apple may ask permission for Terminal/osascript to control Mail. Allow it.

### Configure the receipt mailbox

The default assumptions are:

- promo folder: `INBOX`
- promo lookback: 60 days
- receipt folder: `Uber Receipts`
- receipt lookback: 3650 days

If your Mail folder has a different name:

```bash
cp tracker.example.env tracker.local.env
```

Edit `tracker.local.env` and set the exact mailbox name shown by:

```bash
osascript -l JavaScript mac/list-mailboxes.js
```

`tracker.local.env` is private and Git-ignored.

### Run a live scan

```bash
bash mac/update-promos.sh
```

The updater:

1. pulls the repo
2. exports current Uber messages from the configured Mail folders
3. runs the full tests
4. updates the private SQLite store
5. generates sanitised `promos.json` and `history.json`
6. commits/pushes only those public files when they changed

It does not mark Mail messages as read.

### Hourly automation

After the manual update succeeds:

```bash
bash mac/install-automation.sh
```

This installs an hourly LaunchAgent and preserves a usable Node/Git/Homebrew PATH.

Logs:

```text
~/Library/Logs/UberPromoTracker/output.log
~/Library/Logs/UberPromoTracker/error.log
```

## Safe legacy Python/SQLite import

The old Python project remains separate and must not be modified during v2 development.

The v2 importer opens a legacy SQLite database **read-only** and copies accepted historical rows into the new private DB.

Use the old **test DB first**, not the old live DB:

```bash
OLD_PROJECT="$HOME/Library/Mobile Documents/com~apple~CloudDocs/Uber Promo Tracker/uber_promo_tracker"

node mac/import-legacy-db.js \
  "$OLD_PROJECT/uber_promo_tracker.db.ride-test.db" \
  uber-tracker.local.db
```

Legacy-only rows are marked historical and stay private. They do not become current public offers until a live Apple Mail scan observes the corresponding offer/account.

The old database is never written to.

## Tests

Run:

```bash
npm test
```

The suite includes:

- original parser/account/history regression tests
- parser v2 expiry/classification/evidence cases
- SQLite account/access/history tests
- receipt parsing and savings tests
- accessibility-gated basket splitting
- end-to-end synthetic Mail → SQLite → receipt → public JSON generation
- public privacy checks
- mobile dashboard syntax/layout guards

CI also syntax-checks the generator and Mac Mail exporter.

## Public site

GitHub Pages:

```text
https://nadzz07.github.io/uber-promo-tracker/
```

Until the first live Mac scan after setup, the repository contains clearly marked synthetic demo data.

## Files that must stay private

The repository ignores:

- `uber-tracker.local.db*`
- `emails.local.json`
- `account-access.local.csv`
- `accessible-accounts.local.txt`
- `tracker.local.env`
- old `*.db` / `*.db.*` files
- `.env*`
- raw `*.eml`
- Python virtual environments and caches

Do not force-add these files.

## Current limitations

- Real Apple Mail folder naming/JXA behaviour still needs to be validated on the actual Mac.
- Receipt wording varies; the parser is conservative and ambiguous promo matches do not automatically consume an offer.
- Restaurant/item/location eligibility cannot be proven from email text alone.
- Manual Used/Ignore choices are browser-local; receipt-confirmed state is durable in SQLite.
- The public site is intentionally a sanitised view, not a place to reveal full account aliases or promo codes.
