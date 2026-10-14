// Canonical owner-only SQLite history. Receipt imports never update this table.
import {randomUUID} from 'node:crypto';
import {validateFinancialCorrection,validateCashEntry,currentFinancialEvents,financialHistoryMetadata} from './receipt-financials.js';

function ledgerEvent(r){const {historyAction,historyTargetId,historyValueAt,...value}=JSON.parse(r.value_json);return {id:r.event_id,kind:r.kind,recordId:r.record_id,accountRef:r.account_ref,action:r.action,value,at:r.recorded_at,...financialHistoryMetadata({historyAction,historyTargetId,historyValueAt,at:r.recorded_at})};}

export function initFinancialLedger(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS financial_events (
    event_id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('receipt','cash')),
    record_id TEXT NOT NULL, account_ref TEXT NOT NULL, action TEXT NOT NULL CHECK(action IN ('set','undo')),
    value_json TEXT NOT NULL, recorded_at TEXT NOT NULL,
    FOREIGN KEY(account_ref) REFERENCES accounts(account_ref)
  );CREATE INDEX IF NOT EXISTS financial_events_record ON financial_events(kind,record_id,recorded_at);`);
}
export function readFinancialEvents(db) {
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='financial_events'").get())return [];
  return db.prepare('SELECT * FROM financial_events ORDER BY recorded_at,rowid').all().map(ledgerEvent);
}
export function appendFinancialEvent(db,input) {
  initFinancialLedger(db);
  if(!['receipt','cash'].includes(input.kind)||!['set','undo'].includes(input.action))throw new Error('Invalid financial action.');
  const recordId=String(input.recordId||''),accountRef=String(input.accountRef||'');
  if(!db.prepare('SELECT 1 FROM accounts WHERE account_ref=?').get(accountRef))throw new Error('Unknown private account.');
  if(input.kind==='receipt'&&!db.prepare('SELECT 1 FROM receipts WHERE receipt_id=? AND account_ref=? UNION ALL SELECT 1 FROM transport_receipts WHERE receipt_id=? AND account_ref=?').get(recordId,accountRef,recordId,accountRef))throw new Error('Receipt does not match this account.');
  if(input.kind==='cash'&&recordId!==accountRef)throw new Error('Cash balance must belong to the same account.');
  let value={};
  if(input.action==='set')value=input.kind==='receipt'?validateFinancialCorrection(input.value):validateCashBalance(input.value);
  const metadata=financialHistoryMetadata(input);
  const event={id:input.id||randomUUID(),kind:input.kind,recordId,accountRef,action:input.action,value,at:input.at||new Date().toISOString(),...metadata};
  if(!/^[a-z0-9-]{8,80}$/i.test(event.id)||!Number.isFinite(Date.parse(event.at))||Date.parse(event.at)>Date.now()+300000)throw new Error('Invalid financial history identity/date.');
  const existing=db.prepare('SELECT * FROM financial_events WHERE event_id=?').get(event.id);
  if(existing){const same=ledgerEvent(existing);if(JSON.stringify(same)!==JSON.stringify(event))throw new Error('Conflicting event with the same identity. History is preserved.');return same;}
  db.prepare('INSERT INTO financial_events VALUES(?,?,?,?,?,?,?)').run(event.id,event.kind,event.recordId,event.accountRef,event.action,JSON.stringify({...event.value,...metadata}),event.at);
  return event;
}
export const validateCashBalance=validateCashEntry;
export function mergeFinancialEvents(db,events) {
  if(!Array.isArray(events)||events.length>100000)throw new Error('Invalid private history.');
  db.exec('SAVEPOINT financial_merge');
  try{for(const event of events)appendFinancialEvent(db,event);db.exec('RELEASE financial_merge');}
  catch(error){db.exec('ROLLBACK TO financial_merge');db.exec('RELEASE financial_merge');throw error;}
  return currentFinancialEvents(readFinancialEvents(db));
}
