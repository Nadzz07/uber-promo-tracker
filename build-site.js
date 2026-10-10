import fs from "node:fs";
import { createHash } from "node:crypto";
import { assertPublicSnapshot } from "./public-snapshot.js";
import { transformSync, version as minifierVersion } from "esbuild";
const payload = JSON.parse(fs.readFileSync("promos.json", "utf8"));
const history = JSON.parse(fs.readFileSync("history.json", "utf8"));
assertPublicSnapshot(payload, history);
const files = ["index.html", "promos.json", "history.json", "deal-intelligence.js", "manual-state.js", "offer-time.js", "offer-state.js", "account-state.js", "offer-details.js", "appearance.js", "device-accounts.js", "desktop-layout.css", "ui-refinements.css", "nav-gestures.js", "dashboard-data.js", "liquid-glass.js", "liquid-glass.css"];
fs.rmSync("dist", { recursive: true, force: true });
fs.mkdirSync("dist");
// Version the entire code bundle so a cached parent module cannot keep an
// obsolete dependency URL after a release. Browser-local imports remain intact.
const revision = createHash('sha256');
revision.update(fs.readFileSync(import.meta.filename)).update(minifierVersion);
for (const file of files.filter(file => /\.(?:html|js|css)$/.test(file))) revision.update(file).update(fs.readFileSync(file));
const assetVersion = revision.digest('hex').slice(0,12);
const versions = new Map(files.map(file => [file, assetVersion]));
const compact = (source, loader, module = false) => transformSync(source, {
  loader, target: ['safari15', 'chrome100', 'firefox100'],
  minifyWhitespace: true, minifySyntax: true, minifyIdentifiers: false,
  treeShaking: module, ...(module ? { format: 'esm' } : {}), legalComments: 'none'
}).code;
for (const file of files) {
  if (/\.(?:html|js|css)$/.test(file)) {
    let content = fs.readFileSync(file, 'utf8').replace(/(from\s+["']|(?:href|src)=["'])(\.\/)?([a-z-]+\.(?:js|css))(["'])/g,
      (match, prefix, relative, asset, quote) => versions.has(asset) ? prefix + (relative || '') + asset + '?v=' + versions.get(asset) + quote : match);
    if (file.endsWith('.html')) content = content
      .replace(/<style>([\s\S]*?)<\/style>/g, (_, css) => '<style>' + compact(css, 'css') + '</style>')
      .replace(/<script([^>]*)>([\s\S]*?)<\/script>/g, (_, attributes, js) => '<script' + attributes + '>' + compact(js, 'js', /type="module"/.test(attributes)) + '</script>');
    else content = compact(content, file.endsWith('.css') ? 'css' : 'js', file.endsWith('.js'));
    fs.writeFileSync('dist/' + file, content);
  } else fs.writeFileSync('dist/' + file, JSON.stringify(file === 'promos.json' ? payload : history));
}
fs.writeFileSync("dist/.nojekyll", "");
console.log("Built validated public site: " + files.length + " application files.");
