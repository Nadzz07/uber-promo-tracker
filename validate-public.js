import fs from "node:fs";
import { assertPublicSnapshot } from "./public-snapshot.js";
const [promos = "promos.json", history = "history.json"] = process.argv.slice(2);
assertPublicSnapshot(JSON.parse(fs.readFileSync(promos, "utf8")), JSON.parse(fs.readFileSync(history, "utf8")));
console.log("✓ Public snapshot privacy and consistency");
