function normaliseAlias(value) {
  return String(value || "").trim().toLowerCase();
}

export function maskAccountAlias(value) {
  const alias = normaliseAlias(value);
  if (!alias || !alias.includes("@")) return null;

  const [local, ...domainParts] = alias.split("@");
  const domain = domainParts.join("@");

  if (!local || !domain) return null;

  if (local.length <= 2) {
    return local.charAt(0) + "…@" + domain;
  }

  if (local.length <= 5) {
    return local.charAt(0) + "…" + local.charAt(local.length - 1) + "@" + domain;
  }

  return local.slice(0, 2) + "…" + local.slice(-2) + "@" + domain;
}

export function normaliseAccountMap(payload = {}) {
  const accounts =
    payload && typeof payload.accounts === "object" && payload.accounts
      ? { ...payload.accounts }
      : {};

  const nextNumber = Number.isInteger(payload.nextNumber) && payload.nextNumber > 0
    ? payload.nextNumber
    : 1;

  return {
    version: 2,
    nextNumber,
    accounts
  };
}

export function assignAccountRefs(
  items = [],
  previousState = {},
  seenAt = new Date().toISOString()
) {
  const state = normaliseAccountMap(previousState);
  const accounts = { ...state.accounts };
  let nextNumber = state.nextNumber;

  const mappedItems = items.map(item => {
    const alias = normaliseAlias(item.accountAlias);

    if (!alias) {
      return {
        ...item,
        accountRef: item.accountRef || null,
        accountMasked: item.accountMasked || null
      };
    }

    let record = accounts[alias];
    const masked = maskAccountAlias(alias);

    if (!record || !record.ref) {
      record = {
        ref: "A" + String(nextNumber).padStart(3, "0"),
        masked,
        firstSeenAt: seenAt,
        lastSeenAt: seenAt
      };
      accounts[alias] = record;
      nextNumber += 1;
    } else {
      accounts[alias] = {
        ...record,
        masked: record.masked || masked,
        lastSeenAt: seenAt
      };
    }

    return {
      ...item,
      accountRef: accounts[alias].ref,
      accountMasked: accounts[alias].masked || masked
    };
  });

  return {
    promos: mappedItems,
    items: mappedItems,
    state: {
      version: 2,
      nextNumber,
      accounts
    }
  };
}
