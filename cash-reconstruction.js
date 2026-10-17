// Private ingestion only. Never add this module or allocation records to the
// public build. Original Mail and the financial ledger are read, never edited.
import {parseUberPromo} from './parser.js';
import {offerFingerprint} from './identity.js';
import {reconcileCashGrants,publicCashEstimate,summariseCash} from './cash-ledger.js';

export function reconstructCashEvidence(db,offers,receipts,now){
 const sources=[];
 for(const row of db.prepare(`SELECT m.*,a.alias FROM messages m JOIN accounts a USING(account_ref)
   WHERE m.accepted=1 AND m.kind='promo' AND (m.body_text LIKE '%uber cash%' OR m.subject LIKE '%uber cash%')
   ORDER BY m.sent_at,m.message_key`).all()){
  const p=parseUberPromo({subject:row.subject,body:row.body_text,sender:row.sender,recipient:row.alias,sentAt:row.sent_at,receivedAt:row.received_at,messageId:row.message_id});
  if(!p.isPromo||p.discountType!=='uberCash')continue;
  const source={...p,accountRef:row.account_ref,messageKey:row.message_key};source.offerId=offerFingerprint(source);sources.push(source);
 }
 const result=reconcileCashGrants(sources,receipts,{now}),annotations=new Map(),byAccount=new Map(),ids=new Set(offers.map(p=>p.offerId));
 for(const g of result.grants){
  if(!byAccount.has(g.accountRef))byAccount.set(g.accountRef,[]);if(g.service==='Uber Eats')byAccount.get(g.accountRef).push(g);
  const candidates=[...new Set(g.sourceOfferIds)].filter(id=>ids.has(id)),representative=candidates[0];
  for(const id of candidates)annotations.set(id,{cashTerms:{duration:g.terms.duration,unit:g.terms.unit,anchor:g.terms.anchor,excludesFees:g.terms.excludesFees},cashEstimate:representative===id?publicCashEstimate(g):{...publicCashEstimate(g),status:'duplicate',remaining:0}});
 }
 db.exec(`CREATE TABLE IF NOT EXISTS cash_reconciliation (account_ref TEXT PRIMARY KEY, ledger_json TEXT NOT NULL)`);
 const save=db.prepare('INSERT INTO cash_reconciliation VALUES(?,?) ON CONFLICT(account_ref) DO UPDATE SET ledger_json=excluded.ledger_json');
 for(const ref of new Set([...result.grants.map(g=>g.accountRef),...result.unallocated.map(u=>u.accountRef).filter(Boolean)]))save.run(ref,JSON.stringify({grants:result.grants.filter(g=>g.accountRef===ref),unallocated:result.unallocated.filter(u=>u.accountRef===ref)}));
 return {annotate:p=>{if(p.discountType!=='uberCash')return p;const addition=annotations.get(p.offerId)||{cashEstimate:{status:'needs_checking',remaining:null,issued:p.discount,expiresAt:null,allocation:'source_needs_checking'}};return {...p,...addition,receiptState:null,receiptConfirmedUses:0,usesRemaining:addition.cashEstimate.status==='estimated'&&addition.cashEstimate.remaining>0?1:0};},
  summary:ref=>summariseCash(byAccount.get(ref)||[])};
}
