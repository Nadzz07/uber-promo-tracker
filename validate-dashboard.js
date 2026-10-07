import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync("index.html", "utf8");

const moduleMatch = html.match(/<script type="module">([\s\S]*?)<\/script>/);
assert.ok(moduleMatch, "dashboard module script must exist");

const scriptBody = moduleMatch[1].replace(
  /import\s*\{[\s\S]*?\}\s*from\s*["'][^"']+["'];\s*/g,
  ""
);

new Function(scriptBody);

assert.ok(
  html.includes("<title>Uber Eats Promo Tracker</title>"),
  "main product title should be Uber Eats Promo Tracker"
);

assert.ok(html.includes('data-view="home"'));
assert.ok(html.includes('data-view="accounts"'));
assert.ok(html.includes('data-view="used"'));
assert.ok(html.includes('data-view="more"'));

assert.ok(html.includes("Split settings"));
assert.ok(html.includes("Best move for this basket"));
assert.ok(html.includes("Tap the amount to edit"));
assert.ok(html.includes('step="0.01"'));
assert.ok(html.includes("Extra fee per extra order"));
assert.ok(html.includes("Maximum split orders"));
assert.ok(html.includes("data-max-orders"));
assert.ok(html.includes("[1,2,3,4].map"));
assert.ok(html.includes("Use this account"));
assert.ok(html.includes("account-status-badge"));
assert.ok(html.includes('id="sheetBackdrop"'));
assert.ok(html.includes("Used 1 order"));
assert.ok(html.includes("Undo manual use"));
assert.ok(html.includes("Mark fully used"));
assert.equal(html.includes("Mark account done"), false, "manual account-done control should stay retired");
assert.equal(html.includes("Accounts marked done"), false, "Used view should not duplicate promo completion with account-done status");
assert.equal(html.includes("Done accounts"), false, "Used summary should focus on promo activity");
assert.ok(html.includes("Multi-use"));
assert.ok(html.includes("Other available accounts"));
assert.ok(html.includes("Lifetime savings"));
assert.ok(html.includes("Overview"));
assert.ok(html.includes("Total accounts"));
assert.ok(html.includes("Promos available"));
assert.ok(html.includes("Accounts available"));
assert.ok(html.includes("Confirmed receipts"));
assert.ok(html.includes("Estimated missing Uber One"));
assert.ok(html.includes("How the Uber One estimate is calculated"));
assert.ok(html.includes("savings-hero"));
assert.ok(html.includes("grid-template-columns: auto minmax(0,1fr) 36px"));
assert.ok(html.includes("Archived accounts"));
assert.ok(html.includes("Needs checking"));
assert.ok(html.includes('id="needsCheckCount"'));
assert.ok(html.includes('id="needsCheckingList"'));

assert.ok(
  html.includes("backdrop-filter: blur"),
  "liquid-glass UI should retain blur/backdrop treatment"
);

assert.ok(
  /grid-template-columns:\s*repeat\(2/.test(html),
  "mobile equal-tile grid should exist"
);

assert.equal(
  /potential value/i.test(html),
  false,
  "potential value must stay out of the redesigned UI"
);

assert.equal(
  html.includes("data-promo-state"),
  false,
  "old inline Used/Ignore card controls should not return"
);

assert.equal(
  html.includes("data-basket="),
  false,
  "preset basket money buttons should stay removed"
);

assert.equal(
  html.includes("Find the best move."),
  false,
  "generic Find the best move heading should not compete with the product title"
);


const actionWiring = [
  ['data-view=', 'closest("[data-view]")'],
  ['data-intent=', 'closest("[data-intent]")'],
  ['data-account-filter=', 'closest("[data-account-filter]")'],
  ['data-open-sheet=', 'closest("[data-open-sheet]")'],
  ['data-account-offers=', 'closest("[data-account-offers]")'],
  ['data-restore-offer=', 'closest("[data-restore-offer]")'],
  ['data-unignore-offer=', 'closest("[data-unignore-offer]")'],
  ['data-use-this-account=', 'closest("[data-use-this-account]")'],
  ['data-max-orders=', 'closest("[data-max-orders]")'],
  ['data-use-one=', 'closest("[data-use-one]")'],
  ['data-undo-use=', 'closest("[data-undo-use]")'],
  ['data-toggle-ignore=', 'closest("[data-toggle-ignore]")'],
  ['data-mark-offer-done=', 'closest("[data-mark-offer-done]")'],
  ['data-show-more-accounts=', 'closest("[data-show-more-accounts]")'],
  ['data-jump-accounts=', 'closest("[data-jump-accounts]")']
];

for (const [controlMarker, handlerMarker] of actionWiring) {
  assert.ok(
    html.includes(controlMarker),
    `expected UI control marker ${controlMarker}`
  );
  assert.ok(
    html.includes(handlerMarker),
    `expected event wiring for ${controlMarker}`
  );
}

assert.ok(
  html.includes('event.target.id === "resetPlannerSettings"'),
  "automatic-defaults button must be wired"
);

assert.ok(
  html.includes('event.target.id === "sheetFeeInput"'),
  "split-fee input must update planner settings"
);

assert.ok(
  html.includes('event.target.id === "sheetLockedSearch"'),
  "inaccessible-account search must be wired"
);

for (const sheetType of ["advanced", "locked", "savings", "health", "history"]) {
  assert.ok(
    html.includes(`type === "${sheetType}"`),
    `sheet route ${sheetType} must render a real panel`
  );
}

assert.ok(
  html.includes("Receipt processing keeps full account and Mail data private, updates savings and usage history, and publishes only the masked data this app needs."),
  "sync-and-data sheet must explain the private-to-app data path"
);

assert.ok(html.includes("Waiting for first update"));
assert.ok(html.includes("Sync & data"));

assert.ok(
  html.includes("Chosen account"),
  "Use this account must create visible selected-account state"
);

const buttonOpenings = [...html.matchAll(/<button\b[^>]*>/g)].map(match => match[0]);
const deadButtons = buttonOpenings.filter(tag =>
  !/\bdata-[\w-]+=/.test(tag) &&
  !/\bid=/.test(tag) &&
  !/\bdisabled\b/.test(tag)
);

assert.deepEqual(
  deadButtons,
  [],
  "every visible button must have an explicit action marker, id handler, or be disabled"
);

console.log("✓ Release UI, savings, action wiring and sync-flow guard");
