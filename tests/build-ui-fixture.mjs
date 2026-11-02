import { build } from "esbuild";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const core = process.env.DSH_CORE_PATH;
const output = process.env.MEMORY_UI_OUTPUT;
if (!core || !output) throw Error("DSH_CORE_PATH and MEMORY_UI_OUTPUT required");
const aliases = {
  "@memory-core/registry": "packages/client/ui-renderer/src/client/registry.ts",
  "@memory-core/renderer": "packages/client/ui-renderer/src/client/scoped-slots.tsx",
  "@memory-core/settings": "packages/client/ui-settings-general/src/client/SettingsRoot.tsx",
  "@memory-core/settings-store": "packages/client/ui-settings-general/src/client/shell-store.ts",
  "@memory-core/locales": "packages/client/ui-settings-general/src/client/locales.ts",
  "@memory-core/theme": "packages/client/ui-theme/src/styles",
  "@deepseek-ai/dsh-client-ui-primitives": "packages/client/ui-primitives/src/index.ts",
};
await build({
  entryPoints: ["tests/ui-fixture.jsx"],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outdir: output,
  jsx: "automatic",
  nodePaths: [resolve(core, "node_modules")],
  alias: {
    ...Object.fromEntries(Object.entries(aliases).map(([key, path]) => [key, resolve(core, path)])),
    react: dirname(require.resolve("react/package.json")),
    "react-dom": dirname(require.resolve("react-dom/package.json")),
  },
  loader: { ".woff2": "dataurl", ".woff": "dataurl", ".ttf": "dataurl" },
  plugins: [
    {
      name: "memory-css-text",
      setup(b) {
        b.onLoad({ filter: /memory\.css$/ }, async (args) => ({
          contents:
            "export default " +
            JSON.stringify(await (await import("node:fs/promises")).readFile(args.path, "utf8")),
          loader: "js",
        }));
      },
    },
  ],
});
