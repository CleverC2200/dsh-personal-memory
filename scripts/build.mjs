import { build } from "esbuild";
import { mkdir, readFile, writeFile } from "node:fs/promises";
const manifest = JSON.parse(await readFile("package.json", "utf8"));
await writeFile("package-version.mjs", `export const pluginPackageVersion = Object.freeze(${JSON.stringify({ name: manifest.name, version: manifest.version })});\n`);
const result = await build({
  entryPoints: ["client.jsx"],
  bundle: true,
  write: false,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  external: ["react", "@deepseek-ai/dsh-client-ui-primitives"],
  loader: { ".css": "text" },
});
await mkdir("lib", { recursive: true });
await writeFile(
  "lib/client.js",
  'window.__ModuleLoader__.load({id:"@cleverc2200/dsh-personal-memory",factory:(require)=>{var module={exports:{}};var exports=module.exports;\n' +
    result.outputFiles[0].text +
    "\nreturn module.exports;}});\n",
);
