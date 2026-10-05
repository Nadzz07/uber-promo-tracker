import { DatabaseSync } from "node:sqlite";
import { maskAccountAlias } from "./account-map.js";
import { estimateReceiptSavings } from "./savings-intelligence.js";

export const PRIVATE_DB_SCHEMA_VERSION = 2;
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
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accounts (
      account_ref TEXT PRIMARY KEY,
      alias TEXT NOT NULL UNIQUE,
      masked TEXT,
      can_login INTEGER NOT NULL DEFAULT 0 CHECK (can_login IN (0,1)),
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
      reported_savings REAL,
      uber_one_savings REAL,
      uber_one_signal INTEGER NOT NULL DEFAULT 0,
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
    CREATE INDEX IF NOT EXISTS idx_messages_sent ON messages(sent_at);
  `);


  const receiptColumns = new Set(
    db.prepare("PRAGMA table_info(receipts)").all().map(row => row.name)
  );

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
  const db = new DatabaseSync(path);
  initSchema(db);
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

  let row = db.prepare(
    "SELECT account_ref, alias, masked, can_login, first_seen_at, last_seen_at, " +
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
      ) VALUES(?, ?, ?, 0, ?, ?, ?, ?)
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
    "SELECT account_ref, alias, masked, can_login, first_seen_at, last_seen_at, " +
    "last_promo_at, last_receipt_at FROM accounts WHERE alias = ?"
  ).get(normalized);

  return {
    accountRef: row.account_ref,
    alias: row.alias,
    masked: row.masked,
    canLogin: Boolean(row.can_login),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastPromoAt: row.last_promo_at,
    lastReceiptAt: row.last_receipt_at
  };
}

export function setAccountAccess(db, alias, canLogin) {
  const normalized = normaliseAlias(alias);
  const account = ensureAccount(db, { alias: normalized });
  if (!account) return false;

  db.prepare("UPDATE accounts SET can_login = ? WHERE alias = ?")
    .run(canLogin ? 1 : 0, normalized);

  return true;
}

export function resetAccountAccess(db) {
  db.exec("UPDATE accounts SET can_login = 0");
}

export function getAccounts(db) {
  return db.prepare(`
    SELECT
      account_ref, alias, masked, can_login,
      first_seen_at, last_seen_at, last_promo_at, last_receipt_at
    FROM accounts
    ORDER BY last_seen_at DESC, account_ref ASC
  `).all().map(row => ({
    accountRef: row.account_ref,
    alias: row.alias,
    masked: row.masked,
    canLogin: Boolean(row.can_login),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    lastPromoAt: row.last_promo_at,
    lastReceiptAt: row.last_receipt_at
  }));
}

export function upsertMessage(db, message) {
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
      sourceSentAt,
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
    sourceSentAt,
    sourceSentAt,
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

export function getOffers(db, { service = null, includeHistorical = false } = {}) {
  let sql = `
    SELECT
      o.*,
      a.masked AS account_masked,
      a.can_login AS can_login
    FROM offers o
    JOIN accounts a ON a.account_ref = o.account_ref
    WHERE 1 = 1
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
    source: row.source,
    observedLive: Boolean(row.observed_live),
    receiptState: row.receipt_state,
    receiptConfirmedUses: row.receipt_confirmed_uses,
    lastUsedAt: row.last_used_at,
    status: row.status
  }));
}

export function upsertReceipt(db, receipt, seenAt = new Date().toISOString()) {
  db.prepare(`
    INSERT INTO receipts(
      receipt_id, account_ref, message_key, sent_at, received_at,
      order_id, merchant, subtotal, promotion_discount,
      delivery_fee, service_fee, small_order_fee, tip,
      uber_cash_used, reported_savings, uber_one_savings, uber_one_signal,
      total, first_seen_at, last_seen_at
    ) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(receipt_id) DO UPDATE SET
      account_ref = excluded.account_ref,
      message_key = excluded.message_key,
      sent_at = excluded.sent_at,
      received_at = excluded.received_at,
      order_id = excluded.order_id,
      merchant = excluded.merchant,
      subtotal = excluded.subtotal,
      promotion_discount = excluded.promotion_discount,
      delivery_fee = excluded.delivery_fee,
      service_fee = excluded.service_fee,
      small_order_fee = excluded.small_order_fee,
      tip = excluded.tip,
      uber_cash_used = excluded.uber_cash_used,
      reported_savings = excluded.reported_savings,
      uber_one_savings = excluded.uber_one_savings,
      uber_one_signal = excluded.uber_one_signal,
      total = excluded.total,
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
    receipt.reportedSavings ?? null,
    receipt.uberOneSavings ?? null,
    receipt.uberOneSignal ? 1 : 0,
    receipt.total ?? null,
    seenAt,
    seenAt
  );
}

export function getReceipts(db) {
  return db.prepare(`
    SELECT
      r.*,
      a.masked AS account_masked,
      a.can_login AS can_login
    FROM receipts r
    JOIN accounts a ON a.account_ref = r.account_ref
    ORDER BY COALESCE(r.sent_at, r.received_at) ASC, r.receipt_id ASC
  `).all().map(row => ({
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
    reportedSavings: row.reported_savings,
    uberOneSavings: row.uber_one_savings,
    uberOneSignal: Boolean(row.uber_one_signal),
    total: row.total
  }));
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
  const savings = estimateReceiptSavings(receipts);

  const feeRow = db.prepare(`
    SELECT
      COALESCE(AVG(
        COALESCE(delivery_fee, 0) +
        COALESCE(service_fee, 0) +
        COALESCE(small_order_fee, 0)
      ), 0) AS average_fees
    FROM receipts
  `).get();

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
    averageExtraOrderFees: Number(Number(feeRow.average_fees || 0).toFixed(2)),
    knownAccounts: Number(accountCounts.known_accounts || 0),
    accessibleAccounts: Number(accountCounts.accessible_accounts || 0),
    inaccessibleAccounts: Number(accountCounts.inaccessible_accounts || 0),
    activePromoAccounts: Number(activePromoAccounts || 0)
  };
}

export function getPublicAccountInsights(db) {
  return db.prepare(`
    SELECT
      a.account_ref,
      a.masked,
      a.can_login,
      a.last_seen_at,
      a.last_promo_at,
      a.last_receipt_at,
      COUNT(DISTINCT CASE
        WHEN o.service = 'Uber Eats'
          AND o.observed_live = 1
          AND o.status = 'active'
          AND (o.expires IS NULL OR o.expires >= date('now'))
        THEN o.offer_id
      END) AS active_promo_count,
      COUNT(DISTINCT r.receipt_id) AS order_count,
      COALESCE(SUM(DISTINCT COALESCE(r.promotion_discount, 0)), 0) AS promo_savings_hint
    FROM accounts a
    LEFT JOIN offers o ON o.account_ref = a.account_ref
    LEFT JOIN receipts r ON r.account_ref = a.account_ref
    GROUP BY a.account_ref
    ORDER BY a.can_login DESC, active_promo_count DESC, a.last_seen_at DESC
  `).all().map(row => ({
    accountRef: row.account_ref,
    accountMasked: row.masked,
    canLogin: Boolean(row.can_login),
    lastSeenAt: row.last_seen_at,
    lastPromoAt: row.last_promo_at,
    lastOrderAt: row.last_receipt_at,
    activePromoCount: Number(row.active_promo_count || 0),
    orderCount: Number(row.order_count || 0)
  }));
}
