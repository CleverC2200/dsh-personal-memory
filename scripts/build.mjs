import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
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
