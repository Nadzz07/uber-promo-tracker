import assert from "node:assert/strict";
import {
  dedupeMboxMessages,
  normaliseForwardedUberMessage,
  parseMboxText
} from "./mbox-import.js";
import { parseUberEatsReceipt } from "./receipt-parser.js";
import { parseUberTransportReceipt } from "./transport-receipt-parser.js";
import { receiptFingerprint, transportReceiptFingerprint } from "./identity.js";

const directMbox = [
  "From sender@example.invalid Tue Oct  6 10:00:00 2026",
  "From: Uber Receipts <noreply@uber.com>",
  "To: receipt-account@example.invalid",
  "Date: Tue, 6 Oct 2026 10:00:00 +0100",
  "Message-ID: <receipt-1@uber.com>",
  "Subject: =?UTF-8?Q?Your_order_with_Example_Kitchen?=",
  "Content-Type: text/plain; charset=utf-8",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  "Thanks for your order",
  "Subtotal =C2=A325.00",
  "Total =C2=A312.00",
  ""
].join("\n");

const parsed = await parseMboxText(directMbox);
assert.equal(parsed.length, 1);
assert.equal(parsed[0].sender, "Uber Receipts <noreply@uber.com>");
assert.equal(parsed[0].recipient, "receipt-account@example.invalid");
assert.equal(parsed[0].subject, "Your order with Example Kitchen");
assert.match(parsed[0].body, /Subtotal £25\.00/);

// Large mailbox consumers can process evidence without retaining the mailbox in RAM.
const streamed = [];
const collected = await parseMboxText(directMbox + directMbox, {
  onMessage: async message => { await Promise.resolve(); streamed.push(message); }
});
assert.deepEqual(collected, []);
assert.deepEqual(streamed, [parsed[0], parsed[0]]);
await assert.rejects(parseMboxText(directMbox, {
  onMessage: async () => { throw new Error("Evidence sink failed"); }
}), /Evidence sink failed/);

const forwarded = normaliseForwardedUberMessage({
  sender: "Owner <owner@gmail.com>",
  recipient: "archive@gmail.com",
  subject: "Fwd: Your order with Example Kitchen",
  sentAt: "2026-10-06T12:00:00.000Z",
  body: [
    "---------- Forwarded message ---------",
    "From: Uber Receipts <noreply@uber.com>",
    "Date: Tue, 6 Oct 2026 at 10:00",
    "Subject: Your order with Example Kitchen",
    "To: <receipt-account@example.invalid>",
    "Thanks for your order",
    "Subtotal £25.00",
    "Total £12.00"
  ].join("\n")
});
assert.equal(forwarded.forwardedByUser, true);
assert.equal(forwarded.sender, "Uber Receipts <noreply@uber.com>");
assert.equal(forwarded.recipient, "receipt-account@example.invalid");
assert.equal(forwarded.subject, "Your order with Example Kitchen");
assert.equal(forwarded.sentAt, "2026-10-06T09:00:00.000Z");


const combinedSaving = parseUberEatsReceipt({
  sender: "Uber Receipts <noreply@uber.com>",
  recipient: "receipt-account@example.invalid",
  subject: "Your order with Example Kitchen",
  body: [
    "Thanks for your order",
    "Subtotal £25.00",
    "£13.28 Uber One savings and other promotions applied",
    "Total £11.72"
  ].join("\n"),
  sentAt: "2026-10-06T10:20:00.000Z"
});
assert.equal(combinedSaving.isReceipt, true);
assert.equal(combinedSaving.reportedSavings, 13.28);
assert.equal(combinedSaving.uberOneSavings, null, "combined savings must not be labelled Uber One-only");
assert.equal(combinedSaving.promotionDiscount, null, "combined savings must not consume a specific promo");

const duplicated = dedupeMboxMessages([
  { ...parsed[0] },
  { ...parsed[0] }
]);
assert.equal(duplicated.length, 1);


