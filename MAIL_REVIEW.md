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
  offer email in Inbox and archive older copies. Do the same for a partly used
  campaign once its exact expiry has passed. Bin all copies of a demonstrably
  unused expired campaign. Unknown usage/expiry never means zero/expired.
- Percentage Eats offers can be useful alongside same-account Cash with
  overlapping dates. This is not proof of checkout compatibility or joint use.
  Keep the latest used-campaign source in Inbox and older copies in Archive.
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

## Broader exclusions and questions — 8 November 2026

Apply the owner's categories proactively, rather than only remembering titles.
Bin grocery/supermarket offers, named-shop or local-shop-only deals, Uber One and
Member Days promotional offers/credit-earning adverts, seasonal Diwali/Bonfire/
Halloween advertising, courier/airport/work-trip/feature advertisements, generic
discovery and re-engagement, the named terms/cancellation/wait-time notices,
£8 off £25, and discounts requiring two qualifying £15 orders first. Preserve
receipts, actual billing/credit records, protected codes and phone changes ahead
of advertising rules. Bin unrewarded surveys; keep explicitly rewarded surveys.
Flag unclear incentive promises and prize draws and ask before moving them.

The owner explicitly confirmed KEEP for “£12 off 5 orders is still yours to
enjoy. 🍛 🍝” (£12 off £15) and “Get 40% off your next 5 orders”, including their
selected-restaurant restriction. This generic restriction is not a named-shop
advert. Apply that distinction to similar genuine personal offers. Preserve their
recorded terms and history. Show Selected restaurants in Account details → More
terms. Prioritize unrestricted offers over otherwise usable selected-restaurant
offers; keep restricted choices available. Missing restriction data is unknown,
not proof of unrestricted eligibility.

On every requested Mail check, flag genuinely ambiguous decisions and ask in chat
using the email TITLE and a brief explanation, in small batches. Leave them
untouched until answered. Save category decisions to avoid repeated questions.
Continue asking full addresses and only missing login fields for genuinely new
receipt-linked accounts. No automatic cleanup scheduler is authorized.


### Owner clarification — 8 November: expired offers with unknown usage

Keep the latest email for each expired personal offer in Archive and move only
its duplicates to Bin. This does not establish that an offer was unused, used
or completed. Preserve recorded usage and original source evidence. Campaign
groups must include the exact account, offer terms and explicit validity window;
reused codes with different expiry dates are not duplicates. An unmatched offer
requires source-confirmed expiry and discount/minimum-spend terms before applying
this rule. Unknown or estimated expiry remains held. Earlier explicit exclusions
(such as expired percentage promotions, grocery or merchant-only advertising)
continue to take precedence.

The receipt-linked account reviewed in this batch is confirmed able to log in
through iCloud only. Full address and field-level chat provenance stay in the
private confirmation audit and account transfer, not this public policy file.


### Further owner clarification — 8 November: all inaccessible-account offers

Every Uber offer email for an account explicitly confirmed as unable to log in
goes to recoverable Bin, including Uber Cash, fixed discounts, percentage offers
and Uber-issued travel offers. This takes precedence over offer-retention rules
and the earlier routing of Uber-issued Eurostar ads. Missing roster membership
is not evidence of inaccessible login. Actual receipts, credited-balance/payment
records, login codes and phone-number changes remain protected. No balance,
receipt, usage or monetary total is deleted by binning an advertisement.

The source-reviewed generic teen signup/grocery reward, ride-app download and
customisation ads, named-shop deals starting with The, Save £X at named retailers,
Co-op shopping discovery and reordering menus follow the existing advertising
exclusions. Genuine personal order-level terms embedded in a discovery template
remain protected.

For Mail decisions only, consult preserved field-level access confirmations for
older unlisted accounts too. A historical false value must have imported
access-list or explicit chat provenance, a nonpending status, and a recorded time;
the database access state must agree. A default false flag or omission from the
current roster is insufficient. Current roster confirmations take precedence.
This evidence never adds an account back to the tracker or changes its counts.
New receipt-linked identities are still checked against the current roster.

The owner subsequently chose to leave emails titled ‘Your Disney+ promo code is
on its way’ in Inbox for now. Keep this explicit benefit exception until the
owner changes it; it is not a reason to keep other membership advertising.


## Latest owner correction — used campaign emails

For a receipt-confirmed fully used campaign, keep its latest promo email in Inbox
and archive every older promo email from that same campaign. Apply exactly the
same routing to a partly used campaign after its confirmed expiry. Do not bin
those older emails. Preserve the actual matched count: two of three remains two
of three, expired; do not invent a third use. Confirmed-unused expired campaigns
still go entirely to Bin. Separate campaigns stay separate by account, terms,
maximum uses and validity window. A matching discount amount alone is insufficient.
This supersedes earlier used-campaign latest-in-Archive/duplicates-in-Bin wording.
Unknown usage is not proof of unused status. Receipts and other safeguards remain.

## Owner clarification — 9 November

Bin “Browse new deals”. Keep “Dig in to up to £15 off” and “24 hours until your £ Uber voucher expires ⏳” while their personal-offer terms are uncertain. This does not confirm expiry, usage or balance, and does not make an inaccessible account usable.

### Generic ride advertising, 10 November 2026

“Tackle your to-do list with Uber”, when its original confirms the trusted-ride / busy-days advertising template, belongs in Bin. It is transport advertising, not a personal Eats or Cash benefit. Receipt and transaction protections still take precedence.

### 11 November follow-up

Reviewed the past 24 hours against the current rules. Three messages moved to Bin, two Amazon messages to Amazon, and one other message to Others. Independent location verification covered all 30,775 scanned originals: six moved, 30,769 untouched, and all six destinations verified. No permanent deletion. No new receipts or receipt-linked account identities were found.

The owner explicitly asked to keep the ten uncertain Cash/personal-offer reminders in Inbox for now. These are held, not treated as expired or silently discarded. A reminder is scheduled for 12 November at 18:00. Source-exact eligible campaigns from the earlier scan were reconciled separately without changing receipt totals or inventing usage.
