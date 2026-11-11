import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import { pluginPackageVersion } from "../index.mjs";

test("Host and compiled client expose the same immutable package version", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(pluginPackageVersion, { name: manifest.name, version: manifest.version });
  assert.equal(Object.isFrozen(pluginPackageVersion), true);
  const result = await build({ entryPoints: [new URL("../client.jsx", import.meta.url).pathname], bundle: true, write: false, format: "cjs", platform: "browser", external: ["react", "@deepseek-ai/dsh-client-ui-primitives"], loader: { ".css": "text" } });
  const module = { exports: {} };
  runInNewContext(result.outputFiles[0].text, { module, exports: module.exports, require: () => ({}) });
  assert.equal(module.exports.pluginPackageVersion.name, manifest.name);
  assert.equal(module.exports.pluginPackageVersion.version, manifest.version);
  assert.equal(Object.isFrozen(module.exports.pluginPackageVersion), true);
});
