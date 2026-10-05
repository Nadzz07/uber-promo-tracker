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
assert.ok(html.includes("Mark account done"));
assert.ok(html.includes("Multi-use"));
assert.ok(html.includes("Weaker usable accounts"));
assert.ok(html.includes("Total saved"));
assert.ok(html.includes("Can’t log in"));

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

console.log("✓ Round-3 home, split-settings and account-sheet guard");
