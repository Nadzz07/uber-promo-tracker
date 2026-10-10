import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Hash the ingestion dependency graph, including exporter changes. Appearance
// and build-only changes must not download unchanged private Mail bodies again.
export function parserFingerprint(root = import.meta.dirname) {
  const hash = createHash('sha256');
  const sources = new Map();
  function visit(name) {
    if (sources.has(name)) return;
    const source = fs.readFileSync(path.join(root, name), 'utf8');
    sources.set(name, source);
    for (const match of source.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)["'](\.[^"']+)["']/g)) {
      visit(path.normalize(path.join(path.dirname(name), match[1])));
    }
  }
  for (const name of ['generate-promos.js', 'mac/export-uber-mail.js', 'mac/export-known-messages.js', 'mac/find-inbox-receipts.js']) visit(name);
  for (const name of [...sources.keys()].sort()) hash.update(name).update(sources.get(name));
  return hash.digest('hex');
}

export function mailEvidenceKey(messageId, alias) {
  return JSON.stringify([String(messageId || '').trim().replace(/^<|>$/g, '').toLowerCase(), String(alias || '').trim().toLowerCase()]);
}
