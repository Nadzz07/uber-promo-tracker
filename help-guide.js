// Loaded only when Help & Guide is opened. Examples never read private identities.
export const guideSections = [
  {id:'accounts', title:'Account statuses', summary:'Login access, rotation and receipt usage are separate.', content:`
    <dl><dt>Total Accounts</dt><dd>Every account currently tracked, including archived, deactivated and pending accounts.</dd>
    <dt>Accessible</dt><dd>Accounts confirmed as usable for login. New accounts remain pending until access is confirmed.</dd>
    <dt>Can’t log in</dt><dd>Accounts that cannot currently be accessed. This is separate from whether you have used them.</dd>
    <dt>Archived</dt><dd>Accounts removed from active rotation. An archived account can still be accessible. Deactivated accounts stay archived and cannot log in.</dd>
    <dt>Available Offers</dt><dd>The number of accessible accounts in active rotation with at least one eligible current promotion. Expired, ignored and manually finished promotions are excluded. Another eligible offer on the same account can still qualify.</dd>
    <dt>Fully used accounts</dt><dd>Accounts with at least one Eats receipt and one Ride receipt, or at least five Eats receipts. These counts use unique receipts. Lime journeys count as Rides. Fully used accounts can still be Accessible and have an Available Offer; usage does not automatically archive them.</dd></dl>`},
  {id:'promotions', title:'Promotion statuses', summary:'Confirmed redemption is different from expiry or a manual decision.', content:`
    <dl><dt>Available</dt><dd>An eligible promotion with uses remaining. Zero confirmed uses means it has not started.</dd>
    <dt>Partially used</dt><dd>Some uses are receipt-confirmed, but the promotion remains valid and more uses remain.</dd>
    <dt>Completed · Verified</dt><dd>Every permitted use has been confirmed: 5/5 or 3/3, for example. This counts as a Completed promotion.</dd>
    <dt>Finished · Expired</dt><dd>The promotion expired after some confirmed usage. An expired 2/5 remains 2/5; it is finished but not fully redeemed.</dd>
    <dt>Expired · Unused</dt><dd>The promotion expired with no confirmed usage. It does not count as a completed promotion or make an account fully used.</dd>
    <dt>Manually finished · Unverified</dt><dd>You marked it finished. It leaves recommendations while the tracker continues checking new evidence. The confirmed count is preserved.</dd>
    <dt>Ignored</dt><dd>You intentionally excluded the offer from recommendations. Restore it in its details if you change your mind.</dd>
    <dt>Needs checking</dt><dd>Terms or evidence are incomplete, ambiguous or conflicting. The tracker does not guess a redemption.</dd></dl>
    <p>Each promotion has one primary Activity bucket. Historical facts, such as a manual action or expiry, remain visible in its details. Fully used accounts and Completed promotions count different things and should not be added together.</p>`},
  {id:'expiry', title:'The 35-day expiry rule', summary:'The first qualifying email starts the clock; reminders cannot restart it.', content:`
    <p>Offers end at the earlier of their stated expiry and 35 elapsed days after the first observed qualifying offer email. Reminder emails do not restart that window.</p>
    <p>A date calculated from the 35-day rule is labelled estimated: check activation and expiry in Uber. Missing or uncertain dates need checking. Countdown dates use UK time.</p>
    <p>Expiry removes that offer from Available Offers. It never creates a receipt or turns unused orders into confirmed redemptions. If another current eligible promotion exists on the account, that account can still qualify.</p>`},
  {id:'verification', title:'Manual completion & automatic verification', summary:'A manual decision is remembered while reliable receipts update the evidence.', content:`
    <p>Example: a promotion gives £15 off each of five orders.</p>
    <ol><li>The tracker confirms 2/5 uses.</li><li>You mark the promotion finished manually.</li><li>It becomes Manually finished · Unverified and leaves recommendations, still showing 2/5.</li><li>New receipts later reliably confirm all 5/5 redemptions.</li><li>On the next successful data refresh, it automatically becomes Completed · Verified. Its original manual action remains in history.</li></ol>
    <p>If only 3/5 uses are confirmed, it remains manually finished and unverified. A normal Eats receipt alone does not prove that a particular offer was redeemed. Ambiguous matches are left for review.</p>
    <p>Open Verification &amp; history in an offer to see its confirmed count, manual decision, latest evidence update and completion history. Undo manual finish restores the offer’s appropriate status without deleting receipts; an expired or verified completed offer remains closed.</p>
    <p>If confirmed counts decrease or offer terms change, the decision is preserved with Needs checking. Review the original evidence before accepting the updated confirmed count. Ambiguous receipt matches require corrected source evidence.</p>
    <p>Manual actions are private to this browser on this device. Keep browser storage if you want to retain that history. Mail sync publishes safe evidence counts; your browser reconciles its saved decisions when those counts refresh. While open, the app checks for updated snapshots at most every five minutes; background tabs stay idle.</p>`},
  {id:'savings', title:'Understanding savings', summary:'Confirmed discounts, Cash payments and estimates mean different things.', content:`
    <dl><dt>Confirmed promotional discounts</dt><dd>Discounts supported by receipts, including Eats and Rides. A saving can be confirmed even when the exact promotional offer cannot be identified.</dd>
    <dt>Uber Cash payments</dt><dd>Money paid from a wallet balance. Spending purchased or existing Uber Cash is not automatically a saving. Only an explicitly supported promotional Cash saving can count.</dd>
    <dt>Explicit Uber One savings</dt><dd>Membership savings separately stated on a receipt. Combined discounts are not added a second time.</dd>
    <dt>Estimated Uber One savings</dt><dd>A separate estimate for a missing membership benefit, only when receipt evidence supports it. If there is insufficient evidence, the app explains that the estimate is unavailable. An unavailable estimate does not mean you received no benefit.</dd>
    <dt>Total confirmed savings</dt><dd>Receipt-backed savings across all tracked accounts, including historical archived accounts. Reported totals are reconciled with their components rather than double-counted. Unsupported estimates are not presented as confirmed savings.</dd></dl>`},
  {id:'sync', title:'Mail sync & privacy', summary:'Routine hourly sync reads qualifying messages and preserves your Mail.', content:`
    <p>The tracker reads qualifying Uber emails from configured Apple Mail sources, deduplicates receipts, separates Eats and Rides, and includes Lime under Rides. It recalculates account usage, current promotions and savings while preserving historical evidence.</p>
    <p>Incremental sync skips unchanged messages. Changed messages or parser rules are reprocessed. Genuinely new receipt accounts are checked against the private registry, deactivation history and exclusions. Their login type is requested and access remains pending until confirmed; they cannot inflate Accessible or Available Offers.</p>
    <p>Routine hourly read-only syncs do not move or delete messages. A separately authorised filing operation can move processed receipts into the existing Uber Receipts mailbox, verifying each destination copy. Unrelated mail stays untouched.</p>
    <p>The status near the header describes the last successful import, not a continuous Uber feed. Up to date means a recent successful scan; Update due means the last scan is overdue; Syncing requires an actual running sync; Attention means a failure. The successful update time is shown nearby in UK time.</p>
    <p>Full emails, raw receipts, promo codes, private databases and login files remain private. Public builds contain masked account references and safe derived totals. Full login emails can be imported locally on your device without being uploaded.</p>`},
  {id:'faq', title:'Frequently asked questions', summary:'Quick answers to the distinctions that matter.', content:`
    <dl><dt>Why might 117 accounts be Fully used but 0 promotions completed?</dt><dd>Fully used accounts follow the Eats + Ride or five Eats rule. Completed promotions require proof of every permitted redemption. These example counts can change as new verified evidence arrives.</dd>
    <dt>Can an Archived account still be Accessible?</dt><dd>Yes. Archive status and login access are independent.</dd>
    <dt>Does one Eats receipt make an account Fully used?</dt><dd>No. It needs an Eats receipt plus a Ride receipt, or at least five Eats receipts.</dd>
    <dt>Does an expired promotion count as completed?</dt><dd>Only if every use is confirmed. Expired · Unused means no confirmed usage; Finished · Expired means some usage before expiry. Neither alone proves full redemption.</dd>
    <dt>What happens when I manually finish a promotion?</dt><dd>It leaves active recommendations, but reliable new evidence can verify completion later. Your manual action remains in history.</dd>
    <dt>Can a Fully used account still have an Available Offer?</dt><dd>Yes, if it is accessible, in active rotation and has an eligible current offer. Account usage and promotion eligibility are separate.</dd></dl>`}
];
