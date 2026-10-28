// Checks the messages of one language (i18n/locales/<language>.json); run it after translating or editing. Compared with the source language (zh-CN):
//   missing and extra keys; invalid ICU; placeholders that differ from the source; plural forms missing for this language (per CLDR: Russian needs one / few / many / other);
//   leftover Chinese full-width punctuation (except in Chinese and Japanese)
//   node scripts/check-catalog.mjs ja          # one language
//   node scripts/check-catalog.mjs             # all of them
// Exits with code 1 when there are problems. packages/web/test/i18n.test.ts checks the same things (it runs in verify)

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, TYPE } from "@formatjs/icu-messageformat-parser";

const DIR = fileURLToPath(new URL("../i18n/locales/", import.meta.url));
const SOURCE = "zh-CN";
const load = (l) => JSON.parse(readFileSync(join(DIR, `${l}.json`), "utf8"));

/** The plural forms this language needs. In French, Spanish, Italian and Portuguese, many only covers large numbers such as 1 million and may be left out */
export function pluralForms(locale) {
  const all = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
  const optional = ["fr", "es", "it", "pt-BR", "pt"].includes(locale) ? ["many"] : [];
  return all.filter((c) => !optional.includes(c));
}

function walk(els, out) {
  for (const el of els) {
    if ("value" in el && el.type !== TYPE.literal && el.type !== TYPE.pound && typeof el.value === "string") out.names.add(el.value);
    if (el.type === TYPE.plural) out.plurals.push(Object.keys(el.options));
    if ("options" in el) for (const o of Object.values(el.options)) walk(o.value, out);
    if ("children" in el) walk(el.children, out);
  }
  return out;
}
const info = (msg) => walk(parse(msg), { names: new Set(), plurals: [] });

export function checkCatalog(locale) {
  const source = load(SOURCE);
  const own = load(locale);
  const problems = [];
  for (const k of Object.keys(source)) if (!(k in own)) problems.push(`missing: ${k}`);
  for (const k of Object.keys(own)) if (!(k in source)) problems.push(`extra: ${k}`);
  const forms = pluralForms(locale);
  const cjk = ["zh-CN", "zh-TW", "ja"].includes(locale);
  for (const [k, msg] of Object.entries(own)) {
    if (!(k in source)) continue;
    let mine;
    try {
      mine = info(msg);
    } catch (e) {
      problems.push(`not valid ICU: ${k}: ${e.message}`);
      continue;
    }
    const want = info(source[k]).names;
    const same = mine.names.size === want.size && [...want].every((n) => mine.names.has(n));
    if (!same) problems.push(`placeholders differ: ${k}: expected {${[...want].join("}, {")}}, got {${[...mine.names].join("}, {")}}`);
    for (const options of mine.plurals) {
      if (!options.includes("other")) problems.push(`plural missing other: ${k}`);
      // =1 may stand in for one (for wording that only makes sense for exactly 1, like "this note"); =0 and the like don't replace any other form
      const missing = forms.filter((f) => !options.includes(f) && !(f === "one" && options.includes("=1")));
      if (missing.length) problems.push(`plural missing ${missing.join(" / ")}: ${k}`);
    }
    if (!cjk && /[，。：；「」（）、]/.test(msg)) problems.push(`leftover Chinese punctuation: ${k}`);
  }
  return problems;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const wanted = process.argv.slice(2);
  const locales = wanted.length
    ? wanted
    : readdirSync(DIR)
        .filter((n) => n.endsWith(".json"))
        .map((n) => n.replace(/\.json$/, ""));
  let bad = 0;
  for (const l of locales) {
    if (l === SOURCE) continue;
    const p = checkCatalog(l);
    bad += p.length;
    console.log(
      `${l}: ${p.length ? `${p.length} problem(s)` : "no problems"} (${Object.keys(load(l)).length} messages, plurals need ${pluralForms(l).join(" / ")})`,
    );
    for (const line of p.slice(0, 200)) console.log(`  ${line}`);
  }
  process.exit(bad ? 1 : 0);
}
