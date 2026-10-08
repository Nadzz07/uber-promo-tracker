Account availability currently reflects login access rather than lifetime receipt use, unknown offer expiry leaks into account status, and expired offers appear as Fully used. Receipt discovery also leaves an Inbox gap between the 35-day promo scan and the 90-day historical backfill boundary. This repair separates the states, corrects receipt/savings processing and makes the release depend on private Mac verification.

Implemented:

- Receipt-confirmed account use requires five unique Eats receipts, or at least one Eats and one ride/bike receipt (including Lime). Access, account use and offer use remain separate. Used and Archived accounts are excluded from recommendations.
- Offer expiry uses the earlier explicit deadline or 35 days from the first observed offer email, clearly labelled as a policy estimate. Reminders do not reset it. Invalid/missing source dates remain reviewable; expiry never confirms a use.
- An unmatched discount no longer marks unrelated offers ambiguous. A usable offer prevents another reviewable offer from labelling the whole account Needs checking.
- Sender/domain and iCloud relay matching, direct Lime receipts, original account To headers, forwarded dates, updated receipt totals and durable identities are corrected. Deleted accounts have private tombstones; reclassified untrusted evidence is excluded without erasing its stored history.
- Confirmed financial components reconcile against reported savings. Plain Uber Cash payments are separate from explicitly promotional cash savings. Confirmed ride/bike savings contribute to lifetime, recent and account totals; the Eats Uber One estimate is never transferred to rides.
- Dashboard counters derive from underlying records, distinguish expired from exhausted offers and show confirmed savings separately from estimates. Status/search/filter regressions preserve mobile/desktop styling, animation and keyboard controls.
- Preview never routes Mail. Existing move/trash configs cannot override the default read-only safety switch. Optional routing requires matching committed evidence. Routine Inbox discovery covers the full receipt window and deduplicates overlapping exports.
- Consistent owner-only backups include committed WAL data. A private validation command reparses a copy twice, reconciles counts/sums, preserves the original and blocks on missing source evidence. Full same-source reparsing corrects stale financial extractions while sparse duplicate copies preserve facts.
- Pages pushes validate without deploying. Manual deployment on main requires explicit real-data confirmation and a regenerated policy-version snapshot.

Validation performed in Linux cloud with Node 24 and system Chromium:

- `npm run validate`: parser, SQLite, integration, offer state, Mail routing simulations, manual usage, audit, MBOX, public privacy/consistency and JS/shell syntax.
- 15 new finalisation regression groups, plus expanded browser regressions for counters, used-account eligibility, filters/search and confirmed-vs-estimated money.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:browser`: mobile/desktop widths, recommendations, receipt/manual reconciliation, focus, partial network failure and retry.
- `npm run build`: public allowlist build. Workflow YAML parsed. `git diff --check`.

Release restrictions:

- No real private Mac DB or Apple Mail is attached to the cloud. Existing `promos.json`/`history.json` remain unchanged. No Mail move, trash, erase, publication, merge or deployment was performed.
- Real receipt coverage, known account examples and original financial evidence must be validated locally using `RELEASE.md` before merge/deployment. No synthetic test result substitutes for that evidence.
- The cloud network policy blocks GitHub API and live Pages access; remote PR/check/deployment verification may need the local VS Code session.
- Earlier deletions without tombstones rely on the authoritative private access list. A 35-day policy estimate cannot prove the original activation date. Uber Cash funding cannot be inferred from a balance payment.

See `RELEASE.md` for a safe separate-clone Mac procedure that preserves existing uncommitted code and the original DB, then publishes only the two sanitised files after verification. Keep this PR unmerged until real-data validation and required remote checks pass.
