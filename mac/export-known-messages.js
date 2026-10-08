#!/usr/bin/env node
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { parserFingerprint, mailEvidenceKey } from '../parser-fingerprint.js';
const file = process.argv[2];
let known = {};
if (file && fs.existsSync(file) && process.env.TRACKER_FULL_RESCAN !== 'true') {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const fingerprint = db.prepare("SELECT value FROM meta WHERE key = 'mail_parser_fingerprint'").get()?.value;
    if (fingerprint === parserFingerprint()) {
      for (const row of db.prepare(`SELECT m.message_id, a.alias, m.received_at FROM messages m
        JOIN accounts a ON a.account_ref = m.account_ref
        WHERE m.message_id IS NOT NULL AND m.body_text IS NOT NULL`).all()) {
        known[mailEvidenceKey(row.message_id, row.alias)] = row.received_at;
      }
    }
  } finally { db.close(); }
}
process.stdout.write(JSON.stringify(known));
