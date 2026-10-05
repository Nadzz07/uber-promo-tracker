import {
    parseUberPromo
}
from "./parser.js";


export function scorePromo(promo) {

    let score = 0;

    if (promo.maxSaving != null) {
        score += promo.maxSaving * 10;
    }

    if (
        promo.discountType === "percent" &&
        promo.discount != null
    ) {
        score += promo.discount;
    }

    if (
        promo.discountType === "fixed" &&
        promo.discount != null
    ) {
        score += promo.discount * 10;
    }

    if (promo.minimumSpend) {
        score -= promo.minimumSpend;
    }

    return score;
}


function promoKey(promo) {

    return [
        promo.service,
        promo.discountType,
        promo.discount,
        promo.maxSaving,
        promo.minimumSpend,
        promo.code || "",
        promo.expires || ""
    ]
    .join("|")
    .toLowerCase();
}


export function buildPromoList(emails = []) {

    const uniquePromos =
        new Map();


    emails.forEach(email => {

        const promo =
            parseUberPromo(email);


        // Ignore receipts, ride summaries, etc.
        if (!promo.isPromo) {
            return;
        }


        const key =
            promoKey(promo);


        // Ignore duplicate copies
        // of the same promotion.
        if (!uniquePromos.has(key)) {

            uniquePromos.set(
                key,
                promo
            );

        }

    });


    const promos =
        [...uniquePromos.values()];


    // Best promo first
    promos.sort(
        (a, b) =>
            scorePromo(b) -
            scorePromo(a)
    );


    return promos;
}
