import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, cpSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

test("package check rejects an absent client export and accepts its packaged build", (t) => {
  const root = mkdtempSync(join(tmpdir(), "memory-package-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const manifest = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
  writeFileSync(join(root, "package.json"), JSON.stringify(manifest));
  for (const file of [
    "scripts",
    "index.mjs",
    "index.d.mts",
    "cordis.patch.yml",
    "vendor",
    "settings.mjs",
    "README.md",
    "NOTICE.md",
  ])
    cpSync(new URL("../" + file, import.meta.url), join(root, file), { recursive: true });
  const check = () => spawnSync("npm", ["run", "check:package"], { cwd: root, encoding: "utf8" });
  const missing = check();
  assert.notEqual(missing.status, 0, missing.stdout + missing.stderr);
  mkdirSync(join(root, "lib"));
  writeFileSync(join(root, "lib/client.js"), "window.__ModuleLoader__.load({});\n");
  const built = check();
  assert.equal(built.status, 0, built.stdout + built.stderr);
});
