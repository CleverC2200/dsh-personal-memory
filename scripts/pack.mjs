import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { tmpdir } from "node:os";
import { parseArgs } from "node:util";
import { pluginPackageVersion } from "../package-version.mjs";

const { values } = parseArgs({ options: { destination: { type: "string" } } });
if (!values.destination || !isAbsolute(values.destination)) throw Error("PACKAGE_DESTINATION_REQUIRED");
const manifest = JSON.parse(await readFile("package.json", "utf8"));
if (manifest.name !== pluginPackageVersion.name || manifest.version !== pluginPackageVersion.version)
  throw Error("PACKAGE_VERSION_STALE");
const [packed] = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--dry-run", "--json"], { encoding: "utf8" }));
const stage = await mkdtemp(join(tmpdir(), "personal-memory-package-"));
try {
  for (const { path } of packed.files) {
    if (path === "package.json") continue;
    await mkdir(dirname(join(stage, path)), { recursive: true });
    await copyFile(path, join(stage, path));
  }
  for (const field of ["scripts", "devDependencies", "workspaces", "packageManager", "pnpm"])
    delete manifest[field];
  await writeFile(join(stage, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
  await mkdir(values.destination);
  const output = execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", values.destination], { cwd: stage, encoding: "utf8" });
  process.stdout.write(output);
} finally {
  await rm(stage, { recursive: true, force: true });
}
