import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const targets = (value) =>
  typeof value === "string" ? [value] : Object.values(value ?? {}).flatMap(targets);
const packed = JSON.parse(
  execFileSync("npm", ["pack", "--ignore-scripts", "--dry-run", "--json"], { encoding: "utf8" }),
);
const files = new Set(packed[0].files.map((file) => file.path));
for (const target of targets(manifest.exports)) {
  if (target.startsWith("./") && !files.has(target.slice(2)))
    throw new Error("PACKAGE_EXPORT_MISSING: " + target);
}
console.log("Package exports verified: " + manifest.name);
