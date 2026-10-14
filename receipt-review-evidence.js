import {createHash} from 'node:crypto';
import {receiptText,moneyForLabel} from './receipt-text.js';

// Private source metadata only. Never change receipt identity or monetary data.
export function receiptReviewEvidence(sources=[]) {
 const reasons=new Set(),totals=new Set(),financialVersions=new Set();
 for(const source of sources){
  const text=receiptText(source.subject,source.body_text??source.body),flat=text.replace(/\s+/g,' ').trim();
  if(/\b(?:your|the) refund (?:has been|was|is) (?:applied|issued|processed)\b/i.test(flat)||/\brefund(?:\s+adjustment)?\s*[:：]?\s*[−–-]?\s*£\s*\d/i.test(text))reasons.add('refund');
  if(/\b(?:adjusted|updated|revised|corrected) receipt\b/i.test(flat)||/\b(?:new|updated|revised) total\s*[:：]?\s*£\s*\d/i.test(flat)||/\b(?:fare|price|total) adjustment\s*[:：]?\s*[−–-]?\s*£\s*\d/i.test(text))reasons.add('adjusted_receipt');
  const total=moneyForLabel(text,['new total','updated total','final total','amount charged','total']).value;
  if(total!=null)totals.add(Math.round(total*100));
  // Duplicate deliveries and presentation-only changes must not reopen review.
  const version=[total,...['promotion','delivery fee','service fee','tip','uber cash','refund adjustment','refund','membership benefit','delivery discount','schedule savings','total savings'].map(label=>moneyForLabel(text,[label]).value)];
  if(version.some(value=>value!=null))financialVersions.add(JSON.stringify(version));
 }
 if(totals.size>1)reasons.add('changed_total');
 if(!reasons.size)return null;
 const revision=createHash('sha256').update(JSON.stringify([[...reasons].sort(),[...financialVersions].sort()])).digest('hex');
 return {reasons:[...reasons].sort(),revision};
}
