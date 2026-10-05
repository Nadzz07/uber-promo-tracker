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

assert.ok(html.includes("Advanced split settings"));
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

console.log("✓ Liquid-glass mobile app syntax and layout guard");
