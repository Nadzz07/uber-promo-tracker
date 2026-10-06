import { publicOfferTitle } from "./public-promo.js";

const forbidden = /^(?:alias|email|accountAlias|code|promo_code|promoCode|recipient|sender|subject|body|bodyText|body_text|evidence|evidence_json|merchant|orderId|tripId|messageId|messageKey|mailbox|sourceMailbox)$/i;
const email = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const masked = /[a-z0-9._%+-]{0,2}…[a-z0-9._%+-]{0,2}@[a-z0-9.-]+\.[a-z]{2,}/gi;

export function assertPublicSnapshot(payload, history, privateValues = []) {
  function visit(value) {
    if (Array.isArray(value)) return value.forEach(visit);
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (forbidden.test(key)) throw new Error("Public snapshot contains a private field.");
        visit(child);
      }
    } else if (typeof value === "string" && email.test(value.replace(masked, ""))) {
      throw new Error("Public snapshot contains an unmasked email address.");
    } else if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error("Public snapshot contains a non-finite number.");
    }
  }
  if (!Array.isArray(payload?.promos) || !Array.isArray(payload?.accounts) || !Array.isArray(history?.records)) {
    throw new Error("Invalid public snapshot structure.");
  }
  visit(payload); visit(history);
  for (const promo of [...payload.promos, ...history.records]) {
    if (promo.title !== publicOfferTitle(promo)) throw new Error("Public title must be built from offer fields.");
    if (promo.service !== "Uber Eats") throw new Error("Only Eats offers may be published.");
    if (/^demo-/i.test(promo.id || "")) throw new Error("Test records cannot be published.");
  }
  if (payload.demo === true || payload.source === "demo") throw new Error("Test data cannot be published.");
  const serialized = JSON.stringify([payload, history]).toLowerCase();
  for (const secret of privateValues.filter(Boolean)) {
    if (serialized.includes(String(secret).toLowerCase())) {
      throw new Error("Public snapshot contains private source data.");
    }
  }
  if (payload.generatedAt && history.updatedAt !== payload.generatedAt) {
    throw new Error("Public snapshot and history are from different generations.");
  }
}
