// Builds the files the Mac shell reads at run time (they are not in git): shell-messages.js (js/messages-entry.js with intl-messageformat
// bundled in, run in JavaScriptCore) and the message catalogs i18n/locales/*.json.
// node app-mac/scripts/build-resources.mjs [output folder]   (default: app-mac/.build/resources)

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { rolldown } from "rolldown";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const out = resolve(process.argv[2] ?? join(root, "app-mac", ".build", "resources"));

mkdirSync(join(out, "locales"), { recursive: true });

const bundle = await rolldown({ input: join(root, "app-mac", "js", "messages-entry.js"), platform: "browser" });
await bundle.write({ file: join(out, "shell-messages.js"), format: "iife", minify: true });
await bundle.close();

// Only the messages the shell shows itself (the same prefixes as tests/golden/messages.json); the rest are the UI's, which carries its own
const SHELL_PREFIXES = ["brand.", "category.", "shell.", "capture.", "ai.", "markColor.", "keycap."];
const locales = readdirSync(join(root, "i18n", "locales")).filter((name) => name.endsWith(".json"));
let bytes = 0;
for (const name of locales) {
  const all = JSON.parse(readFileSync(join(root, "i18n", "locales", name), "utf8"));
  const mine = Object.fromEntries(Object.entries(all).filter(([key]) => SHELL_PREFIXES.some((prefix) => key.startsWith(prefix))));
  const text = JSON.stringify(mine) + "\n";
  writeFileSync(join(out, "locales", name), text);
  bytes += Buffer.byteLength(text);
}

console.log(
  `resources in ${out}: shell-messages.js ${statSync(join(out, "shell-messages.js")).size} bytes, ${locales.length} catalogs (${bytes} bytes)`,
);
