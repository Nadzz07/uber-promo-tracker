import assert from 'node:assert/strict';
import {weeklySavingsData,weeklySavingsGeometry} from './weekly-savings.js';
const now=new Date('2026-11-07T13:00:00Z');
const empty=weeklySavingsData({},now);assert.equal(empty.length,5);assert.deepEqual(empty.map(w=>w.start),['2026-10-04','2026-10-11','2026-10-18','2026-10-25','2026-11-01']);assert.deepEqual(empty.map(w=>w.value),[0,0,0,0,0]);
const base={accountRef:'TEST',service:'Uber Eats',total:10,uberCashUsed:8,promotionDiscount:2};const receipts=Array.from({length:20},(_,i)=>({...base,receiptId:'r'+i,orderDate:'2026-11-02'}));
const weeks=weeklySavingsData({data:{receipts:[...receipts,receipts[0],{...base,receiptId:'ride',service:'Uber',orderDate:'2026-10-20',promotionDiscount:4},{...base,receiptId:'unknown',orderDate:'2026-10-30',promotionDiscount:null},{...base,receiptId:'future',orderDate:'2026-11-08',promotionDiscount:9999},{...base,receiptId:'old',orderDate:'2026-09-30',promotionDiscount:9999}]}},now);assert.equal(weeks.length,5);assert.deepEqual(weeks.map(w=>w.value),[0,0,4,0,40]);assert.equal(weeks[4].count,20);assert.equal(weeks[3].missing,1);assert.equal(weeks[4].value,40,'Uber Cash is excluded; receipts are deduplicated');
assert.deepEqual(weeklySavingsGeometry([0,0,0,0,0]).points.map(p=>p.y),[66,66,66,66,66]);
for(const values of [[1250.50,0,1,4,8],[0,0,0,0,1250.50],[0,7,0,0,0]]){const g=weeklySavingsGeometry(values);assert.equal(g.points.length,5);assert.deepEqual(g.points.map(p=>p.x),[10,92.5,175,257.5,340]);assert.equal(g.points[values.indexOf(Math.max(...values))].y,14);assert.equal((g.path.match(/ C /g)||[]).length,4);assert.doesNotMatch(g.path,/NaN|Infinity/);assert.ok(g.fill.endsWith('L 340,74 L 10,74 Z'));}
const sunday=weeklySavingsData({},new Date('2026-11-08T10:00Z'));assert.equal(sunday[4].start,'2026-11-08');
const dst=weeklySavingsData({},new Date('2026-10-25T00:30Z'));assert.equal(dst[4].start,'2026-10-25');
console.log('✓ Five weekly SVG points: UK week boundaries/DST, zero padding, 20 receipts grouped into one week, dedupe, promo-only values, unknown coverage, future exclusion and £1,250.50 geometry.');
