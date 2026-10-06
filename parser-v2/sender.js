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
  if (domain === "uber.com" || domain?.endsWith(".uber.com")) {
    return {
      provided: true,
      trusted: true,
      confidence: "high",
      basis: "uber_domain"
    };
  }

  if (domain === "icloud.com" && /^(?:ubereats|uber)_at_uber_com(?:[_-][^@\s>]*)?@icloud\.com$/i.test(address[1])) {
    return {
      provided: true,
      trusted: true,
      confidence: "high",
      basis: "icloud_relay_shape"
    };
  }

  if (displayNameLooksUber(value) && !/uber\.com\./i.test(domain || "")) {
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
