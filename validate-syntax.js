import fs from "node:fs";
import { execFileSync } from "node:child_process";
for (const folder of [".", "parser-v2", "mac"]) {
  for (const name of fs.readdirSync(folder)) {
    const file = folder + "/" + name;
    if (name.endsWith(".js")) execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
    if (name.endsWith(".sh")) execFileSync("bash", ["-n", file], { stdio: "pipe" });
  }
}
console.log("✓ JavaScript and shell syntax");
