import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync("index.html", "utf8");

const moduleMatch = html.match(/<script type="module">([\s\S]*?)<\/script>/);
assert.ok(moduleMatch, "dashboard module script must exist");

const scriptBody = moduleMatch[1].replace(
  /import\s*\{[\s\S]*?\}\s*from\s*["'][^"']+["'];/,
  ""
);

new Function(scriptBody);

assert.ok(html.includes('data-view="deals"'));
assert.ok(html.includes('data-view="accounts"'));
assert.ok(html.includes('data-view="used"'));
assert.ok(html.includes('data-view="menu"'));
assert.ok(html.includes("Can’t access"));
assert.ok(html.includes("Total saved"));
assert.ok(html.includes("Weaker usable accounts"));
assert.equal(/potential value/i.test(html), false, "potential value must stay out of the redesigned UI");
assert.ok(/grid-template-columns:\s*repeat\(2/.test(html), "mobile equal-tile grid should exist");

console.log("✓ Mobile dashboard syntax and layout guard");
