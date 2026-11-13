// Owner-supplied exclusion corpus. Every subject here was explicitly listed by
// the owner as unwanted. Each must be binned and never mistaken for a receipt,
// a login code, a preferred offer or a grocery/product advert to keep.
import assert from 'node:assert/strict';
import {explicitMailDecision,mailIdentityExclusion,isReceiptMail} from './mail-review-rules.js';

const base={sender:'Uber Eats <noreply@uber.com>',recipient:'a@icloud.com',sentAt:'2026-11-10T12:00:00Z',receivedAt:'2026-11-10T12:00:01Z'};
const promo='Unsubscribe from these emails at any time.';

// [subject, extra body needed by that rule]
const CASES=[
 ['Diwali treats are here 🪔',promo],
 ['Bonfire Night plans? We have you covered',promo],
 ['Your shortcut for spooky season 🎃',promo],
 ["£10 off A'la Pizza",'Order from A\'la Pizza. '+promo],
 ['No tricks, just treats on Uber Eats 🎃',promo],
 ["See what's trending at Waitrose Stratford City and more!",promo],
 ['Save £11 on groceries 🥑🛒',promo],
 ['Fuel up the squad 🍕',promo],
 ['Not ordered in a while? Let us treat you',promo],
 ['Member Days: Deal drop 2 inside…',promo],
 ['Help us improve at Uber | take a quick survey',promo],
 ['We’ve updated our Terms & Conditions',promo],
 ['Earn 10% Uber One credit on rides',promo],
 ["4-for-2 at Burger King? That's a win 🏆",promo],
 ['🚗 Loved ones on the go? Take charge',promo],
 ['Uber One Exclusive: 40% off top picks 🔥',promo],
 ['Info about cancellation and wait time policies',promo],
 ['Uber One Exclusive: 40% off',promo],
 ['Say hello to Uber Electric',promo],
 ['Grab £5 off your first in-app train ticket🚆',promo],
 ['Get to the airport with ease ✈️',promo],
 ['Make your next work trip a breeze 🛫',promo],
 ['Get £8 off your next order. With a minimum spend of £25',promo],
 ['Whatever your plans or budget, order on Uber Eats',promo],
 ['50% off all your local favourites',promo],
 ['Unlock 25% off your next eats order','Complete two qualifying orders of £15 or more to unlock 25% off. '+promo],
 ['Left something behind?','We can courier your forgotten item to you. '+promo]
];

const failures=[];
for(const [subject,body] of CASES){
 const message={...base,subject,body};
 // Protection checks must never fire on these ordinary marketing subjects.
 assert.equal(isReceiptMail(message),false,`Not a receipt: ${subject}`);
 assert.equal(mailIdentityExclusion(message),null,`Not a security email: ${subject}`);
 const decision=explicitMailDecision(message,Date.parse('2026-11-12T12:00:00Z'));
 const destination=decision?.destination??null;
 if(destination!=='Bin')failures.push({subject,destination,category:decision?.category??'none',reason:decision?.reason??'no rule matched'});
}

if(failures.length){
 console.error('Owner-exclusion corpus gaps:\n');
 for(const f of failures)console.error(`  ✗ "${f.subject}"\n      -> ${f.destination??'leave in place'} (${f.category}) ${f.reason}`);
 console.error(`\n${failures.length} of ${CASES.length} not binned`);
 process.exit(1);
}
console.log(`✓ Owner exclusion corpus: all ${CASES.length} named campaigns, merchant/grocery offers, policy notices, surveys and prerequisite offers bin immediately; none mistaken for receipts, login codes or preferred offers`);
