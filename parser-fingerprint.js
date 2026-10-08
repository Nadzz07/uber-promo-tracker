import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// A code change invalidates the incremental Mail cache, including parser fixes
// that do not change the numeric parser version.
export function parserFingerprint() {
  const root = import.meta.dirname;
  const hash = createHash('sha256');
  for (const dir of ['', 'parser-v2']) {
    for (const name of fs.readdirSync(path.join(root, dir)).sort()) {
      if (!name.endsWith('.js') || name.includes('.local.') || /^(test-|validate-)/.test(name)) continue;
      hash.update(path.join(dir, name));
      hash.update(fs.readFileSync(path.join(root, dir, name)));
    }
  }
  return hash.digest('hex');
}

export function mailEvidenceKey(messageId, alias) {
  return JSON.stringify([String(messageId || '').trim().replace(/^<|>$/g, '').toLowerCase(), String(alias || '').trim().toLowerCase()]);
}
