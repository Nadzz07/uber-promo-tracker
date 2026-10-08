import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { openPrivateDb, ensureAccount, upsertMessage } from './private-db.js';
import { parserFingerprint, mailEvidenceKey } from './parser-fingerprint.js';

const ctx = vm.createContext({ ObjC: { import() {} } });
vm.runInContext(fs.readFileSync('mac/export-uber-mail.js', 'utf8').replace(/^#!.*\n/, ''), ctx);
ctx.stderr = () => {};
const date = '2026-10-07T10:00:00.000Z';
let reads = 0;
const message = { id: () => 44, content: () => { reads++; return 'Total £10'; }, source: () => { throw Error('Unnecessary raw download'); } };
const collection = {
  id: () => [44], dateReceived: () => [date], dateSent: () => [date],
  subject: () => ['Your Uber receipt'], sender: () => ['receipts@uber.com'],
  messageId: () => ['native@uber.com'], toRecipients: { address: () => [['alpha@example.invalid']] },
  byId: id => { assert.equal(id, 44); return message; },
  0: { id: () => 55 } // A new Inbox row would make an index-based lookup wrong.
};
const box = { messages: collection };
const scan = known => ctx.scanMailbox(box, 'receipt', 90, 0, 'INBOX', '2026-10-08T12:00:00Z', known);
assert.equal(scan({}).length, 1); assert.equal(reads, 1);
const key = mailEvidenceKey('<native@uber.com>', 'alpha@example.invalid');
assert.equal(scan({ [key]: date }).length, 0); assert.equal(reads, 1, 'Committed unchanged evidence avoids body downloads');
assert.equal(scan({ [key]: '2026-10-06T10:00:00Z' }).length, 1, 'A changed delivery date must be reread');
collection.toRecipients.address = () => [['alpha@example.invalid', 'beta@example.invalid']];
assert.throws(() => scan({}), /Multiple recipient/);
collection.toRecipients.address = () => [['alpha@example.invalid']];
let idsCalls = 0; collection.id = () => ++idsCalls === 1 ? [44] : [55];
assert.throws(() => scan({}), /changed during indexing/);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tracker-mail-cache-'));
try {
  const file = path.join(tmp, 'private.db'); const db = openPrivateDb(file);
  const account = ensureAccount(db, { alias: 'alpha@example.invalid' });
  const stored = { messageKey: 'committed', messageId: '<native@uber.com>', accountRef: account.accountRef,
    kind: 'receipt', bodyText: 'Total £10', sender: 'receipts@uber.com', receivedAt: date, parsedAt: date };
  upsertMessage(db, stored);
  db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run('mail_parser_fingerprint', parserFingerprint());
  const read = env => JSON.parse(execFileSync(process.execPath, ['mac/export-known-messages.js', file], { encoding: 'utf8', env: { ...process.env, ...env } }));
  assert.equal(read()[key], date);
  db.exec('BEGIN IMMEDIATE'); upsertMessage(db, { ...stored, messageKey: 'uncommitted', messageId: '<uncommitted@uber.com>' });
  assert.equal(read()[mailEvidenceKey('uncommitted@uber.com', 'alpha@example.invalid')], undefined, 'Uncommitted evidence cannot be skipped');
  db.exec('ROLLBACK');
  assert.deepEqual(read({ TRACKER_FULL_RESCAN: 'true' }), {});
  db.prepare('UPDATE meta SET value=? WHERE key=?').run('old-parser-code', 'mail_parser_fingerprint');
  assert.deepEqual(read(), {}, 'A parser code change forces a reparse');
  db.close();
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log('✓ Incremental read-only Mail export: stable IDs, committed evidence, changed receipts and parser invalidation');
