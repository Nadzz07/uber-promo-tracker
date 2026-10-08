import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// VACUUM INTO creates a consistent snapshot including committed WAL data.
// The source opens read-only; no checkpoint, deletion or schema change occurs.
export function backupPrivateDb(source) {
  if (source === ':memory:' || !fs.existsSync(source)) return null;
  const destination = source + '.backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + process.pid;
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    const escaped = destination.replaceAll("'", "''");
    db.exec("VACUUM INTO '" + escaped + "'");
    fs.chmodSync(destination, 0o600);
  } finally { db.close(); }
  return destination;
}