const orderDetails = [
  "Thanks for your order",
  "24 Jun 2026 18:30",
  "Order details",
  "Uber Delivery",
  "19:24 - Pick-up",
  "19:55 - Delivery",
  "Total £16.23"
].join("\n");
const orderOriginal = parseUberEatsReceipt({
  sender: "Uber Receipts <noreply@uber.com>",
  recipient: "receipt-account@example.invalid",
  subject: "Your Wednesday evening order with Uber Eats",
  body: orderDetails,
  sentAt: "2026-06-24T19:00:00.000Z"
});
const orderRefund = parseUberEatsReceipt({
  sender: "Uber Receipts <noreply@uber.com>",
  recipient: "receipt-account@example.invalid",
  subject: "Your Wednesday evening order with Uber Eats",
  body: orderDetails.replace("Total £16.23", "Previous total £16.23\nRefund -£4.60\nNew total £11.63"),
  sentAt: "2026-06-24T20:26:00.000Z"
});
assert.ok(orderOriginal.orderKey);
assert.equal(orderRefund.total, 11.63, "Updated receipt must use the new total, not Previous total");
assert.equal(orderRefund.orderKey, orderOriginal.orderKey);
assert.equal(
  receiptFingerprint({ ...orderOriginal, accountRef: "A001" }),
  receiptFingerprint({ ...orderRefund, accountRef: "A001" }),
  "updated/refunded Eats receipts for one order must dedupe"
);

const bikeBody = [
  "Thanks for choosing LIME bike",
  "Bike number 48192",
  "Trip details",
  "Tuesday, 6 October 2026",
  "10:05",
  "10:19",
  "2.4 miles",
  "14 minutes",
  "Total £4.50"
].join("\n");

const bikeOriginal = parseUberTransportReceipt({
  sender: "Uber Receipts <noreply@uber.com>",
  recipient: "receipt-account@example.invalid",
  subject: "Uber: Your receipt",
  body: bikeBody,
  sentAt: "2026-10-06T10:20:00.000Z"
});
assert.equal(bikeOriginal.isReceipt, true);
assert.equal(bikeOriginal.transportMode, "bike");
assert.ok(bikeOriginal.tripKey);

const bikeRefund = parseUberTransportReceipt({
  sender: "Uber Receipts <noreply@uber.com>",
  recipient: "receipt-account@example.invalid",
  subject: "Uber: Your updated receipt",
  body: bikeBody.replace("Total £4.50", "Total £2.50"),
  sentAt: "2026-10-06T12:20:00.000Z"
});
assert.equal(bikeRefund.isReceipt, true);
assert.equal(bikeRefund.tripKey, bikeOriginal.tripKey);

const a = transportReceiptFingerprint({ ...bikeOriginal, accountRef: "A001" });
const b = transportReceiptFingerprint({ ...bikeRefund, accountRef: "A001" });
assert.equal(a, b, "refund/update emails for one trip must dedupe");

const rideDetails = [
  "Thanks for riding with Uber",
  "Trip details",
  "Tuesday, 6 October 2026",
  "10:05",
  "10:19",
  "UberX",
  "2.4 miles",
  "14 minutes",
  "Total £14.50"
].join("\n");
const rideA = parseUberTransportReceipt({
  sender: "Uber Receipts <noreply@uber.com>",
  recipient: "receipt-account@example.invalid",
  subject: "Your Tuesday morning trip with Uber",
  body: rideDetails,
  sentAt: "2026-10-06T10:20:00.000Z"
});
const rideB = parseUberTransportReceipt({
  sender: "Uber Receipts <noreply@uber.com>",
  recipient: "receipt-account@example.invalid",
  subject: "Your updated trip with Uber",
  body: rideDetails.replace("Total £14.50", "Total £11.50"),
  sentAt: "2026-10-06T13:20:00.000Z"
});
assert.equal(rideA.isReceipt, true);
assert.equal(rideB.isReceipt, true);
assert.ok(rideA.tripKey);
assert.equal(
  transportReceiptFingerprint({ ...rideA, accountRef: "A001" }),
  transportReceiptFingerprint({ ...rideB, accountRef: "A001" })
);

console.log("✓ Private MBOX import, forwarded receipts, Lime bikes and trip-update dedupe");
