function displayNameLooksUber(sender) {
  const value = String(sender || "").trim();
  if (!value) return false;

  const display = value.includes("<")
    ? value.slice(0, value.indexOf("<")).trim().replace(/^["']|["']$/g, "")
    : value;

  return /^(?:uber|uber\s*eats)$/i.test(display);
}

export function analyseSender(sender) {
  const value = String(sender || "").trim();

  if (!value) {
    return {
      provided: false,
      trusted: null,
      confidence: "unknown",
      basis: "sender_missing"
    };
  }

  const address = value.match(/<?([a-z0-9._%+-]+@([a-z0-9.-]+))>?(?:\s*)$/i);
  const domain = address?.[2]?.toLowerCase();
  if (domain === "uber.com" || domain?.endsWith(".uber.com") || domain === "uber-eats.com") {
    return {
      provided: true,
      trusted: true,
      confidence: "high",
      basis: "uber_domain"
    };
  }

  if (domain === "icloud.com" && /^(?:ubereats|uber|noreply|no_reply|receipts)_at_(?:[a-z0-9_]+_)?uber_com(?:[_-][^@\s>]*)?@icloud\.com$/i.test(address[1])) {
    return {
      provided: true,
      trusted: true,
      confidence: "high",
      basis: "icloud_relay_shape"
    };
  }

  // Display names alone are not evidence when an unrelated address is present.
  if (!address && displayNameLooksUber(value)) {
    return {
      provided: true,
      trusted: true,
      confidence: "medium",
      basis: "uber_display_name"
    };
  }

  return {
    provided: true,
    trusted: false,
    confidence: "low",
    basis: "unrecognised_sender"
  };
}
