import fs from "fs/promises";

import {
    buildPromoList
}
from "./processor.js";


async function generatePromos() {

    try {

        const raw =
            await fs.readFile(
                "./emails.json",
                "utf8"
            );


        const emails =
            JSON.parse(raw);


        const promos =
            buildPromoList(emails);


        await fs.writeFile(
            "./promos.json",
            JSON.stringify(
                promos,
                null,
                2
            )
        );


        console.log(
            `Generated ${promos.length} promos.`
        );


        if (promos.length > 0) {

            console.log(
                `Best promo: ${promos[0].title}`
            );

        }

    }

    catch (error) {

        console.error(
            "Could not generate promos:"
        );

        console.error(error);

        process.exit(1);

    }

}


generatePromos();
