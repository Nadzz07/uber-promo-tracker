import fs from "node:fs/promises";
import { createHmac, randomBytes } from "node:crypto";

export function accountIdForAlias(alias, secret) {
  const normalized = String(alias || "").trim().toLowerCase();
  if (!normalized) return null;

  if (!secret) {
    throw new Error("An account-ID secret is required when an email recipient alias is present.");
  }

  const digest = createHmac("sha256", secret)
    .update(normalized)
    .digest("hex")
    .slice(0, 12);

  return "acct_" + digest;
}

export async function loadOrCreateAccountSecret(path = "./.account-salt") {
  try {
    const existing = (await fs.readFile(path, "utf8")).trim();
    if (existing.length >= 32) return existing;
  } catch {}

  const secret = randomBytes(32).toString("hex");
  await fs.writeFile(path, secret + "\n", { mode: 0o600 });
  return secret;
}
