import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const html = fs.readFileSync("index.html", "utf8");
const promos = JSON.parse(fs.readFileSync("promos.json", "utf8"));
const history = JSON.parse(fs.readFileSync("history.json", "utf8"));

const bannedVisibleCopy = [
  "Demo preview",
  "Preview data",
  "Connect your Mac to replace this",
  "Tracker controls.",
  "No public promo history yet.",
  "Sanitised snapshot generation time",
  "Fine-tune how far the optimiser",
  "Loading your usable promos"
];

for (const phrase of bannedVisibleCopy) {
  assert.equal(
    html.includes(phrase),
    false,
    `release copy must not contain: ${phrase}`
  );
}

assert.equal(promos.demo === true, false, "public release data must not be marked demo");
assert.notEqual(promos.source, "demo", "public release source must not be demo");

const promoIds = Array.isArray(promos.promos)
  ? promos.promos.map(item => String(item.id || ""))
  : [];

const historyIds = Array.isArray(history.records)
  ? history.records.map(item => String(item.id || ""))
  : [];

assert.equal(
  [...promoIds, ...historyIds].some(id => id.startsWith("demo-")),
  false,
  "public release artifacts must not contain demo records"
);

if (!promos.generatedAt) {
  assert.equal(promos.configured, false, "empty release seed must identify first-sync state");
  assert.deepEqual(promos.accounts || [], [], "first-sync release seed must not contain fake accounts");
  assert.deepEqual(promos.promos || [], [], "first-sync release seed must not contain fake promos");
  assert.deepEqual(history.records || [], [], "first-sync release seed must not contain fake history");
}

assert.ok(
  html.includes('meta name="description"'),
  "release page should include a description"
);

assert.ok(
  html.includes('meta name="apple-mobile-web-app-capable"'),
  "release page should include mobile web-app metadata"
);

const readme = fs.readFileSync("README.md", "utf8");
for (const retired of ["Mark account done", "Accounts marked done", "Done accounts"]) {
  assert.equal(readme.includes(retired), false, "release docs must not restore retired account-done language: " + retired);
}
assert.ok(
  readme.includes("Archived / Can't log in") && readme.includes("Bin/Trash"),
  "release docs should describe recoverable Archived-account Mail routing"
);
assert.ok(
  fs.readFileSync("mac/common.sh", "utf8").includes("plan-inbox-routing.js"),
  "release sync should plan Mail routing after private import"
);
assert.ok(
  fs.readFileSync("mac/trash-archived-inbox.js", "utf8").includes("Mail.delete(message)"),
  "release sync should route Archived-account Mail to Bin without an erase command"
);

console.log("✓ Release copy and public seed guard");

const legacyConfig = fs.readFileSync("_config.yml", "utf8");
const publicFiles = new Set(["index.html", "promos.json", "history.json", "deal-intelligence.js", "manual-state.js", "offer-time.js", "offer-state.js", "account-state.js", "_config.yml"]);
const trackedRoots = new Set(execFileSync("git", ["ls-files"], { encoding: "utf8" }).trim().split("\n").map(path => path.split("/")[0]));
for (const name of trackedRoots) {
  if (name.startsWith(".") || publicFiles.has(name) || ["node_modules", "dist"].includes(name)) continue;
  assert.ok(legacyConfig.includes("  - " + name + "\n"), "Legacy Pages must exclude " + name);
}
console.log("✓ Legacy Pages excludes non-public repository files");
