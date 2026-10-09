import fs from "node:fs";
import { createHash } from "node:crypto";
import { assertPublicSnapshot } from "./public-snapshot.js";
const payload = JSON.parse(fs.readFileSync("promos.json", "utf8"));
const history = JSON.parse(fs.readFileSync("history.json", "utf8"));
assertPublicSnapshot(payload, history);
const files = ["index.html", "promos.json", "history.json", "deal-intelligence.js", "manual-state.js", "offer-time.js", "offer-state.js", "account-state.js", "offer-details.js", "appearance.js", "device-accounts.js", "desktop-layout.css", "ui-refinements.css", "nav-gestures.js", "dashboard-data.js", "liquid-glass.js", "liquid-glass.css"];
fs.rmSync("dist", { recursive: true, force: true });
fs.mkdirSync("dist");
// Version the entire code bundle so a cached parent module cannot keep an
// obsolete dependency URL after a release. Browser-local imports remain intact.
const revision = createHash('sha256');
for (const file of files.filter(file => /\.(?:html|js|css)$/.test(file))) revision.update(file).update(fs.readFileSync(file));
const assetVersion = revision.digest('hex').slice(0,12);
const versions = new Map(files.map(file => [file, assetVersion]));
for (const file of files) {
  if (file.endsWith('.html') || file.endsWith('.js')) {
    const content = fs.readFileSync(file, 'utf8').replace(/(from\s+["']|(?:href|src)=["'])(\.\/)?([a-z-]+\.(?:js|css))(["'])/g,
      (match, prefix, relative, asset, quote) => versions.has(asset) ? prefix + (relative || '') + asset + '?v=' + versions.get(asset) + quote : match);
    fs.writeFileSync('dist/' + file, content);
  } else fs.copyFileSync(file, 'dist/' + file);
}
fs.writeFileSync("dist/.nojekyll", "");
console.log("Built validated public site: " + files.length + " application files.");
