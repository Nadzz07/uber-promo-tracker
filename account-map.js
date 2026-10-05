function normaliseAlias(value) {
  return String(value || "").trim().toLowerCase();
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
    version: 1,
    nextNumber,
    accounts
  };
}

export function assignAccountRefs(
  promos = [],
  previousState = {},
  seenAt = new Date().toISOString()
) {
  const state = normaliseAccountMap(previousState);
  const accounts = { ...state.accounts };
  let nextNumber = state.nextNumber;

  const mappedPromos = promos.map(promo => {
    const alias = normaliseAlias(promo.accountAlias);

    if (!alias) {
      return {
        ...promo,
        accountRef: null
      };
    }

    let record = accounts[alias];

    if (!record || !record.ref) {
      record = {
        ref: "A" + String(nextNumber).padStart(3, "0"),
        firstSeenAt: seenAt,
        lastSeenAt: seenAt
      };
      accounts[alias] = record;
      nextNumber += 1;
    } else {
      accounts[alias] = {
        ...record,
        lastSeenAt: seenAt
      };
    }

    return {
      ...promo,
      accountRef: accounts[alias].ref
    };
  });

  return {
    promos: mappedPromos,
    state: {
      version: 1,
      nextNumber,
      accounts
    }
  };
}
