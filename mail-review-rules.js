// Owner-reviewed Mail policy. Pure decisions; this module cannot move Mail.
import {analyseSender} from './parser-v2/sender.js';
import {parseUberPromo} from './parser.js';
import {parseUberEatsReceipt} from './receipt-parser.js';
import {parseUberTransportReceipt} from './transport-receipt-parser.js';
import {receiptText,hasForwardedReceiptClaims} from './receipt-text.js';
import {extractAccountAlias} from './parser-v2/utils.js';
import {offerFingerprint} from './identity.js';
import {applyOfferExpiryPolicy,expiryEndTime} from './offer-time.js';

export const MAIL_REVIEW_RULE_VERSION=4;
const at=v=>v&&Number.isFinite(Date.parse(v))?Date.parse(v):null;
const positive=v=>typeof v==='number'&&Number.isFinite(v)&&v>0;
const decision=(category,reason,destination=null,extra={})=>({category,reason,destination,...extra});

export function mailIdentityExclusion(message){
 const subject=String(message.subject||''),text=receiptText(subject,message.body);
 const digits=/\b\d{4,8}\b|\b\d{3}[ -]\d{3}\b/.test(text);
 const codeSubject=/\b(?:uber(?: eats)? code|(?:verification|security|login|sign[ -]?in|one[ -]?time|authentication) code)\b/i.test(subject);
 const authSubject=/\b(?:log[ -]?in|sign[ -]?in|verify|verification|one[ -]?time|authentication)\b/i.test(subject);
 const authCodeLabel=/\b(?:verification|security|login|sign[ -]?in|one[ -]?time|authentication) code\b/i.test(text);
 const nearCode=/\b(?:code|otp|pin)\s*(?:is|:|=|-)?\s*(?:\d{4,8}\b|\d{3}[ -]\d{3}\b)|\b(?:\d{4,8}|\d{3}[ -]\d{3})\s+is\s+your\s+(?:uber(?: eats)?\s+|verification\s+|login\s+)?code\b/i.test(text);
 const strongCodeSubject=/\b(?:verification|login|sign[ -]?in|one[ -]?time|authentication) code\b/i.test(subject);
 if(digits&&(strongCodeSubject||(codeSubject||authCodeLabel||authSubject)&&nearCode||codeSubject&&/\b\d{6,8}\b|\b\d{3}[ -]\d{3}\b/.test(text)))return 'excluded_login_code';
 if(/phone|mobile|telephone/i.test(subject)&&/number/i.test(text)&&/chang|updat|added|removed|new number/i.test(text))return 'excluded_phone_update';
 return null;
}

