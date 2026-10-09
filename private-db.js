import { dedupeReceipts } from "./receipt-identity.js";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import { maskAccountAlias } from "./account-map.js";
import { offerFingerprint } from "./identity.js";
import { estimateReceiptSavings, combinedReceiptSavings } from "./savings-intelligence.js";

export const PRIVATE_DB_SCHEMA_VERSION = 9;
export const DEFAULT_PRIVATE_DB = "./uber-tracker.local.db";

function normaliseAlias(value) {
  return String(value || "").trim().toLowerCase();
}

function getMeta(db, key) {
  return db.prepare("SELECT value FROM meta WHERE key = ?").get(key)?.value ?? null;
}

function setMeta(db, key, value) {
  db.prepare(
    "INSERT INTO meta(key, value) VALUES(?, ?) " +
    "ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, String(value));
}

function initSchema(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 10000;
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS deleted_accounts (alias_hash TEXT PRIMARY KEY);

    CREATE TABLE IF NOT EXISTS accounts (
      account_ref TEXT PRIMARY KEY,
      alias TEXT NOT NULL UNIQUE,
      masked TEXT,
      can_login INTEGER NOT NULL DEFAULT 1 CHECK (can_login IN (0,1)),
      login_method TEXT CHECK (login_method IN ('iCloud','Google','Both') OR login_method IS NULL),
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_promo_at TEXT,
      last_receipt_at TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      message_key TEXT PRIMARY KEY,
      message_id TEXT,
      account_ref TEXT,
      kind TEXT NOT NULL,
      mailbox TEXT,
      sender TEXT,
      subject TEXT,
      body_text TEXT,
      sent_at TEXT,
      received_at TEXT,
      parser_version INTEGER,
      classification TEXT,
      classification_confidence TEXT,
      accepted INTEGER NOT NULL DEFAULT 0,
      rejection_reason TEXT,
      evidence_json TEXT,
      parsed_at TEXT NOT NULL,
      FOREIGN KEY(account_ref) REFERENCES accounts(account_ref)
    );

    CREATE TABLE IF NOT EXISTS offers (
      offer_id TEXT PRIMARY KEY,
      account_ref TEXT NOT NULL,
      message_key TEXT,
      service TEXT,
      offer_type TEXT,
      title TEXT,
      discount_type TEXT,
      discount REAL,
      max_saving REAL,
      per_use_cap REAL,
      uses_total INTEGER NOT NULL DEFAULT 1,
      uses_remaining INTEGER NOT NULL DEFAULT 1,
      max_total_saving REAL,
      minimum_spend REAL NOT NULL DEFAULT 0,
      promo_code TEXT,
      expires TEXT,
      expires_at TEXT,
      expiry_status TEXT NOT NULL DEFAULT 'unknown',
      expiry_basis TEXT,
      expiry_confidence TEXT,
      classification_confidence TEXT,
      evidence_json TEXT,
      first_sent_at TEXT,
      last_sent_at TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'live_mail',
      observed_live INTEGER NOT NULL DEFAULT 1,
      receipt_state TEXT,
      receipt_confirmed_uses INTEGER NOT NULL DEFAULT 0,
      last_used_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      FOREIGN KEY(account_ref) REFERENCES accounts(account_ref)
    );

    CREATE TABLE IF NOT EXISTS receipts (
      receipt_id TEXT PRIMARY KEY,
      account_ref TEXT NOT NULL,
      message_key TEXT,
      sent_at TEXT,
      received_at TEXT,
      order_id TEXT,
      merchant TEXT,
      subtotal REAL,
      promotion_discount REAL,
      delivery_fee REAL,
      service_fee REAL,
      small_order_fee REAL,
      tip REAL,
      uber_cash_used REAL,
      uber_cash_savings REAL,
      reported_savings REAL,
      uber_one_savings REAL,
      uber_one_signal INTEGER NOT NULL DEFAULT 0,
      total REAL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      FOREIGN KEY(account_ref) REFERENCES accounts(account_ref)
    );

    CREATE TABLE IF NOT EXISTS transport_receipts (
      receipt_id TEXT PRIMARY KEY,
      account_ref TEXT NOT NULL,
      message_key TEXT,
      sent_at TEXT,
      received_at TEXT,
      trip_id TEXT,
      transport_mode TEXT,
      total REAL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      FOREIGN KEY(account_ref) REFERENCES accounts(account_ref)
    );

    CREATE TABLE IF NOT EXISTS receipt_offer_matches (
      receipt_id TEXT NOT NULL,
      offer_id TEXT,
      status TEXT NOT NULL,
      expected_saving REAL,
      observed_saving REAL,
      matched_at TEXT NOT NULL,
      PRIMARY KEY(receipt_id, offer_id, status),
      FOREIGN KEY(receipt_id) REFERENCES receipts(receipt_id),
      FOREIGN KEY(offer_id) REFERENCES offers(offer_id)
    );

    CREATE INDEX IF NOT EXISTS idx_offers_account ON offers(account_ref);
    CREATE INDEX IF NOT EXISTS idx_offers_status ON offers(status);
    CREATE INDEX IF NOT EXISTS idx_receipts_account ON receipts(account_ref);
    CREATE INDEX IF NOT EXISTS idx_transport_receipts_account ON transport_receipts(account_ref);
    CREATE INDEX IF NOT EXISTS idx_messages_sent ON messages(sent_at);
    CREATE INDEX IF NOT EXISTS idx_messages_account_mid
      ON messages(account_ref, lower(trim(message_id, '<> ')));
  `);


  const transportColumns = new Set(db.prepare('PRAGMA table_info(transport_receipts)').all().map(r => r.name));
  if (!transportColumns.has('trip_key')) db.exec('ALTER TABLE transport_receipts ADD COLUMN trip_key TEXT');
  for (const name of ['promotion_discount', 'uber_cash_used', 'uber_cash_savings', 'reported_savings', 'uber_one_savings']) {
    if (!transportColumns.has(name)) db.exec('ALTER TABLE transport_receipts ADD COLUMN ' + name + ' REAL');
  }
  const accountColumns = new Set(
    db.prepare("PRAGMA table_info(accounts)").all().map(row => row.name)
  );

  if (!accountColumns.has("login_method")) {
    db.exec("ALTER TABLE accounts ADD COLUMN login_method TEXT");
  }
  if (!accountColumns.has('account_status')) db.exec('ALTER TABLE accounts ADD COLUMN account_status TEXT');

  const receiptColumns = new Set(
    db.prepare("PRAGMA table_info(receipts)").all().map(row => row.name)
  );

  if (!receiptColumns.has("uber_cash_savings")) db.exec("ALTER TABLE receipts ADD COLUMN uber_cash_savings REAL");
  if (!receiptColumns.has("reported_savings")) {
    db.exec("ALTER TABLE receipts ADD COLUMN reported_savings REAL");
  }
  if (!receiptColumns.has("uber_one_savings")) {
    db.exec("ALTER TABLE receipts ADD COLUMN uber_one_savings REAL");
  }
  if (!receiptColumns.has("uber_one_signal")) {
    db.exec("ALTER TABLE receipts ADD COLUMN uber_one_signal INTEGER NOT NULL DEFAULT 0");
  }

  setMeta(db, "schema_version", PRIVATE_DB_SCHEMA_VERSION);

  if (getMeta(db, "next_account_number") == null) {
    setMeta(db, "next_account_number", 1);
  }
}

export function openPrivateDb(path = DEFAULT_PRIVATE_DB) {
  // Create owner-only before SQLite can create its WAL and shared-memory files.
  if (path !== ":memory:") {
    fs.closeSync(fs.openSync(path, "a", 0o600));
    fs.chmodSync(path, 0o600);
  }
  const db = new DatabaseSync(path);
  try { initSchema(db); } catch (error) { db.close(); throw error; }
  return db;
}

export function ensureAccount(
  db,
  {
    alias,
    seenAt = new Date().toISOString(),
    kind = null
  } = {}
) {
  const normalized = normaliseAlias(alias);
  if (!normalized) return null;
  if (db.prepare("SELECT 1 FROM deleted_accounts WHERE alias_hash = ?").get(createHash("sha256").update(normalized).digest("hex"))) return null;

  let row = db.prepare(
    "SELECT account_ref, alias, masked, can_login, login_method, first_seen_at, last_seen_at, " +
    "last_promo_at, last_receipt_at FROM accounts WHERE alias = ?"
  ).get(normalized);

  if (!row) {
    const next = Number(getMeta(db, "next_account_number") || 1);
    const ref = "A" + String(next).padStart(3, "0");
    const masked = maskAccountAlias(normalized);

    db.prepare(`
      INSERT INTO accounts(
        account_ref, alias, masked, can_login,
        first_seen_at, last_seen_at, last_promo_at, last_receipt_at
      ) VALUES(?, ?, ?, 1, ?, ?, ?, ?)
    `).run(
      ref,
      normalized,
      masked,
      seenAt,
      seenAt,
      kind === "promo" ? seenAt : null,
      kind === "receipt" ? seenAt : null
    );

    setMeta(db, "next_account_number", next + 1);
  } else {
    db.prepare(`
      UPDATE accounts
      SET
        masked = COALESCE(masked, ?),
        last_seen_at = CASE
          WHEN last_seen_at IS NULL OR ? > last_seen_at THEN ?
          ELSE last_seen_at
        END,
        last_promo_at = CASE
          WHEN ? = 'promo' AND (last_promo_at IS NULL OR ? > last_promo_at) THEN ?
          ELSE last_promo_at
        END,
        last_receipt_at = CASE
          WHEN ? = 'receipt' AND (last_receipt_at IS NULL OR ? > last_receipt_at) THEN ?
          ELSE last_receipt_at
        END
      WHERE alias = ?
    `).run(
      maskAccountAlias(normalized),
      seenAt,
      seenAt,
      kind,
      seenAt,
      seenAt,
      kind,
      seenAt,
      seenAt,
      normalized
    );
  }

  row = db.prepare(
    "SELECT account_ref, alias, masked, can_login, login_method, first_seen_at, last_seen_at, " +
    "last_promo_at, last_receipt_at FROM accounts WHERE alias = ?"
  ).get(normalized);

  return {
    accountRef: row.account_ref,
    alias: row.alias,
    masked: row.masked,
    canLogin: Boolean(row.can_login),
    loginMethod: row.login_method || null,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastPromoAt: row.last_promo_at,
    lastReceiptAt: row.last_receipt_at
  };
}

export function setAccountAccess(db, alias, canLogin, loginMethod = null, accountStatus = null) {
  const normalized = normaliseAlias(alias);
  // Access edits must not look like a new Mail observation or restart offer age.
  const account = getAccounts(db).find(a => a.alias === normalized) || ensureAccount(db, { alias: normalized });
  if (!account) return false;
  if (accountStatus && !['active', 'archived', 'deactivated'].includes(accountStatus)) throw new Error('Invalid account status.');
  if (canLogin && (accountStatus || account.accountStatus) === 'deactivated') throw new Error('Deactivated accounts cannot be marked Can log in.');

  if (loginMethod != null && !["iCloud", "Google", "Both"].includes(loginMethod)) {
    throw new Error("Invalid account login method.");
  }

  db.prepare(
    "UPDATE accounts SET can_login = ?, login_method = COALESCE(?, login_method), account_status = COALESCE(?, account_status) WHERE alias = ?"
  ).run(canLogin ? 1 : 0, loginMethod || null, accountStatus || null, normalized);

  return true;
}

export function resetAccountAccess(db) {
  db.exec("UPDATE accounts SET can_login = 0");
}

export function getAccounts(db) {
  return db.prepare(`
    SELECT
      account_ref, alias, masked, can_login, login_method, account_status,
      first_seen_at, last_seen_at, last_promo_at, last_receipt_at
    FROM accounts
    ORDER BY last_seen_at DESC, account_ref ASC
  `).all().map(row => ({
    accountRef: row.account_ref,
    alias: row.alias,
    masked: row.masked,
    canLogin: Boolean(row.can_login),
    loginMethod: row.login_method || null,
    accountStatus: row.account_status || null,
    deactivated: row.account_status === 'deactivated',
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastPromoAt: row.last_promo_at,
    lastReceiptAt: row.last_receipt_at
  }));
}

export function deleteAccountsPermanently(db, aliases = []) {
  const uniqueAliases = [...new Set(
    aliases.map(normaliseAlias).filter(Boolean)
  )];

  const totals = {
    requested: uniqueAliases.length,
    accounts: 0,
    messages: 0,
    offers: 0,
    receipts: 0,
    transportReceipts: 0,
    receiptMatches: 0
  };

  const find = db.prepare("SELECT account_ref FROM accounts WHERE alias = ?");
  const count = table => db.prepare(
    "SELECT COUNT(*) AS count FROM " + table + " WHERE account_ref = ?"
  );
  const deleteByAccount = table => db.prepare(
    "DELETE FROM " + table + " WHERE account_ref = ?"
  );
  const deleteMatches = db.prepare(`
    DELETE FROM receipt_offer_matches
    WHERE
      receipt_id IN (SELECT receipt_id FROM receipts WHERE account_ref = ?)
      OR offer_id IN (SELECT offer_id FROM offers WHERE account_ref = ?)
  `);
  const deleteAccount = db.prepare(
    "DELETE FROM accounts WHERE account_ref = ?"
  );

  for (const alias of uniqueAliases) {
    db.prepare("INSERT OR IGNORE INTO deleted_accounts(alias_hash) VALUES(?)").run(createHash("sha256").update(alias).digest("hex"));
    const row = find.get(alias);
    if (!row) continue;

    const ref = row.account_ref;
    totals.messages += Number(count("messages").get(ref)?.count || 0);
    totals.offers += Number(count("offers").get(ref)?.count || 0);
    totals.receipts += Number(count("receipts").get(ref)?.count || 0);
    totals.transportReceipts += Number(
      count("transport_receipts").get(ref)?.count || 0
    );

    const matchCount = db.prepare(`
      SELECT COUNT(*) AS count
      FROM receipt_offer_matches
      WHERE
        receipt_id IN (SELECT receipt_id FROM receipts WHERE account_ref = ?)
        OR offer_id IN (SELECT offer_id FROM offers WHERE account_ref = ?)
    `).get(ref, ref);
    totals.receiptMatches += Number(matchCount?.count || 0);

    deleteMatches.run(ref, ref);
    deleteByAccount("receipts").run(ref);
    deleteByAccount("transport_receipts").run(ref);
    deleteByAccount("offers").run(ref);
    deleteByAccount("messages").run(ref);
    deleteAccount.run(ref);
    totals.accounts++;
  }

  return totals;
}

export function upsertMessage(db, message) {
  // Upgrade old Message-ID keys in place so parser improvements cannot create a
  // second receipt for a message already imported with an older parser.
  if (message.messageId && message.accountRef) {
    const id = String(message.messageId).trim().replace(/^<|>$/g, "").toLowerCase();
    const previous = db.prepare("SELECT message_key FROM messages WHERE account_ref = ? AND lower(trim(message_id, '<> ')) = ?")
      .all(message.accountRef, id);
    for (const row of previous) {
      if (row.message_key === message.messageKey) continue;
      for (const table of ["offers", "receipts", "transport_receipts"]) {
        db.prepare("UPDATE " + table + " SET message_key = ? WHERE message_key = ?")
          .run(message.messageKey, row.message_key);
      }
      db.prepare("DELETE FROM messages WHERE message_key = ?").run(row.message_key);
    }
  }
  if (message.kind === "transport_receipt") {
    db.prepare("DELETE FROM receipt_offer_matches WHERE receipt_id IN (SELECT receipt_id FROM receipts WHERE message_key = ?)")
      .run(message.messageKey);
    db.prepare("DELETE FROM receipts WHERE message_key = ?").run(message.messageKey);
  }
  if (message.kind === "receipt") {
    db.prepare("DELETE FROM transport_receipts WHERE message_key = ?").run(message.messageKey);
  }
  db.prepare(`
    INSERT INTO messages(
      message_key, message_id, account_ref, kind, mailbox,
      sender, subject, body_text, sent_at, received_at,
      parser_version, classification, classification_confidence,
      accepted, rejection_reason, evidence_json, parsed_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(message_key) DO UPDATE SET
      message_id = excluded.message_id,
      account_ref = excluded.account_ref,
      kind = excluded.kind,
      mailbox = excluded.mailbox,
      sender = excluded.sender,
      subject = excluded.subject,
      body_text = excluded.body_text,
      sent_at = excluded.sent_at,
      received_at = excluded.received_at,
      parser_version = excluded.parser_version,
      classification = excluded.classification,
      classification_confidence = excluded.classification_confidence,
      accepted = excluded.accepted,
      rejection_reason = excluded.rejection_reason,
      evidence_json = excluded.evidence_json,
      parsed_at = excluded.parsed_at
  `).run(
    message.messageKey,
    message.messageId || null,
    message.accountRef || null,
    message.kind,
    message.mailbox || null,
    message.sender || null,
    message.subject || null,
    message.bodyText || null,
    message.sentAt || null,
    message.receivedAt || null,
    message.parserVersion || null,
    message.classification || null,
    message.classificationConfidence || null,
    message.accepted ? 1 : 0,
    message.rejectionReason || null,
    JSON.stringify(message.evidence || {}),
    message.parsedAt
  );
}

export function upsertOffer(db, promo, seenAt = new Date().toISOString()) {
  const sourceSentAt = promo.emailSentAt || promo.receivedAt || seenAt;
  // Keep clocks for reminders and count repairs of the same service/discount.
  // A primary coupon corrected from an unrelated footer value has its own
  // source history; borrowing the footer family's clock falsely expires it.
  const previousFirst = promo.messageKey ? db.prepare(`SELECT MIN(first_sent_at) AS first_sent_at
    FROM offers WHERE message_key = ? AND account_ref = ?
      AND status != 'parser_superseded' AND service IS ?
      AND discount_type IS ? AND discount IS ?`).get(promo.messageKey, promo.accountRef, promo.service || null, promo.discountType || null, promo.discount ?? null)?.first_sent_at : null;
  const firstSentAt = previousFirst && previousFirst < sourceSentAt ? previousFirst : sourceSentAt;
  // Correcting parsed terms changes the fingerprint. Retain superseded rows as
  // private evidence, but do not publish two offers for the same source message.
  if (promo.messageKey) db.prepare(`UPDATE offers SET status = 'parser_superseded'
    WHERE message_key = ? AND account_ref = ? AND offer_id != ?`)
    .run(promo.messageKey, promo.accountRef, promo.offerId);
  const existing = db.prepare(
    "SELECT last_sent_at FROM offers WHERE offer_id = ?"
  ).get(promo.offerId);

  const incomingIsNewer =
    !existing?.last_sent_at ||
    String(sourceSentAt) >= String(existing.last_sent_at);

  if (!existing) {
    db.prepare(`
      INSERT INTO offers(
        offer_id, account_ref, message_key, service, offer_type, title,
        discount_type, discount, max_saving, per_use_cap,
        uses_total, uses_remaining, max_total_saving, minimum_spend,
        promo_code, expires, expires_at, expiry_status, expiry_basis,
        expiry_confidence, classification_confidence, evidence_json,
        first_sent_at, last_sent_at, first_seen_at, last_seen_at,
        source, observed_live, receipt_state, receipt_confirmed_uses,
        last_used_at, status
      ) VALUES(
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, NULL, 0, NULL, ?
      )
    `).run(
      promo.offerId,
      promo.accountRef,
      promo.messageKey || null,
      promo.service || null,
      promo.offerType || null,
      promo.title || null,
      promo.discountType || null,
      promo.discount ?? null,
      promo.maxSaving ?? null,
      promo.perUseCap ?? null,
      Number(promo.uses || 1),
      Number(promo.uses || 1),
      promo.maxTotalSaving ?? null,
      promo.minimumSpend ?? 0,
      promo.code || null,
      promo.expires || null,
      promo.expiresAt || null,
      promo.expiryStatus || "unknown",
      promo.expiryBasis || null,
      promo.expiryConfidence || null,
      promo.classificationConfidence || null,
      JSON.stringify(promo.evidence || {}),
      firstSentAt,
      sourceSentAt,
      seenAt,
      seenAt,
      promo.source || "live_mail",
      promo.observedLive === false ? 0 : 1,
      promo.observedLive === false ? "historical" : "active"
    );

    return;
  }

  db.prepare(`
    UPDATE offers
    SET
      last_seen_at = ?,
      observed_live = CASE WHEN ? = 1 THEN 1 ELSE observed_live END,
      source = CASE WHEN ? = 1 THEN 'live_mail' ELSE source END,
      first_sent_at = CASE
        WHEN first_sent_at IS NULL OR ? < first_sent_at THEN ?
        ELSE first_sent_at
      END,
      last_sent_at = CASE
        WHEN last_sent_at IS NULL OR ? > last_sent_at THEN ?
        ELSE last_sent_at
      END,
      message_key = CASE WHEN ? = 1 THEN ? ELSE message_key END,
      title = CASE WHEN ? = 1 THEN ? ELSE title END,
      promo_code = CASE
        WHEN ? = 1 AND ? IS NOT NULL THEN ?
        ELSE promo_code
      END,
      expires = CASE
        WHEN ? = 1 AND ? IS NOT NULL THEN ?
        ELSE expires
      END,
      expires_at = CASE
        WHEN ? = 1 AND ? IS NOT NULL THEN ?
        ELSE expires_at
      END,
      expiry_status = CASE
        WHEN ? = 1 AND ? IS NOT NULL THEN ?
        ELSE expiry_status
      END,
      expiry_basis = CASE
        WHEN ? = 1 AND ? IS NOT NULL THEN ?
        ELSE expiry_basis
      END,
      expiry_confidence = CASE
        WHEN ? = 1 AND ? IS NOT NULL THEN ?
        ELSE expiry_confidence
      END,
      classification_confidence = CASE WHEN ? = 1 THEN ? ELSE classification_confidence END,
      evidence_json = CASE WHEN ? = 1 THEN ? ELSE evidence_json END,
      status = CASE WHEN observed_live = 1 OR ? = 1 THEN 'active' ELSE status END
    WHERE offer_id = ?
  `).run(
    seenAt,
    promo.observedLive === false ? 0 : 1,
    promo.observedLive === false ? 0 : 1,
    firstSentAt,
    firstSentAt,
    sourceSentAt,
    sourceSentAt,
    incomingIsNewer ? 1 : 0,
    promo.messageKey || null,
    incomingIsNewer ? 1 : 0,
    promo.title || null,
    incomingIsNewer ? 1 : 0,
    promo.code || null,
    promo.code || null,
    incomingIsNewer ? 1 : 0,
    promo.expires || null,
    promo.expires || null,
    incomingIsNewer ? 1 : 0,
    promo.expiresAt || null,
    promo.expiresAt || null,
    incomingIsNewer ? 1 : 0,
    promo.expires ? (promo.expiryStatus || "exact") : null,
    promo.expiryStatus || "unknown",
    incomingIsNewer ? 1 : 0,
    promo.expiryBasis || null,
    promo.expiryBasis || null,
    incomingIsNewer ? 1 : 0,
    promo.expiryConfidence || null,
    promo.expiryConfidence || null,
    incomingIsNewer ? 1 : 0,
    promo.classificationConfidence || null,
    incomingIsNewer ? 1 : 0,
    JSON.stringify(promo.evidence || {}),
    promo.observedLive === false ? 0 : 1,
    promo.offerId
  );
}

// Only the explicit complete-source reparse calls this. Incremental imports
// keep durable reminder clocks; they cannot prove that an earlier source was a
// false parser extraction. Retain prior derived clocks privately for review.
export function reconcileOfferSources(db, { processedMessageKeys, families }) {
  const sources = db.prepare('SELECT message_key, account_ref, sender, body_text FROM messages').all();
  if (!(processedMessageKeys instanceof Set) || !(families instanceof Map) ||
      sources.some(m => !processedMessageKeys.has(m.message_key) ||
        !m.account_ref || !m.sender || m.body_text == null)) {
    throw new Error('Offer reconstruction requires complete stored message source coverage; no partial import may rebuild clocks.');
  }
  const plans = [];
  for (const [offerId, family] of families) {
    const promo = family.latest;
    // A same-family reminder may omit terms without withdrawing a previously
    // explicit deadline. Only accepted matching sources may supply that term.
    const expirySource = promo?.expires || promo?.expiresAt ? promo : family.latestExpiry;
    const lastSentAt = promo?.emailSentAt || promo?.receivedAt;
    const source = promo?.messageKey ? db.prepare('SELECT account_ref, accepted, kind FROM messages WHERE message_key = ?').get(promo.messageKey) : null;
    if (!source || !source.accepted || source.kind !== 'promo' ||
        source.account_ref !== promo.accountRef || promo.offerId !== offerId || offerFingerprint(promo) !== offerId ||
        !Number.isFinite(Date.parse(family.firstSentAt)) ||
        !Number.isFinite(Date.parse(lastSentAt)) ||
        Date.parse(family.firstSentAt) > Date.parse(lastSentAt)) {
      throw new Error('Offer reconstruction has an invalid accepted source family.');
    }
    if (expirySource) {
      const expiryMessage = db.prepare('SELECT account_ref, accepted, kind FROM messages WHERE message_key = ?').get(expirySource.messageKey);
      if (!expiryMessage?.accepted || expiryMessage.kind !== 'promo' ||
          expiryMessage.account_ref !== promo.accountRef || offerFingerprint(expirySource) !== offerId ||
          !processedMessageKeys.has(expirySource.messageKey)) {
        throw new Error('Offer reconstruction has an invalid accepted expiry source.');
      }
    }
    const previous = db.prepare('SELECT first_sent_at, last_sent_at, message_key FROM offers WHERE offer_id = ?').get(offerId);
    if (!previous) throw new Error('Offer reconstruction cannot invent a missing offer.');
    plans.push({ offerId, family, promo, expirySource, lastSentAt, previous });
  }
  db.exec(`CREATE TABLE IF NOT EXISTS offer_source_repairs (
    repair_id INTEGER PRIMARY KEY,
    offer_id TEXT NOT NULL,
    previous_first_sent_at TEXT, canonical_first_sent_at TEXT NOT NULL,
    previous_last_sent_at TEXT, canonical_last_sent_at TEXT NOT NULL,
    previous_message_key TEXT, canonical_message_key TEXT NOT NULL,
    repaired_at TEXT NOT NULL
  )`);
  const record = db.prepare(`INSERT INTO offer_source_repairs (
    offer_id, previous_first_sent_at, canonical_first_sent_at,
    previous_last_sent_at, canonical_last_sent_at,
    previous_message_key, canonical_message_key, repaired_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
  const update = db.prepare(`UPDATE offers SET
    first_sent_at = ?, last_sent_at = ?, message_key = ?, title = ?,
    promo_code = ?, expires = ?, expires_at = ?, expiry_status = ?,
    expiry_basis = ?, expiry_confidence = ?, classification_confidence = ?,
    evidence_json = ?, status = CASE WHEN observed_live = 1 THEN 'active' ELSE 'historical' END
    WHERE offer_id = ?`);
  let repairedClocks = 0;
  for (const { offerId, family, promo, expirySource, lastSentAt, previous } of plans) {
    if (previous.first_sent_at !== family.firstSentAt ||
        previous.last_sent_at !== lastSentAt || previous.message_key !== promo.messageKey) {
      record.run(offerId, previous.first_sent_at, family.firstSentAt,
        previous.last_sent_at, lastSentAt, previous.message_key, promo.messageKey,
        new Date().toISOString());
      repairedClocks++;
    }
    update.run(family.firstSentAt, lastSentAt, promo.messageKey, promo.title || null,
      promo.code || null, expirySource?.expires || null, expirySource?.expiresAt || null,
      expirySource?.expiryStatus || 'unknown', expirySource?.expiryBasis || null,
      expirySource?.expiryConfidence || null, promo.classificationConfidence || null,
      JSON.stringify({ ...promo.evidence,
        ...(expirySource && expirySource !== promo ? { expiry: expirySource.evidence?.expiry, expirySourceMessageKey: expirySource.messageKey } : {})
      }), offerId);
  }
  return { coveredMessages: sources.length, sourceFamilies: families.size, repairedClocks };
}

export function getOffers(db, { service = null, includeHistorical = false } = {}) {
  let sql = `
    SELECT
      o.*,
      a.masked AS account_masked,
      a.can_login AS can_login,
      a.login_method AS login_method
    FROM offers o
    JOIN accounts a ON a.account_ref = o.account_ref
    LEFT JOIN messages m ON m.message_key = o.message_key
    WHERE o.status != 'parser_superseded'
      AND (m.message_key IS NULL OR (m.accepted = 1 AND m.kind = 'promo'))
  `;

  const args = [];

  if (service) {
    sql += " AND o.service = ?";
    args.push(service);
  }

  if (!includeHistorical) {
    sql += " AND o.observed_live = 1 AND o.status != 'historical'";
  }

  sql += " ORDER BY o.last_sent_at DESC, o.offer_id ASC";

  return db.prepare(sql).all(...args).map(row => ({
    offerId: row.offer_id,
    accountRef: row.account_ref,
    accountMasked: row.account_masked,
    canLogin: Boolean(row.can_login),
    loginMethod: row.login_method || null,
    messageKey: row.message_key,
    service: row.service,
    offerType: row.offer_type,
    title: row.title,
    discountType: row.discount_type,
    discount: row.discount,
    maxSaving: row.max_saving,
    perUseCap: row.per_use_cap,
    uses: row.uses_total,
    usesRemaining: row.uses_remaining,
    maxTotalSaving: row.max_total_saving,
    minimumSpend: row.minimum_spend,
    code: row.promo_code,
    expires: row.expires,
    expiresAt: row.expires_at,
    expiryStatus: row.expiry_status,
    expiryBasis: row.expiry_basis,
    expiryConfidence: row.expiry_confidence,
    classificationConfidence: row.classification_confidence,
    evidence: row.evidence_json ? JSON.parse(row.evidence_json) : {},
    emailSentAt: row.last_sent_at,
    firstEmailSentAt: row.first_sent_at,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    source: row.source,
    observedLive: Boolean(row.observed_live),
    receiptState: row.receipt_state,
    receiptConfirmedUses: row.receipt_confirmed_uses,
    lastUsedAt: row.last_used_at,
    status: row.status
  }));
}

export function upsertReceipt(db, receipt, seenAt = new Date().toISOString()) {
  // A complete reparse of the SAME source may correct a former false extraction.
  // Sparse duplicates from different messages continue to preserve known facts.
  if (receipt.reparsedSource && receipt.messageKey) db.prepare(`UPDATE receipts SET
    subtotal = NULL, promotion_discount = NULL, delivery_fee = NULL, service_fee = NULL,
    small_order_fee = NULL, tip = NULL, uber_cash_used = NULL, uber_cash_savings = NULL,
    reported_savings = NULL, uber_one_savings = NULL, uber_one_signal = 0, total = NULL
    WHERE message_key = ? AND account_ref = ?`).run(receipt.messageKey, receipt.accountRef);
  const previous = db.prepare(`SELECT receipt_id FROM receipts WHERE account_ref = ? AND
    ((message_key IS NOT NULL AND message_key = ?) OR
     (order_id IS NOT NULL AND upper(trim(order_id)) = ?)) LIMIT 1`)
    .get(receipt.accountRef, receipt.messageKey || null, receipt.orderId ? String(receipt.orderId).trim().toUpperCase() : null);
  if (previous) receipt = { ...receipt, receiptId: previous.receipt_id };
  db.prepare(`
    INSERT INTO receipts(
      receipt_id, account_ref, message_key, sent_at, received_at,
      order_id, merchant, subtotal, promotion_discount,
      delivery_fee, service_fee, small_order_fee, tip,
      uber_cash_used, uber_cash_savings, reported_savings, uber_one_savings, uber_one_signal,
      total, first_seen_at, last_seen_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(receipt_id) DO UPDATE SET
      account_ref = excluded.account_ref,
      message_key = CASE WHEN excluded.received_at >= receipts.received_at
        THEN COALESCE(excluded.message_key, receipts.message_key) ELSE receipts.message_key END,
      sent_at = MIN(receipts.sent_at, excluded.sent_at),
      received_at = MAX(receipts.received_at, excluded.received_at),
      order_id = CASE WHEN excluded.received_at >= receipts.received_at
        THEN COALESCE(excluded.order_id, receipts.order_id)
        ELSE COALESCE(receipts.order_id, excluded.order_id) END,
      merchant = CASE WHEN excluded.received_at >= receipts.received_at
        THEN COALESCE(excluded.merchant, receipts.merchant)
        ELSE COALESCE(receipts.merchant, excluded.merchant) END,
      subtotal = CASE WHEN excluded.received_at >= receipts.received_at
        THEN COALESCE(excluded.subtotal, receipts.subtotal)
        ELSE COALESCE(receipts.subtotal, excluded.subtotal) END,
      promotion_discount = CASE WHEN excluded.received_at >= receipts.received_at
        THEN COALESCE(excluded.promotion_discount, receipts.promotion_discount)
        ELSE COALESCE(receipts.promotion_discount, excluded.promotion_discount) END,
      delivery_fee = CASE WHEN excluded.received_at >= receipts.received_at
        THEN COALESCE(excluded.delivery_fee, receipts.delivery_fee)
        ELSE COALESCE(receipts.delivery_fee, excluded.delivery_fee) END,
      service_fee = CASE WHEN excluded.received_at >= receipts.received_at
        THEN COALESCE(excluded.service_fee, receipts.service_fee)
        ELSE COALESCE(receipts.service_fee, excluded.service_fee) END,
      small_order_fee = CASE WHEN excluded.received_at >= receipts.received_at
        THEN COALESCE(excluded.small_order_fee, receipts.small_order_fee)
        ELSE COALESCE(receipts.small_order_fee, excluded.small_order_fee) END,
      tip = CASE WHEN excluded.received_at >= receipts.received_at
        THEN COALESCE(excluded.tip, receipts.tip)
        ELSE COALESCE(receipts.tip, excluded.tip) END,
      uber_cash_used = CASE WHEN excluded.received_at >= receipts.received_at
        THEN COALESCE(excluded.uber_cash_used, receipts.uber_cash_used)
        ELSE COALESCE(receipts.uber_cash_used, excluded.uber_cash_used) END,
      uber_cash_savings = CASE WHEN excluded.received_at >= receipts.received_at
        THEN COALESCE(excluded.uber_cash_savings, receipts.uber_cash_savings)
        ELSE COALESCE(receipts.uber_cash_savings, excluded.uber_cash_savings) END,
      reported_savings = CASE WHEN excluded.received_at >= receipts.received_at
        THEN COALESCE(excluded.reported_savings, receipts.reported_savings)
        ELSE COALESCE(receipts.reported_savings, excluded.reported_savings) END,
      uber_one_savings = CASE WHEN excluded.received_at >= receipts.received_at
        THEN COALESCE(excluded.uber_one_savings, receipts.uber_one_savings)
        ELSE COALESCE(receipts.uber_one_savings, excluded.uber_one_savings) END,
      uber_one_signal = MAX(receipts.uber_one_signal, excluded.uber_one_signal),
      total = CASE WHEN excluded.received_at >= receipts.received_at
        THEN COALESCE(excluded.total, receipts.total)
        ELSE COALESCE(receipts.total, excluded.total) END,
      last_seen_at = excluded.last_seen_at
  `).run(
    receipt.receiptId,
    receipt.accountRef,
    receipt.messageKey || null,
    receipt.sentAt || receipt.receivedAt || null,
    receipt.receivedAt || null,
    receipt.orderId || null,
    receipt.merchant || null,
    receipt.subtotal ?? null,
    receipt.promotionDiscount ?? null,
    receipt.deliveryFee ?? null,
    receipt.serviceFee ?? null,
    receipt.smallOrderFee ?? null,
    receipt.tip ?? null,
    receipt.uberCashUsed ?? null,
    receipt.uberCashSavings ?? null,
    receipt.reportedSavings ?? null,
    receipt.uberOneSavings ?? null,
    receipt.uberOneSignal ? 1 : 0,
    receipt.total ?? null,
    seenAt,
    seenAt
  );
}

export function getReceipts(db) {
  return dedupeReceipts(db.prepare(`
    SELECT
      r.*,
      a.masked AS account_masked,
      a.can_login AS can_login
    FROM receipts r
    JOIN accounts a ON a.account_ref = r.account_ref
    LEFT JOIN messages m ON m.message_key = r.message_key
    WHERE m.message_key IS NULL OR (m.accepted = 1 AND m.kind = 'receipt')
    ORDER BY COALESCE(r.sent_at, r.received_at) ASC, r.receipt_id ASC
  `).all().map(row => ({
    messageKey: row.message_key,
    service: "Uber Eats",
    id: row.receipt_id,
    receiptId: row.receipt_id,
    accountRef: row.account_ref,
    accountMasked: row.account_masked,
    canLogin: Boolean(row.can_login),
    sentAt: row.sent_at,
    receivedAt: row.received_at,
    orderId: row.order_id,
    merchant: row.merchant,
    subtotal: row.subtotal,
    promotionDiscount: row.promotion_discount,
    deliveryFee: row.delivery_fee,
    serviceFee: row.service_fee,
    smallOrderFee: row.small_order_fee,
    tip: row.tip,
    uberCashUsed: row.uber_cash_used,
    uberCashSavings: row.uber_cash_savings,
    reportedSavings: row.reported_savings,
    uberOneSavings: row.uber_one_savings,
    uberOneSignal: Boolean(row.uber_one_signal),
    total: row.total
  })));
}

export function upsertTransportReceipt(
  db,
  receipt,
  seenAt = new Date().toISOString()
) {
  if (receipt.reparsedSource && receipt.messageKey) db.prepare(`UPDATE transport_receipts SET
    promotion_discount = NULL, uber_cash_used = NULL, uber_cash_savings = NULL,
    reported_savings = NULL, uber_one_savings = NULL, total = NULL
    WHERE message_key = ? AND account_ref = ?`).run(receipt.messageKey, receipt.accountRef);
  const previous = db.prepare(`SELECT receipt_id FROM transport_receipts WHERE account_ref = ? AND
    ((? IS NOT NULL AND message_key = ?) OR (? IS NOT NULL AND upper(trim(trip_id)) = ?) OR (? IS NOT NULL AND trip_key = ? AND transport_mode = ?)) ORDER BY CASE WHEN message_key = ? THEN 0 ELSE 1 END,first_seen_at LIMIT 1`)
    .get(receipt.accountRef, receipt.messageKey || null, receipt.messageKey || null,
      receipt.tripId ? String(receipt.tripId).trim().toUpperCase() : null,
      receipt.tripId ? String(receipt.tripId).trim().toUpperCase() : null,
      receipt.tripKey || null,receipt.tripKey || null,receipt.transportMode || 'ride',receipt.messageKey || null);
  if (previous) receipt = { ...receipt, receiptId: previous.receipt_id };
  db.prepare(`
    INSERT INTO transport_receipts(
      receipt_id, account_ref, message_key, sent_at, received_at,
      trip_id, trip_key, transport_mode, total, first_seen_at, last_seen_at,
      promotion_discount, uber_cash_used, uber_cash_savings, reported_savings, uber_one_savings
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(receipt_id) DO UPDATE SET
      account_ref = excluded.account_ref,
      message_key = CASE WHEN excluded.received_at >= transport_receipts.received_at
        THEN COALESCE(excluded.message_key, transport_receipts.message_key) ELSE transport_receipts.message_key END,
      sent_at = MIN(transport_receipts.sent_at, excluded.sent_at),
      received_at = MAX(transport_receipts.received_at, excluded.received_at),
      promotion_discount = CASE WHEN excluded.received_at >= transport_receipts.received_at
        THEN COALESCE(excluded.promotion_discount, transport_receipts.promotion_discount)
        ELSE COALESCE(transport_receipts.promotion_discount, excluded.promotion_discount) END,
      uber_cash_used = CASE WHEN excluded.received_at >= transport_receipts.received_at
        THEN COALESCE(excluded.uber_cash_used, transport_receipts.uber_cash_used)
        ELSE COALESCE(transport_receipts.uber_cash_used, excluded.uber_cash_used) END,
      uber_cash_savings = CASE WHEN excluded.received_at >= transport_receipts.received_at
        THEN COALESCE(excluded.uber_cash_savings, transport_receipts.uber_cash_savings)
        ELSE COALESCE(transport_receipts.uber_cash_savings, excluded.uber_cash_savings) END,
      reported_savings = CASE WHEN excluded.received_at >= transport_receipts.received_at
        THEN COALESCE(excluded.reported_savings, transport_receipts.reported_savings)
        ELSE COALESCE(transport_receipts.reported_savings, excluded.reported_savings) END,
      uber_one_savings = CASE WHEN excluded.received_at >= transport_receipts.received_at
        THEN COALESCE(excluded.uber_one_savings, transport_receipts.uber_one_savings)
        ELSE COALESCE(transport_receipts.uber_one_savings, excluded.uber_one_savings) END,
      trip_id = COALESCE(excluded.trip_id, transport_receipts.trip_id),
      trip_key = COALESCE(excluded.trip_key, transport_receipts.trip_key),
      transport_mode = CASE WHEN excluded.received_at >= transport_receipts.received_at
        THEN excluded.transport_mode ELSE transport_receipts.transport_mode END,
      total = CASE WHEN excluded.received_at >= transport_receipts.received_at
        THEN COALESCE(excluded.total, transport_receipts.total)
        ELSE COALESCE(transport_receipts.total, excluded.total) END,
      last_seen_at = excluded.last_seen_at
  `).run(
    receipt.receiptId,
    receipt.accountRef,
    receipt.messageKey || null,
    receipt.sentAt || receipt.receivedAt || null,
    receipt.receivedAt || null,
    receipt.tripId || null,
    receipt.tripKey || null,
    receipt.transportMode || "ride",
    receipt.total ?? null,
    seenAt,
    seenAt,
    receipt.promotionDiscount ?? null, receipt.uberCashUsed ?? null, receipt.uberCashSavings ?? null,
    receipt.reportedSavings ?? null, receipt.uberOneSavings ?? null
  );
}

// Run only after complete, validated source coverage. Duplicate derived rows
// remain recoverable in a private journal; every original message is retained.
export function reconcileTransportReceiptIdentities(db, processedMessageKeys, parsedSources = null) {
  const rows=db.prepare('SELECT * FROM transport_receipts WHERE trip_key IS NOT NULL').all();
  const groups=new Map();
  for(const row of rows){
    if(!row.message_key || !processedMessageKeys.has(row.message_key)) throw new Error('Complete receipt source coverage is required for identity reconciliation.');
    const key=JSON.stringify([row.account_ref,row.transport_mode,row.trip_key]);
    if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);
  }
  const duplicates=[...groups.values()].filter(g=>g.length>1);
  for(const group of duplicates) if(new Set(group.map(r=>r.trip_id?.trim().toUpperCase()).filter(Boolean)).size>1) throw new Error('Conflicting trip IDs cannot be merged.');
  db.exec('CREATE TABLE IF NOT EXISTS receipt_identity_repairs (duplicate_receipt_id TEXT PRIMARY KEY, retained_receipt_id TEXT NOT NULL, original_rows_json TEXT NOT NULL, repaired_at TEXT NOT NULL)');
  let merged=0;
  if (parsedSources) for(const [key,group] of groups) {
    const sources=parsedSources.filter(r=>JSON.stringify([r.accountRef,r.transportMode||'ride',r.tripKey])===key);
    if (!sources.length) throw new Error('Receipt identity has no currently accepted source.');
    const reconstructed=dedupeReceipts(sources);
    const [current]=reconstructed;
    if (reconstructed.length!==1) throw new Error('Receipt sources cannot be reconstructed unambiguously.');
    const financial={total:current.total??null,promotion_discount:current.promotionDiscount??null,uber_cash_used:current.uberCashUsed??null,uber_cash_savings:current.uberCashSavings??null,reported_savings:current.reportedSavings??null,uber_one_savings:current.uberOneSavings??null};
    const columns=Object.keys(financial);
    // Each component comes from the latest source that actually states it.
    // A later sparse copy cannot erase a valid discount from an earlier copy.
    for(const row of group){
      db.prepare('UPDATE transport_receipts SET '+columns.map(k=>k+'=?').join(',')+' WHERE receipt_id=?').run(...columns.map(k=>financial[k]),row.receipt_id);
      Object.assign(row,financial);
    }
  }
  for(const group of duplicates){
    group.sort((a,b)=>a.first_seen_at.localeCompare(b.first_seen_at)||a.receipt_id.localeCompare(b.receipt_id));
    const retained=group[0],recent=[...group].sort((a,b)=>String(b.received_at).localeCompare(String(a.received_at))||b.last_seen_at.localeCompare(a.last_seen_at));
    const result={...retained};
    for(const column of Object.keys(retained).filter(k=>!['receipt_id','account_ref','first_seen_at','sent_at','last_seen_at'].includes(k))) result[column]=recent.find(r=>r[column]!=null)?.[column]??null;
    result.sent_at=group.map(r=>r.sent_at).filter(Boolean).sort()[0]||null;
    result.last_seen_at=group.map(r=>r.last_seen_at).sort().at(-1);
    const columns=Object.keys(result).filter(k=>k!=='receipt_id');
    db.prepare('UPDATE transport_receipts SET '+columns.map(k=>k+'=?').join(',')+' WHERE receipt_id=?').run(...columns.map(k=>result[k]),retained.receipt_id);
    for(const row of group.slice(1)){
      db.prepare('INSERT INTO receipt_identity_repairs VALUES(?,?,?,?)').run(row.receipt_id,retained.receipt_id,JSON.stringify(group),new Date().toISOString());
      db.prepare('DELETE FROM transport_receipts WHERE receipt_id=?').run(row.receipt_id);merged++;
    }
  }
  return {duplicateGroups:duplicates.length,mergedDerivedRows:merged,originalMessagesPreserved:true};
}

export function getTransportReceipts(db) {
  return dedupeReceipts(db.prepare(`
    SELECT
      r.*,
      a.masked AS account_masked,
      a.can_login AS can_login
    FROM transport_receipts r
    JOIN accounts a ON a.account_ref = r.account_ref
    LEFT JOIN messages m ON m.message_key = r.message_key
    WHERE m.message_key IS NULL OR (m.accepted = 1 AND m.kind = 'transport_receipt')
    ORDER BY COALESCE(r.sent_at, r.received_at) ASC, r.receipt_id ASC
  `).all().map(row => ({
    messageKey: row.message_key,
    service: "Uber",
    id: row.receipt_id,
    receiptId: row.receipt_id,
    accountRef: row.account_ref,
    accountMasked: row.account_masked,
    canLogin: Boolean(row.can_login),
    sentAt: row.sent_at,
    receivedAt: row.received_at,
    tripId: row.trip_id,
    tripKey: row.trip_key || null,
    transportMode: row.transport_mode,
    promotionDiscount: row.promotion_discount, uberCashUsed: row.uber_cash_used, uberCashSavings: row.uber_cash_savings,
    reportedSavings: row.reported_savings, uberOneSavings: row.uber_one_savings,
    total: row.total
  })));
}

export function updateOfferUsage(db, promo) {
  db.prepare(`
    UPDATE offers
    SET
      uses_remaining = ?,
      receipt_state = ?,
      receipt_confirmed_uses = ?,
      last_used_at = ?,
      status = CASE WHEN ? = 'used' THEN 'used' ELSE 'active' END
    WHERE offer_id = ?
  `).run(
    Number(promo.usesRemaining ?? promo.uses ?? 1),
    promo.receiptState || null,
    Number(promo.receiptConfirmedUses || 0),
    promo.lastUsedAt || null,
    promo.receiptState || null,
    promo.offerId
  );
}

export function replaceReceiptMatches(db, matches = [], matchedAt = new Date().toISOString()) {
  db.exec("DELETE FROM receipt_offer_matches");

  const insert = db.prepare(`
    INSERT INTO receipt_offer_matches(
      receipt_id, offer_id, status, expected_saving, observed_saving, matched_at
    ) VALUES(?, ?, ?, ?, ?, ?)
  `);

  for (const match of matches) {
    insert.run(
      match.receiptId || "unknown",
      match.offerId || null,
      match.status,
      match.expectedSaving ?? null,
      match.observedSaving ?? null,
      matchedAt
    );
  }
}

export function getSavingsSummary(db) {
  const receipts = getReceipts(db);
  const savings = combinedReceiptSavings(receipts, getTransportReceipts(db));

  const feeSamples = receipts.filter(r => r.deliveryFee != null || r.serviceFee != null || r.smallOrderFee != null);
  const averageFees = feeSamples.length ? feeSamples.reduce((sum, r) => sum + Number(r.deliveryFee || 0) + Number(r.serviceFee || 0) + Number(r.smallOrderFee || 0), 0) / feeSamples.length : 0;

  const accountCounts = db.prepare(`
    SELECT
      COUNT(*) AS known_accounts,
      SUM(CASE WHEN can_login = 1 THEN 1 ELSE 0 END) AS accessible_accounts,
      SUM(CASE WHEN can_login = 0 THEN 1 ELSE 0 END) AS inaccessible_accounts
    FROM accounts
  `).get();

  const activePromoAccounts = db.prepare(`
    SELECT COUNT(DISTINCT account_ref) AS count
    FROM offers
    WHERE
      service = 'Uber Eats' AND
      observed_live = 1 AND
      status = 'active' AND
      (expires IS NULL OR expires >= date('now'))
  `).get()?.count || 0;

  return {
    ...savings.summary,
    averageExtraOrderFees: Number(averageFees.toFixed(2)),
    knownAccounts: Number(accountCounts.known_accounts || 0),
    accessibleAccounts: Number(accountCounts.accessible_accounts || 0),
    inaccessibleAccounts: Number(accountCounts.inaccessible_accounts || 0),
    activePromoAccounts: Number(activePromoAccounts || 0)
  };
}

export function getPublicAccountInsights(db) {
  const receipts = getReceipts(db);
  const rides = getTransportReceipts(db);
  const offers = getOffers(db, { service: "Uber Eats" });
  const savings = estimateReceiptSavings(receipts).byAccount;
  return getAccounts(db).map(account => {
    const orders = receipts.filter(r => r.accountRef === account.accountRef);
    const transport = rides.filter(r => r.accountRef === account.accountRef);
    const last = rows => rows.map(r => r.sentAt || r.receivedAt).filter(Boolean).sort().at(-1) || null;
    return { accountRef: account.accountRef, accountMasked: account.masked, canLogin: account.canLogin,
      loginMethod: account.loginMethod, deactivated: account.deactivated === true, lastSeenAt: account.lastSeenAt, lastPromoAt: account.lastPromoAt,
      lastOrderAt: last(orders), lastRideAt: last(transport), orderCount: orders.length, rideCount: transport.length,
      totalSaved: savings.get(account.accountRef)?.confirmedSaved || 0,
      activePromoCount: offers.filter(p => p.accountRef === account.accountRef && p.status === "active").length };
  });
}
