# Uber Promo Tracker

A small automated dashboard for ranking Uber and Uber Eats promotions.

## Current architecture

`Apple Mail on Mac → local email export → parser.js → processor.js → generate-promos.js → promos.json → GitHub Pages`

The public site reads only `promos.json`. Raw email bodies stay on the Mac in `emails.local.json`, which is ignored by Git.

## What already works

- Detects Uber / Uber Eats promo emails.
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
