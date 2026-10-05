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

  if (/@(?:[a-z0-9-]+\.)?uber\.com(?:\b|>)/i.test(value)) {
    return {
      provided: true,
      trusted: true,
      confidence: "high",
      basis: "uber_domain"
    };
  }

  if (/(?:ubereats|uber)_at_uber_com(?:[_-][^@\s>]*)?@icloud\.com/i.test(value)) {
    return {
      provided: true,
      trusted: true,
      confidence: "high",
      basis: "icloud_relay_shape"
    };
  }

  if (displayNameLooksUber(value)) {
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