export function isMarketingOnlyOrderThanks(message){
 const subject=String(message.subject||''),text=receiptText(subject,message.body);
 if(!/\bthanks for ordering[!.]?$/i.test(subject.trim()))return false;
 const template=/pan to plate with just a few taps/i.test(text)&&/explore top eats|make your own masterpiece|browse all/i.test(text)&&/\bunsubscribe\b/i.test(text);
 const transaction=/\b(?:order|trip|ride|receipt|invoice)\s*(?:id|number|#|details|date)\b|\b(?:total paid|amount charged|fare breakdown|payment method\s*(?:[:\-]|(?:Visa|Mastercard|PayPal|Apple Pay|Uber Cash|Cash|Card)\b)|card ending|order placed)\b|\bsubtotal\s*[:£]/i.test(text);
 return template&&!transaction;
}

export function isReceiptMail(message){
 const subject=String(message.subject||''),text=receiptText(subject,message.body);
 const candidate=/\breceipt\b|thanks for|(?:trip|order|ride) (?:details|total|id|number)|fare breakdown|amount charged/i.test(subject+'\n'+text)||/^your .{0,80}(?:trip|ride|order)\b/i.test(subject);
 if(!candidate)return false;
 if(parseUberEatsReceipt(message).isReceipt||parseUberTransportReceipt(message).isReceipt)return true;
 if(isMarketingOnlyOrderThanks(message))return false;
 return /\breceipt\b|thanks for (?:your order|ordering|riding)|^your\s+(?:(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening|late-night|early)\s+){1,5}(?:trip|ride|order)\b/i.test(subject);
}

// Explicit owner instructions of 4 November: generic advertising is discarded
// immediately; all Eurostar campaigns go to their dedicated mailbox.
function sourceConfirmedExpiry(promo){
 if(promo.expiryStatus!=='exact')return null;
 const source=String(promo.evidence?.expiry||'');
 const fullDate=/\b\d{1,2}(?:st|nd|rd|th)?\s+(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+20\d{2}\b|\b\d{1,2}[/.\-]\d{1,2}[/.\-]20\d{2}\b/i.test(source);
 return fullDate?expiryEndTime(applyOfferExpiryPolicy(promo)):null;
}
function oneCalendarMonthBefore(now){const d=new Date(now),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()-1);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));return d.getTime();}
// These are categories, not just a blacklist of remembered titles. Call only
// after sender, receipt, identity and genuine Eurostar protections have run.
function ownerMarketingPreference(message,text){
 const subject=String(message.subject||'').normalize('NFKC').replace(/[’‘]/g,"'").trim();
 const clean=text.replace(/&(?:shy|zwnj|zwj|#(?:847|8199|8204|8205|65279));/gi,' ').replace(/\s+/g,' '),lead=clean.slice(0,2400);
 const bin=(category,reason)=>decision(category,reason,'Bin');
 if(/\b(?:order|trip|ride|delivery) confirmation\b|\b(?:order|trip|ride|delivery)\b.{0,100}\b(?:confirmed|cancelled|canceled|delivered|refunded)\b/i.test(subject))return decision('protected_transaction_notice','Order confirmation, delivery or cancellation notice, not grocery or merchant advertising.');
 // Actual billing, security and credit records are not membership advertising.
 if(/\b(?:payment (?:failed|declined|received)|billing (?:problem|issue)|refund|invoice|amount charged|credits? (?:added|received)|membership (?:cancelled|canceled|ended))\b/i.test(subject))return decision('protected_transaction_notice','Actual billing, refund or credited-balance notice; the owner exclusions concern advertising.');
 if(/^(?:we've|we have) updated our terms (?:&|and) conditions\b|^(?:info(?:rmation)? about|updates? to) cancellation and wait(?:ing)? time policies\b/i.test(subject))return bin('owner_excluded_policy_notice','Owner requested general terms, cancellation and wait-time policy notices in Bin.');
 if(/\b(?:diwali|bonfire|halloween|spooky season|spook-tacular)\b|no tricks,? just treats/i.test(subject))return bin('owner_excluded_seasonal_marketing','Owner excludes seasonal Diwali, Bonfire and Halloween advertising.');
 const survey=/\bsurvey\b|\b(?:share|tell us) (?:your |what you think)|\b(?:feedback|your opinion|how did we do|help us improve)\b/i.test(subject)||/\b(?:complete|take|answer|participate in) (?:our |this |a |the )?(?:short |quick )?survey\b/i.test(lead);
 if(survey){
  const incentive=/\b(?:reward|voucher|gift card|cashback|incentive|prize|win|draw|compensat|paid survey)\b|£\s*\d/i.test(clean);
  const noReward=/\b(?:no (?:reward|compensation|incentive)|unpaid survey|not (?:paid|compensated))\b/i.test(clean);
  if(!incentive||noReward)return bin('owner_excluded_unrewarded_survey','Owner excludes surveys without a reward.');
  const guaranteed=/\b(?:complete|take|finish|answer)\b.{0,120}\b(?:receive|get|earn|be paid)\b.{0,50}(?:£\s*\d|voucher|gift card)|(?:£\s*\d|voucher|gift card).{0,50}\b(?:for your time|for completing|after (?:you )?(?:complete|finish))/i.test(clean)&&!/\b(?:chance to win|prize draw|sweepstake|raffle)\b/i.test(clean);
  if(guaranteed)return decision('keep_rewarded_survey','Survey explicitly promises a reward for completion; owner only excludes unrewarded surveys.');
  // A prize draw or unclear promise is a question for the owner, not consent.
  return decision('review','Survey mentions an incentive; ask the owner using its email title before moving it.',null,{ownerQuestion:true});
 }
 if(/\b(?:grocer(?:y|ies)|supermarket|fresh fruit|fruit (?:&|and) veg|vegetables)\b|\b(?:Waitrose|Sainsbury's|Tesco|Asda|Morrisons|Ocado|Iceland|Aldi|Lidl)\b/i.test(subject))return bin('owner_excluded_grocery','Owner excludes all grocery and supermarket offer advertising.');
 if(/\b(?:offer|discount|promotion) (?:is |only )?(?:valid|available|applies) (?:only )?(?:on|for) grocery (?:orders|shops)\b|\b(?:get|save)\s+(?:up to\s+)?£\s*\d+(?:\.\d+)?\s+off\s+(?:your\s+)?(?:next\s+)?grocer/i.test(lead))return bin('owner_excluded_grocery','The primary offer is for grocery orders, which the owner excludes.');
 if(/\bUber One Exclusive\b|\bMember Days\b|^Earn\s+(?:up to\s+)?\d+%\s+Uber One credits?\b/i.test(subject))return bin('owner_excluded_membership_offer','Owner excludes Uber One and Member Days offer advertising, including credit-earning campaigns.');
 const merchant=subject.match(/(?:£\s*\d+(?:\.\d+)?|\d+\s*%)\s+off\s+(?:(at|from)\s+)?(.+)$/i);
 const generic=/^(?:your|our|next|first|all|every|each|any|an?\s|the\b|up to|on\b|Uber\b|meals?\b|orders?\b|deliver(?:y|ies)\b|food\b|eats\b|restaurants?\b|\d)/i;
 if(merchant&&(merchant[1]&&!/^(?:selected|participating|eligible) restaurants?\b/i.test(merchant[2])||/^[A-ZÀ-ÖØ-Þ]/u.test(merchant[2])&&!generic.test(merchant[2]))||/\b\d+\s*[-–]?for[-–]?\s*\d+\s+at\s+/i.test(subject)||/\b(?:all your |your )?local favourites\b/i.test(subject))return bin('owner_excluded_merchant_offer','Owner excludes named-shop, product and local-shop-only deals. Generic selected-restaurant personal offers remain eligible.');
 if(/\b(?:your shortcut for spooky season|fuel up the squad|not ordered in a while|whatever your plans or budget)\b/i.test(subject))return bin('owner_excluded_discovery_marketing','Owner excludes this discovery or re-engagement advertising category.');
 if(/\bleft something behind\b/i.test(subject)&&/\b(?:courier|send|parcel|package)\b/i.test(clean)){if(/\bunsubscribe\b/i.test(clean))return bin('generic_courier_marketing','Owner excludes courier advertising, including forgotten-item delivery promotions.');return decision('review','Courier wording might be an actual lost-item notice; ask the owner using its title before moving it.',null,{ownerQuestion:true});}
 if(/\b(?:loved ones on the go|say hello to Uber Electric|get to the airport with ease|make your next work trip a breeze)\b/i.test(subject))return bin('generic_transport_marketing','Owner excludes travel, airport, work-trip and Uber Electric advertising.');
 if(/\bunlock\s+25%\s+off\b/i.test(subject)&&/\b(?:complete|place|make)\s+(?:two|2)\s+(?:qualifying\s+)?orders?\b/i.test(clean))return bin('owner_excluded_prerequisite_reward','Owner excludes offers that first require completing two qualifying orders to unlock a later discount.');
 return null;
}
export function explicitMailDecision(message,now=Date.now()){
 const subject=String(message.subject||''),text=receiptText(subject,message.body),sender=analyseSender(message.sender),address=String(message.sender||'').match(/<?([a-z0-9._%+-]+@([a-z0-9.-]+))>?(?:\s*)$/i),domain=address?.[2]?.toLowerCase();
 const eurostarSender=domain==='eurostar.com'||domain?.endsWith('.eurostar.com');
 if(isReceiptMail(message))return null;
 if(!(sender.trusted===true&&sender.confidence==='high')&&!eurostarSender)return null;
 if(mailIdentityExclusion(message)||hasForwardedReceiptClaims(subject,message.body))return null;
 if(isMarketingOnlyOrderThanks(message))return decision('generic_membership_marketing','The thanks-for-ordering subject is a marketing template, without transaction details; not a receipt.','Bin');
 if(/\breceipt\b|thanks for (?:your order|riding)|^your (?:trip|ride) (?:with|on)\b/i.test(subject)||/\b(?:order id|trip id|total paid|fare breakdown|ride total)\b/i.test(text.slice(0,2500)))return null;
 if(/\bEurostar\b/i.test(subject)||eurostarSender)return decision('eurostar_folder','Owner requested all Eurostar emails in the Eurostar mailbox.','Eurostar');
 if(/\b(?:trains?|coach(?:es)?|Lumo|GWR)\b/i.test(subject)||/Go green on your next adventure/i.test(subject))return decision('generic_transport_marketing','General train or coach advertising is not a Eurostar campaign: owner requested Bin.','Bin');
 if(/Sainsbury.s|Pet Week|10% Back on every flight|30% off\? Yes, please|^Limited-time deals$|Stay home, JOE.s coming over|spook-tacular £3 treat|50% off fresh fruit|Chico.s Brick Lane|£10 off pickup orders over £25/i.test(subject))return decision('owner_excluded_campaign','Owner explicitly requested this merchant, product, pickup or flight campaign in Bin.','Bin');
 if(/^(?:New device sign[ -]?in|New device log[ -]?in|Land\s*1K\s*bonus Avios|From pre-drinks to the after-party)/i.test(subject))return decision('explicit_excluded_campaign','Owner specifically requested this sign-in notice or advertising campaign in Bin.','Bin');
 if(/^(?:phone|security|password|payment|refund|invoice)|verification|sign[ -]?in|log[ -]?in/i.test(subject))return null;
 const ownerPreference=ownerMarketingPreference(message,text);if(ownerPreference)return ownerPreference;
 if(/^Book a table on Uber Eats and get a free ride(?:\s|[!🚗])*$/iu.test(subject.trim()))return decision('explicit_table_campaign','Owner specifically requested this table/free-ride campaign in Bin.','Bin');
 if(/\bBonfire Night\b/i.test(subject)&&/\bunsubscribe\b/i.test(text))return decision('owner_excluded_bonfire','Owner requested Bonfire Night advertising in Bin.','Bin');
 if(/\bCourier\b/i.test(subject)&&/\b(?:send|delivery|packages?|parcels?)\b/i.test(text)&&/\bunsubscribe\b/i.test(text))return decision('generic_courier_marketing','Courier service advertising is excluded generic Uber marketing.','Bin');
 if(/50% off Uber One for (?:1|one) month/i.test(subject)&&/sign up|membership|join/i.test(text))return decision('generic_membership_marketing','Membership signup advertising, not a personal Eats offer or receipt.','Bin');
 if(/^(?:Thanking NHS workers|A reminder of our thank you to NHS heroes)$/i.test(subject)&&/link.{0,80}(?:NHS|HSC).{0,30}email|linked to a valid NHS/i.test(text)&&/send two promo codes|send two promotion codes/i.test(text))return decision('generic_eligibility_marketing','General eligibility/signup invitation; no personal redemption code has been issued in this email.','Bin');
 if(/30% off snacks at Co-op/i.test(subject)&&/30% off selected range|selected.{0,20}snacks/i.test(text))return decision('owner_excluded_campaign','Item-level Co-op snack advertising, excluded product promotion.','Bin');
 if(at(message.sentAt||message.receivedAt)==null)return null;
 const promo=parseUberPromo(message),scope=promo.evidence?.discountScope||promo.offerScope;
 if(promo.isPromo&&promo.service==='Uber Eats'&&promo.discountType==='fixed'&&promo.discount===8&&promo.minimumSpend===25)return decision('owner_excluded_8_off_25','Owner explicitly excludes £8 off a £25 minimum offer emails; existing tracker records stay intact.','Bin');
 if(promo.isPromo&&promo.service==='Uber Eats'&&promo.discountType==='fixed'&&promo.discount===15&&promo.minimumSpend===25)return decision('owner_excluded_15_off_25','Owner requested £15 off £25 offer emails in Bin; receipt and tracker history remain protected.','Bin');
 const sent=at(message.sentAt||message.receivedAt);
 const personalPercentageHeadline=/\d+%\s+off\s+your\s+(?:next|first)\s+(?:\d+\s+)?(?:meals?|orders?)\b/i.test(subject);
 if(promo.isPromo&&promo.service==='Uber Eats'&&promo.discountType==='percent'&&(scope==='order'||personalPercentageHeadline)&&sent!=null&&sent<oneCalendarMonthBefore(now))return decision('old_eats_percentage_email','Owner requested Eats percentage-off order emails older than one calendar month in Bin. Email age is not an assertion about expiry.','Bin');
 const genuineOrderTerms=promo.isPromo&&scope==='order'&&/\b(?:minimum spend|use (?:promo )?code|valid on .{0,20}orders|your next .{0,12}orders)\b/i.test(text);
 const redeemableOrderTerms=/\b(?:us(?:e|ing)|enter|apply)\s+(?:the\s+)?(?:promo(?:tional)?\s+)?code\b|\byour\s+(?:next|first)\s+.{0,28}(?:orders?|meals?)\b|\b(?:minimum spend|maximum discount|discount capped)\b/i.test(text);
 const discovery=/^(?:All the trusted picks|Crowd favourites, delivered|Feeling peckish\?|Restaurants everyone is loving|Satisfy your cravings|Widely loved and popular|Your favourites are calling|Delicious meal on your mind\? Let us help\.)$/i.test(subject.trim());
 const discoveryTemplate=/\b(?:Order from these restaurants near you|Check out these affordable options near you|Take a look at these trending restaurants|Order from these familiar favourites|Most popular restaurants near you|Budget-friendly restaurants near you|Help yourself to these restaurants)\b/i.test(text);
 if((discovery||discoveryTemplate)&&!redeemableOrderTerms)return decision('generic_marketing','Restaurant discovery advert with menu prices, not a personal redeemable offer.','Bin');
 if(/discount percentage varies per item|percentage off of the original price of the item/i.test(text)&&!redeemableOrderTerms)return decision('owner_excluded_campaign','Product and shopping advert: its terms describe item discounts, not a personal account offer.','Bin');
 if(/^Turn takeaways into getaways/i.test(subject)&&/collect Avios|British Airways Club/i.test(text))return decision('generic_marketing','Avios loyalty advertising, excluded by the owner.','Bin');
 if(promo.service==='Uber One'&&promo.discountType!=='uberCash'&&/\bunsubscribe\b/i.test(text)&&/\b(?:membership|annual plan|join Uber One|become a member|free trial|weeks? free|rejoin|try Uber One)\b/i.test(text))return decision('generic_membership_marketing','Membership signup, trial or upgrade advertising, not a receipt or personal Eats/Cash offer: owner requested Bin.','Bin');
 if(/^Earn Uber One credits thanks to Uber One/i.test(subject)&&/take a ride|eligible rides/i.test(text))return decision('ride_promotion','Ride loyalty advertising, not a receipt or an existing Cash balance.','Bin');
 const named=/^(?:Explore new restaurants on Uber Eats|One app, endless deals: meals and more|What are you in the mood for\?|Delicious meals for less|Budget[ -]friendly)/i.test(subject);
 if(named&&!genuineOrderTerms)return decision('generic_marketing','Owner explicitly excluded this general advertising campaign.','Bin');
 if(/top shopping (?:deals|offers)|half off your favou?rite burger|30(?:%| percent) off autumn favou?rites|50% off Tenders at Popeyes|off (?:at )?wagamama|off (?:KFC|Five Guys)|off select Taste the Difference|30p (?:deals|groceries)|Gordon Ramsay.s game plan/i.test(subject))return decision('owner_excluded_campaign','Merchant/product advertising, rather than the useful account-wide offers the owner keeps.','Bin');
 if(/^(?:Count on Uber for a reliable journey|You.ve got places to be and people to see|Introducing our new Audio Recording feature for riders|Reduce emissions with Uber Electric|Meet Uber Electric|Try a Wayve trip in London|Transform your passion into profit|Plan your Valentine.s escape on the Uber app|Go anywhere with Uber)|\bAvios\b/i.test(subject))return decision('generic_marketing','General Uber travel, feature or loyalty advertising: owner requested Bin.','Bin');

 if(promo.isPromo&&promo.service==='Uber')return decision('ride_promotion','Ride promotion identified from its terms, regardless of Uber Eats sender branding.','Bin');
 if(promo.isPromo&&promo.service==='Uber Eats'&&promo.discountType==='percent'&&promo.expiryStatus==='exact'&&!promo.evidence?.termsConflict){const end=sourceConfirmedExpiry(promo);if(end!=null&&end<=now)return decision('expired_eats_percentage','Source-confirmed expired Eats percentage offer: owner requested Bin, without inferring login access or receipt usage.','Bin');}
 if(promo.isPromo&&scope!=='product')return null;
 if(promo.evidence?.termsConflict||scope==='uncertain')return null;

 const marketing=/\bunsubscribe\b/i.test(text)&&/\b(?:restaurants?|meals?|groceries|order|shop|deals?|offers?|promotions?|discount|discover|explore|try|save)\b/i.test(subject+'\n'+text);
 if(marketing)return decision('generic_marketing','Generic Uber advertising without a supported account-level offer: bin immediately.','Bin');
 return null;
}

export function createMailReviewContext({accounts,snapshot,finance,receiptImported=()=>false,now=Date.now()}) {
 const byEmail=new Map(accounts.accounts.map(a=>[a.email.trim().toLowerCase(),a]));
 const publicIds=new Map(accounts.offerIdMigrations.map(m=>[m.from,m.to]));
 const offers=new Map(),receipts=new Map(finance.receipts.map(r=>[r.receiptId,r]));
 for(const offer of snapshot.promos){offers.set(offer.id,offer);for(const id of offer.previousOfferIds||[])if(!offers.has(id))offers.set(id,offer);}
 const matched=new Map();
 // Monetary similarity and lifetime account receipt counts are never matches.
 for(const m of finance.offerReceiptMatches||[]){const r=receipts.get(m.receiptId),p=offers.get(m.offerId);
  if(m.status!=='confirmed'||!r||!p||m.accountRef!==p.accountRef||r.accountRef!==p.accountRef)continue;
  if(!matched.has(p.id))matched.set(p.id,new Map());matched.get(p.id).set(r.receiptId,r);
 }
 const usage=p=>{
  const rows=[...(matched.get(p.id)?.values()||[])];
  if(p.discountType==='uberCash')return {known:['unused','partial','used'].includes(p.receiptState),used:rows.some(r=>positive(r.uberCashUsed)),count:null,full:false};
  const count=rows.length,total=p.usesVerified===true&&Number.isSafeInteger(p.uses)&&p.uses>0?p.uses:null;
  const full=total!=null&&count>=total;
  // No match does not prove no use; only an explicit complete matching state does.
  return {known:full||['unused','partial','used'].includes(p.receiptState),used:count>0,count,full};
 };
 const completed=new Set();for(const p of snapshot.promos)if(p.discountType!=='uberCash'&&usage(p).full)completed.add(p.accountRef);
 const resolve=(message,account,promo)=>{
  const privateId=offerFingerprint({...promo,accountRef:account.accountRef});
  const offer=offers.get(publicIds.get(privateId));
  if(offer?.accountRef!==account.accountRef)return null;
  // Codes can be reused. Different explicit validity windows are not duplicates.
  if(promo.code){
   const sent=at(message.sentAt||message.receivedAt),start=at(offer.firstEmailSentAt||offer.emailSentAt),end=expiryEndTime(applyOfferExpiryPolicy(offer));
   if(promo.expiryStatus==='exact'&&offer.expiryStatus==='exact'&&expiryEndTime(promo)!==end)return null;
   if(start==null||sent==null||sent<start||(end!=null&&sent>=end))return null;
  }
  return offer;
 };
 const cashOverlap=p=>snapshot.promos.some(c=>{
  if(c.accountRef!==p.accountRef||c.discountType!=='uberCash')return false;
  const start=at(p.firstEmailSentAt||p.emailSentAt),cashStart=at(c.firstEmailSentAt||c.emailSentAt);
  const end=expiryEndTime(applyOfferExpiryPolicy(p)),cashEnd=expiryEndTime(applyOfferExpiryPolicy(c));
  return start!=null&&cashStart!=null&&end!=null&&cashEnd!=null&&Math.max(start,cashStart)<Math.min(end,cashEnd);
 });
 return {byEmail,offers,usage,completed,resolve,cashOverlap,receiptImported,now};
}

export function reviewMailMessage(message,context){
 const subject=String(message.subject||''),text=receiptText(subject,message.body),sender=analyseSender(message.sender);
 const explicit=explicitMailDecision(message,context.now);if(explicit)return {...explicit,accountEmail:extractAccountAlias(message.recipient)};
 if(sender.trusted!==true||sender.confidence!=='high')return decision('review','Sender is not verified as Uber.');
 if(hasForwardedReceiptClaims(subject,message.body))return decision('review','Forwarded identity needs checking.');
 const alias=extractAccountAlias(message.recipient),account=context.byEmail.get(alias);
 if(!account||typeof account.canLogin!=='boolean')return decision('review','Account login access is not confirmed.');
 const common={accountRef:account.accountRef,accountEmail:alias};
 const result=(...args)=>({...decision(...args),...common});
 const receiptCandidate=/\breceipt\b|thanks for (?:your order|riding)|^your (?:trip|ride) (?:with|on)\b/i.test(subject)||(/\byour\b.*\b(?:trip|ride|order)\b/i.test(subject)&&!(/\b(?:off|discount|save|offer|promotion|next|first)\b/i.test(subject)))||/\b(?:order id|trip id|subtotal|total paid|payment summary|amount charged|fare breakdown|trip fare|ride total)\b/i.test(text.slice(0,2500));
 const eats=receiptCandidate?parseUberEatsReceipt(message):{isReceipt:false},ride=receiptCandidate&&!eats.isReceipt?parseUberTransportReceipt(message):null;
 const receipt=eats.isReceipt?eats:ride?.isReceipt?ride:null;
 const receiptLike=Boolean(receipt)||/\breceipt\b|thanks for (?:your order|riding)|^your (?:trip|ride) (?:with|on)\b/i.test(subject);
 if(receiptLike){
  if(!receipt||!context.receiptImported(message,receipt,account))return result('review','Receipt must be imported and verified before filing.');
  return result('file_receipt','Receipt is already saved in the tracker.','Uber Receipts');
 }
 const identityExclusion=mailIdentityExclusion(message);
 if(identityExclusion)return result(identityExclusion,identityExclusion==='excluded_login_code'?'Login verification code: leave in its current folder.':'Phone-number update: leave in its current folder.');
 if(account.canLogin===false)return result('inaccessible_other','Cannot log in: bin other Uber emails immediately.','Bin');
 if(/\bEurostar\b/i.test(subject))return result('excluded_eurostar','Accessible account: Eurostar is excluded; leave where it is.');
 const promo=parseUberPromo(message),scope=promo.evidence?.discountScope||promo.offerScope;
 if(promo.evidence?.termsConflict||promo.termsConflict)return result('review','Offer terms conflict; leave for review.');
 // The parser identifies the service from source terms. No headline-only ride test.
 if(promo.isPromo&&promo.service==='Uber')return result('ride_promotion','Ride promotions are excluded from useful offers.','Bin');
 const offer=promo.isPromo?context.resolve(message,account,promo):null;
 if(promo.isPromo&&promo.service==='Uber Eats'&&promo.discountType==='percent'&&scope!=='uncertain'){
  const sourceEnd=sourceConfirmedExpiry(promo);
  const campaignEnd=offer?.expiryStatus==='exact'&&offer.expiryConfidence==='confirmed'?expiryEndTime(applyOfferExpiryPolicy(offer)):null;
  if(sourceEnd!=null&&campaignEnd!=null&&sourceEnd!==campaignEnd)return result('review','Source and campaign expiry disagree; do not assume expired.');
  const end=sourceEnd??campaignEnd;
  if(end==null)return result('review','Eats percentage expiry is unknown, inferred or estimated; leave for review.');
  return end<=context.now?result('expired_eats_percentage','Owner requested expired Eats percentage promotions in Bin; imported history stays saved.','Bin'):result('current_eats_percentage','Keep unexpired Eats percentage offers in Inbox for a possible later Cash combination.','Inbox');
 }
 if(promo.isPromo&&(!offer||scope==='uncertain'))return result('review','Offer campaign identity is not established.');
 if(offer){
  const u=context.usage(offer),end=expiryEndTime(applyOfferExpiryPolicy(offer));
  const expiryKnown=offer.expiryStatus==='exact'&&end!=null,expired=expiryKnown&&end<=context.now;
  const preferred=offer.service==='Uber Eats'&&offer.discountType==='fixed'&&[10,12,15].includes(offer.discount)&&offer.minimumSpend===15&&offer.minimumSpendVerified===true;
  const cash=offer.discountType==='uberCash',percent=offer.service==='Uber Eats'&&offer.discountType==='percent';
  const extra={offerId:offer.id,offerTitle:offer.title,family:offer.id};
  if((preferred||cash||percent)&&u.used&&(u.full||expired||cash))return result('retain_one_used_offer','Used offer: archive the latest source and bin campaign duplicates.','Archive',{...extra,deduplicate:true});
  if((preferred||cash||percent)&&expired&&u.known&&!u.used)return result('expired_unused_offer','Expired offer is explicitly known to be unused.','Bin',extra);
  if(!u.known&&expired)return result('review','Expired offer usage is unknown; do not assume unused.',null,extra);
  if(percent){
   if(context.cashOverlap(offer))return result('keep_percentage_cash','Eats percentage and Cash have overlapping dates; compatibility and usage remain separate.',null,extra);
   return result('review','Eats percentage offer has no verified overlapping Cash campaign.',null,extra);
  }
  if(preferred||cash)return result('keep_current_offer','Offer still has uses or requires usage review; keep its emails.',null,extra);
 }
 if(context.completed.has(account.accountRef))return result('completed_account_other','Tracked promo is receipt-confirmed fully used: bin other Uber emails.','Bin');
 return result('review','No receipt-confirmed promo completion; leave other mail for review.');
}

// Two passes let the latest physical source win globally across all folders.
export function campaignWinner(current,candidate){
 const score=s=>[at(s.message.sentAt)||at(s.message.receivedAt)||0,/^archive$/i.test(s.path.at(-1))?1:0,JSON.stringify([s.accountId,s.path,s.nativeId])];
 if(!current)return candidate;
 const a=score(current),b=score(candidate);for(let i=0;i<a.length;i++){if(a[i]===b[i])continue;return b[i]>a[i]?candidate:current;}return current;
}
export function finalizeMailDecision(source,classification,winner){
 if(!classification.deduplicate)return classification;
 const same=winner&&winner.accountId===source.accountId&&JSON.stringify(winner.path)===JSON.stringify(source.path)&&winner.nativeId===source.nativeId;
 return same?classification:{...classification,category:'duplicate_used_offer',reason:'Duplicate of the same used campaign; latest email is retained in Archive.',destination:'Bin',retentionProof:{accountId:winner.accountId,messageId:winner.message.messageId,raw:winner.sourceRaw||winner.raw}};
}
