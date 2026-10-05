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

The Home headline is **Estimated saved**. The tracker keeps a separate confirmed receipt total and only adds a conservative missing-Uber-One estimate when there is enough evidence.

Confirmed receipt saving uses the larger of (a) explicit saving components such as Promotion, Uber Cash and an explicit Uber One saving, or (b) Uber's own “You saved £X”/total-savings line. This prevents double-counting when the receipt prints both a total and its components.

If a receipt mentions Uber One but omits the Uber One amount, the tracker may estimate that missing amount from the median of the user's own receipts that explicitly state an Uber One saving. With fewer than three explicit samples the estimate is discounted, each estimated order is capped conservatively, and receipts where Uber already reports extra saving do not get another estimate added. If there is no usable evidence, the estimate stays at zero rather than inventing a number.

Savings insights expose the confirmed total, estimated missing Uber One, promo discounts, Uber Cash, explicit Uber One savings, the estimate sample size and the estimated total separately.

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

- **Home** — basket optimiser, quick categories and best usable accounts
- **Accounts** — searchable accounts you can actually log into
- **Used** — partial usage, fully used offers, done accounts, expired offers and ignored offers
- **More** — inaccessible accounts, savings insights, scan/data health and history

Inaccessible accounts are deliberately hidden from the normal ordering flow.

The UI uses a dark liquid-glass treatment with translucent panels, blur, equal-size quick tiles, compact phone spacing and a floating glass navigation bar. “Potential value” is intentionally not shown. Account cards instead focus on what the account saves on the current basket, remaining uses and expiry.

Basket-splitting controls are hidden behind **Split settings**. The normal Home view uses a clearly editable pounds-and-pence subtotal and shows the recommended order/account split. Split settings explain the estimated extra fee per additional order and use large 1–4 order controls rather than exposing technical planner fields on Home.


## Manual multi-use state

The browser supports immediate usage adjustments before the next receipt scan.

For a promotion such as:

`£12 off £15 on 5 orders`

if one receipt-confirmed use already exists, the UI shows:

`1 of 5 used · 4 left`

Tapping **Used 1 order** creates one pending manual use, so the UI immediately shows 3 left. When a later receipt confirms that same use, the pending adjustment is reconciled instead of being counted a second time.

Offer controls live inside the account's **View offers** bottom sheet rather than on the main account cards:

- **Used 1 order**
- **Undo manual use**
- **Mark fully used**
- **Ignore offer / Restore offer**

A partially used multi-use offer remains active and eligible for recommendations until its effective remaining uses reach zero or the offer expires.

**Mark account done** is separate from individual offer usage. It removes that account from active account lists and optimiser recommendations on that browser without deleting its history. The Used screen allows the account to be restored.

Receipt-confirmed state remains the durable private truth in SQLite; browser manual state is an immediate convenience layer that reconciles as receipt evidence catches up.

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

- promo folders: `INBOX`
- promo lookback: 60 days
- receipt folder: `Uber Receipts`
- normal receipt lookback: 90 days
- historical receipt depth: 3650 days
- historical backfill chunk: 180 days

Multiple promo folders are supported with a pipe-separated value, for example:

```bash
APPLE_MAIL_PROMO_FOLDERS="INBOX|Uber High Promos|Uber Cash"
```

Messages found in more than one configured folder are deduplicated before import.

The normal updater deliberately keeps receipt scanning recent. Apple Mail's `whose` queries can time out on large mailboxes, so the exporter bulk-reads lightweight mailbox metadata, filters the requested date window locally, and opens full message content only for matching Uber messages. It never falls back to the old per-message full-mailbox crawl.

Historical receipts are imported separately in bounded chunks and accumulated in the private SQLite database.

If your Mail folder has a different name:

```bash
cp tracker.example.env tracker.local.env
```

Edit `tracker.local.env` and set the exact mailbox name(s) shown by:

```bash
osascript -l JavaScript mac/list-mailboxes.js
```

`tracker.local.env` is private and Git-ignored.

### Private preview sync

Before the first publish, run:

```bash
bash mac/preview-sync.sh
```

This is fail-fast: if Mail export fails, no parser/import/move step runs afterward. It updates the private SQLite database, can file confirmed Inbox receipts, and writes public-output previews only to a temporary directory. It does **not** commit or push anything.

### Run a private preview first

Before the first publish, use the fail-fast private preview:

```bash
bash mac/preview-sync.sh
```

It exports recent Mail, validates the JSON, runs the full tests, updates only the private SQLite database, and optionally files confirmed Inbox receipts. It does **not** commit or push the public JSON.

### Run a live scan

After the private preview looks correct:

```bash
bash mac/update-promos.sh
```

The updater:

1. pulls the repo
2. exports recent Uber messages from the configured Mail folders using bulk metadata indexing
3. runs the full tests
4. updates the private SQLite store
5. recognises Uber Eats receipts found in `INBOX`
6. optionally files those already-imported receipts into `Uber Receipts`
7. generates sanitised `promos.json` and `history.json`
8. commits/pushes only those public files when they changed

Receipt messages found in `INBOX` contribute to account/order/savings statistics in the same run before any optional move happens. The Mail move is only filing; SQLite is the durable tracker state.

To enable Inbox filing:

```bash
APPLE_MAIL_MOVE_INBOX_RECEIPTS=true
```

in `tracker.local.env`.

The updater does not mark Mail messages as read.

### Historical receipt backfill

After the first normal sync works, import older receipt history in bounded chunks:

```bash
bash mac/backfill-receipts.sh
```

The default backfill covers up to 3650 days in 180-day chunks. Each chunk is idempotently merged into the private SQLite database, so rerunning after an interruption is safe. The script does not push to GitHub by itself; run the normal updater afterward when you are ready to publish the refreshed sanitised snapshot.

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
- receipt parsing, reported-savings and conservative Uber One estimation tests
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

The public site ships in a clean first-sync state with no synthetic accounts or savings totals. The first successful Mac sync replaces that empty state with the sanitised live snapshot.

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

- Apple Mail date-filter and move behaviour is validated by CI for syntax but still requires live validation on the actual Mac.
- Receipt wording varies; the parser is conservative and ambiguous promo matches do not automatically consume an offer.
- Restaurant/item/location eligibility cannot be proven from email text alone.
- Manual Used/Ignore choices are browser-local; receipt-confirmed state is durable in SQLite.
- The public site is intentionally a sanitised view, not a place to reveal full account aliases or promo codes.
