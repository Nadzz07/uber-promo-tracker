const MONTHS = {
    january: 0,
    february: 1,
    march: 2,
    april: 3,
    may: 4,
    june: 5,
    july: 6,
    august: 7,
    september: 8,
    october: 9,
    november: 10,
    december: 11,

    jan: 0,
    feb: 1,
    mar: 2,
    apr: 3,
    jun: 5,
    jul: 6,
    aug: 7,
    sep: 8,
    sept: 8,
    oct: 9,
    nov: 10,
    dec: 11
};


function number(value) {

    if (value == null) {
        return null;
    }

    const result =
        Number(String(value).replace(/,/g, ""));

    return Number.isFinite(result)
        ? result
        : null;
}


function firstMatch(text, patterns) {

    for (const pattern of patterns) {

        const match = text.match(pattern);

        if (match) {
            return match;
        }

    }

    return null;
}


function inferYear(month, day, receivedAt) {

    let year = receivedAt.getFullYear();

    const candidate =
        new Date(
            year,
            month,
            day,
            23,
            59,
            59
        );

    const ninetyDays =
        90 * 24 * 60 * 60 * 1000;

    if (
        candidate.getTime()
        <
        receivedAt.getTime() - ninetyDays
    ) {
        year++;
    }

    return year;
}


function toIsoDate(year, month, day) {

    const date =
        new Date(
            year,
            month,
            day,
            12,
            0,
            0
        );

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return [
        date.getFullYear(),
        String(
            date.getMonth() + 1
        ).padStart(2, "0"),

        String(
            date.getDate()
        ).padStart(2, "0")

    ].join("-");
}


function extractExpiry(text, receivedAt) {

    const namedDate =
        firstMatch(
            text,
            [
                /(?:expires?|valid\s+(?:until|to)|ends?|use\s+by|redeem\s+by)\s*(?:on\s*)?(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})(?:\s+(\d{4}))?/i,

                /(?:until|before)\s+(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})(?:\s+(\d{4}))?/i
            ]
        );


    if (namedDate) {

        const day =
            number(namedDate[1]);

        const month =
            MONTHS[
                namedDate[2].toLowerCase()
            ];


        if (
            month != null &&
            day >= 1 &&
            day <= 31
        ) {

            const year =
                namedDate[3]
                ? number(namedDate[3])
                : inferYear(
                    month,
                    day,
                    receivedAt
                );

            return toIsoDate(
                year,
                month,
                day
            );
        }

    }


    const numericDate =
        firstMatch(
            text,
            [
                /(?:expires?|valid\s+(?:until|to)|ends?|use\s+by|redeem\s+by)\s*(?:on\s*)?(\d{1,2})[\/.\-](\d{1,2})(?:[\/.\-](\d{2,4}))?/i
            ]
        );


    if (numericDate) {

        const day =
            number(numericDate[1]);

        const month =
            number(numericDate[2]) - 1;

        let year =
            numericDate[3]
                ? number(numericDate[3])
                : inferYear(
                    month,
                    day,
                    receivedAt
                );


        if (year < 100) {
            year += 2000;
        }


        if (
            month >= 0 &&
            month <= 11 &&
            day >= 1 &&
            day <= 31
        ) {

            return toIsoDate(
                year,
                month,
                day
            );

        }

    }


    return null;
}


export function parseUberPromo({
    subject = "",
    body = "",
    receivedAt = new Date()
} = {}) {


    const raw =
        `${subject}\n${body}`
        .replace(/\u00a0/g, " ");


    const text =
        raw
        .replace(/\s+/g, " ")
        .trim();


    const service =
        /uber\s*eats|ubereats|food|order/i
        .test(text)

        ? "Uber Eats"
        : "Uber";


    const percentMatch =
        firstMatch(
            text,
            [
                /(\d{1,3})\s*%\s*(?:off|discount)/i,

                /(?:save|get)\s*(\d{1,3})\s*%/i
            ]
        );


    const fixedMatch =
        firstMatch(
            text,
            [
                /£\s*(\d+(?:\.\d{1,2})?)\s*(?:off|discount)/i,

                /(?:save|get)\s*£\s*(\d+(?:\.\d{1,2})?)/i
            ]
        );


    const maxSavingMatch =
        firstMatch(
            text,
            [
                /(?:up\s+to|maximum|max\.?)(?:\s+(?:saving|savings|discount))?\s*£\s*(\d+(?:\.\d{1,2})?)/i,

                /(?:save|discount)\s+up\s+to\s*£\s*(\d+(?:\.\d{1,2})?)/i
            ]
        );


    const minimumSpendMatch =
        firstMatch(
            text,
            [
                /(?:minimum|min\.?)(?:\s+(?:spend|order|basket))?\s*£\s*(\d+(?:\.\d{1,2})?)/i,

                /(?:when\s+you\s+spend|orders?\s+(?:over|of)|spend\s+at\s+least)\s*£\s*(\d+(?:\.\d{1,2})?)/i
            ]
        );


    const codeMatch =
        firstMatch(
            text,
            [
                /(?:promo\s+code|use\s+code|code)\s*[:\-]?\s*([A-Z0-9][A-Z0-9\-]{3,19})\b/i
            ]
        );


    let discountType = null;
    let discount = null;


    if (percentMatch) {

        discountType = "percent";

        discount =
            number(percentMatch[1]);

    }

    else if (fixedMatch) {

        discountType = "fixed";

        discount =
            number(fixedMatch[1]);

    }


    const maxSaving =
        maxSavingMatch
        ? number(maxSavingMatch[1])
        : null;


    const minimumSpend =
        minimumSpendMatch
        ? number(minimumSpendMatch[1])
        : 0;


    const code =
        codeMatch
        ? codeMatch[1].toUpperCase()
        : null;


    const expires =
        extractExpiry(
            text,
            new Date(receivedAt)
        );


    const looksLikePromo =
        /uber/i.test(text)

        &&

        (
            discount != null ||
            maxSaving != null ||
            /promo|offer|discount|save|off/i
            .test(text)
        );


    let title =
        subject.trim();


    if (!title) {

        if (discountType === "percent") {

            title =
                `${discount}% off`;

        }

        else if (discountType === "fixed") {

            title =
                `£${discount} off`;

        }

        else {

            title =
                service === "Uber Eats"
                ? "Uber Eats offer"
                : "Uber offer";

        }

    }


    return {

        isPromo:
            looksLikePromo,

        service,

        title,

        discountType,

        discount,

        maxSaving,

        minimumSpend,

        code,

        expires

    };
}
