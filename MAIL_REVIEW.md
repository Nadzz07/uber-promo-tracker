# Reviewed Mail management

Mail management runs only when the owner asks for it. The revised policy is in
`mail-review-rules.js`, shared by the existing cleanup classifier and the review
planner. Normal tracker refreshes do not move Mail. Do not install or reapprove
an automatic cleanup schedule as part of this workflow.

## Owner's rules

- Always leave login verification codes and phone-number changes where they are.
- Import and verify receipts first, then file them in the same Mail account's
  Uber Receipts folder. Missing or changed receipt facts require review first.
- For confirmed inaccessible accounts, immediately bin other Uber mail,
  including Eurostar and Cash promotions.
- For accessible accounts, leave Eurostar promotions where they are. Bin Ride
  promotions of any discount type, but never confuse them with Ride receipts.
- Keep usable preferred Eats offers: £10/£12/£15 off a £15 minimum, and Cash.
- For each reliably identified campaign: once fully used, retain the latest
  offer email in Archive and bin duplicates. Do the same for a partly used
  campaign once its exact expiry has passed. Bin all copies of a demonstrably
  unused expired campaign. Unknown usage/expiry never means zero/expired.
- Percentage Eats offers can be useful alongside same-account Cash with
  overlapping dates. This is not proof of checkout compatibility or joint use.
  Archive one latest source for each used campaign, with duplicates in Bin.
  If only Cash was used, do not infer percentage use; bin the unused percentage
  campaign after verified expiry. Keep uncertain cases for review.
- After receipt-supported promo completion, bin other non-excluded Uber mail.
  Lifetime account completion (five Eats, or Eats plus Ride) is not evidence
  that a particular promo is exhausted.
- A genuinely new usable preferred campaign can make an accessible account
  ready immediately, even before an older exhausted campaign expires. Existing
  readiness logic supports this; do not reset old usage or treat reminders as
  new campaigns based on discount amount alone.
- Bin is recoverable trash. Never empty it or delete tracker history.

## Preview, then approval

Use `mac/preview-mail-cleanup.js` read-only with `--managed-folders` as its third
argument. A missing date range means all historical received folders, including
Archive and promotional folders. Inventory Sent, Drafts and Bin, but do not
propose changes there. Compress original sources privately; never publish them.

`mac/prepare-mail-review.js` accepts `--capture`, `--out`, `--db`, `--accounts`,
`--finance`, and `--snapshot`. All paths must be explicit. It opens an existing
database read-only and requires its complete receipt projection to exactly match
the current private receipt transfer. It writes a compressed move plan and a
private report, without changing the tracker or Mail. An incomplete scan,
changing source or rule change invalidates the preview.

Show the owner destination counts, reasons, the full per-email move list and
the unresolved cases. Obtain approval for that exact report before invoking
`mac/execute-mail-cleanup.js` with its SHA-256 approval digest. Approval is not
inferred from an earlier request to implement the rules.

The executor verifies plan/report hashes, rules and all bound source files,
holds the existing tracker lock and rechecks each physical Mail source. Archive
retained offers before processing Bin duplicates. A duplicate cannot move until
the retained original is independently verified in the same-account Archive.
Each move is checked at its destination and recorded in a private audit. Stop
on any discrepancy. Source changes require a fresh preview and approval.

The current local database recovery is a separate task. Do not replace or
repair that database, regenerate public data, publish, or install a scheduler
while preparing this review. New/unverified receipts remain pending import.

## Later owner changes — 4 November 2026

These supersede earlier conflicting bullets: all Eurostar campaigns go to a same-account Eurostar mailbox, including messages currently in Bin. The explicitly named table/free-ride campaign and generic Uber advertising without a genuine account-level offer go to Bin immediately. Receipts, login codes and phone updates remain protected. For accessible accounts, current Eats percentage offers stay in Inbox even without Cash; source-confirmed expired percentage offers go to Bin regardless of whether a receipt used them. Unknown or estimated expiry stays unresolved. Missing roster membership does not imply inaccessible login. No automatic scheduler is added.

Keep one newest actual login-verification email per exact recipient; older copies go to recoverable Bin only after the retained original is rechecked. Promo-code messages are not login codes. Actual imported receipt keys and receipt parsers take precedence over every advert-cleanup category, including weekday trip subjects. Phone-number notices are held separately; restoration destinations require the owner's choice.

