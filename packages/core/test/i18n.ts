import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { IntlMessageFormat } from "intl-messageformat";
import * as core from "../src/index.js";
import type { Annotation, HandoffMaterial, HandoffOptions, Locale, Material, ReviewOptions, Shape, Translate } from "../src/index.js";

// All of core's text for AI needs the caller to supply a message lookup function (docs/adr/0001-i18n.md item 7). The tests wrap one around
// the repository's messages (i18n/locales) with the same formatting library as the UI;
// the Chinese expected values stay in the individual tests, the helpers below are bound to Chinese, and for English use translate("en")

const DIR = fileURLToPath(new URL("../../../i18n/locales/", import.meta.url));

export function translate(locale: Locale): Translate {
  const load = (l: string) => JSON.parse(readFileSync(`${DIR}${l}.json`, "utf8")) as Record<string, string>;
  const messages = { ...load("en"), ...load(locale) };
  return (id, values) => {
    const text = messages[id];
    if (text === undefined) throw new Error(`No catalog entry: ${id}`);
    return String(new IntlMessageFormat(text, locale).format(values));
  };
}

export const zh = translate("zh-CN");
export const en = translate("en");

export const renderHandoff = (list: HandoffMaterial[], options?: HandoffOptions) => core.renderHandoff(list, zh, options);
export const renderReview = (files: { material: Material; annotations: Annotation[] }[], options?: ReviewOptions) =>
  core.renderReview(files, zh, options);
export const describeShape = (shape: Shape, size?: { width: number; height: number }) => core.describeShape(shape, size, zh);
export const describeWhere = (a: Annotation, m: Material) => core.describeWhere(a, m, zh);
