# Uber Promo Tracker

A small automated dashboard for ranking Uber and Uber Eats promotions.

## Current architecture

`Apple Mail on Mac → local email export → parser.js → processor.js → generate-promos.js → promos.json → GitHub Pages`

The public site reads only `promos.json`. Raw email bodies are intended to stay on the Mac and are ignored by Git through `emails.local.json`.

## What already works

- Detects Uber / Uber Eats promo emails.
- Ignores normal Uber receipts.
- Extracts percentage or fixed discounts, minimum spend, promo codes and expiry dates.
- Understands multi-use offers such as “40% off your next 5 trips, up to £10 per trip”.
- Calculates total potential saving for per-use caps.
- Removes duplicate promos and expired promos.
- Ranks the most valuable promo first.
- GitHub Pages dashboard loads promo data automatically.
- GitHub Actions runs the automated tests on every code change.

## Local commands

```bash
npm test
npm run generate -- emails.local.json promos.json
```

Use `emails.example.json` only as synthetic test data. Do not put real email contents in the public repository.

## Next Mac step

Connect Apple Mail to a local exporter that creates `emails.local.json`, run the generator, then publish only the sanitised `promos.json`.