## Current all-Mail review — 6 November 2026

The owner's direct request to check and manage all Mail authorises applying the
established rules without another approval question for each previously agreed
category. It does not authorise emptying Bin, deleting unrelated personal mail,
or treating missing evidence as expired or zero.

General train, coach, Lumo and GWR advertising belongs in Bin. A Eurostar mention
in a footer is not enough to classify an email as a Eurostar campaign. Actual
Eurostar subjects or verified Eurostar senders go to Eurostar. The specifically
excluded merchant, grocery/product, flight and pickup campaigns also go to Bin.
Source-confirmed expired Eats percentage campaigns go to Bin; current eligible
ones remain in Inbox. Unknown or conflicting expiry is held for review.

The owner chose Inbox for the previously identified 44 phone updates. Those
restorations were verified. Preserve other phone notices where they are, including
the 92 unlisted addresses left in Bin. Retain one newest actual non-Bin login-code
email per exact recipient and same Mail account; recheck its raw original before
moving older copies. Preserve promo codes and receipts independently.

Restaurant discovery emails with menu prices and item-level shopping discounts
are generic advertising, even if the promo parser finds a percentage in them.
Check the original for personal redemption terms before applying that rule;
mixed messages with real personal offers remain protected. Avios cross-selling
and general Uber One free-trial/ride-loyalty adverts are also excluded marketing.
Membership payment failures, receipts and unknown account terms are not covered
by this advertising refinement.

## Owner resumed and extended cleanup — 7 November 2026

The owner withdrew the proposed correction and requested continued cleanup.
Bin £15 off £25 offer emails, preserving receipts and tracker history. Bin Eats
percentage-off order emails older than one calendar month based on their actual
source date, even if expiry is unknown or still future; record this as an age
rule, never as confirmed expiry. Newer active offers remain protected.

The named budget-friendly, delicious/mood, half-off-favourite-burger and 30%-off-
autumn-favourites adverts belong in Bin. General shopping deals/offers are also
excluded. Actual receipts, login codes, phone changes and genuine personal offers
inside otherwise generic discovery messages retain their existing protections.

The owner also requested Amazon mail in a same-account Amazon mailbox and other
non-Uber received mail in Others. This is filing only: preserve message contents,
protect tracker receipts and metadata, keep genuine Eurostar separately, and do
not pull messages back from Bin or move Sent/Drafts. Inspect actual sender
addresses and relay forms rather than trusting an Amazon display name alone.

The generic-advert cleanup also recognises Courier parcel-service promotions,
paid Uber One signup advertisements, product-only Co-op snack campaigns, and
NHS eligibility invitations that promise later codes rather than supplying a
personal redeemable code. These classifications still run after receipt and
identity protections. Clearly worded old percentage-off meal/order headlines
can meet the age rule even when the parser marks their scope uncertain; newer
personal offers with unclear expiry remain held rather than assumed expired.

For subsequent Amazon/Others filing, use the shared pure rules in
`mail-filing-rules.js`; the private per-run classifier files are frozen evidence.
Amazon includes Prime Video and Amazon-branded delivery notifications from the
encoded DPD sender. A matching Amazon display name on an unrelated sender alone
is insufficient. The completed run's older private classification is preserved;
nine messages were independently corrected and verified in Amazon afterwards.

## Login confirmation during every owner-requested Mail check — 7 November 2026

For each genuine receipt, compare its verified full recipient with the current
private account roster before adding or classifying the account. Collect genuinely
new or unresolved receipt-linked accounts and ask the owner in this Codex chat in
manageable batches, using each full email address. Ask only the missing fields:
login access (Can log in / Can’t log in / Not confirmed), and login method
(iCloud / Google / Both / Not confirmed). A domain does not confirm a method.
Preserve existing confirmations and imported access-list evidence; do not ask
about already-confirmed fields again. An affirmative batch answer applies only
to the named batch. Save each answer against its stable account identity with
field-specific `codex_chat` provenance and the actual confirmation time. Carry
confirmed changes through the private export and sanitised public projection;
never put full addresses or confirmation records in repository files or logs.
Outside an active chat, retain unresolved fields as pending for the next review.
The website cannot initiate a chat. Do not archive or mark an account ready merely
because its login details are missing. Preserve its receipts and offers.
