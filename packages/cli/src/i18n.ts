import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { IntlMessageFormat } from "intl-messageformat";
import { matchLocale, SOURCE_LOCALE, type Locale, type Translate } from "@sniptoss/core";

// The messages used for the REVIEW.md the CLI writes and the instructions meant for agents: the same set as the UI and the shell
// (i18n/locales in the repository root, docs/adr/0001-i18n.md).
// Looked up three levels above packages/cli/dist; when the CLI is rewritten in C# (ADR-0003) they will be installed with the program

const DIR = fileURLToPath(new URL("../../../i18n/locales/", import.meta.url));

function load(locale: Locale): Record<string, string> {
  try {
    return JSON.parse(readFileSync(`${DIR}${locale}.json`, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

/** The message lookup function for a language (missing messages fall back to English, like the UI) */
export function translator(locale: Locale): Translate {
  const messages = { ...load("en"), ...(locale === "en" ? {} : load(locale)) };
  const parsed = new Map<string, IntlMessageFormat>();
  return (id, values) => {
    const text = messages[id];
    if (text === undefined) return id;
    let f = parsed.get(id);
    if (!f) parsed.set(id, (f = new IntlMessageFormat(text, locale)));
    return String(f.format(values));
  };
}

/**
 * Whether the language has translated all the message groups meant for AI (the ones REVIEW.md uses): an incomplete language is not used for
 * writing, to avoid half-English output
 */
const AI_PREFIXES = ["ai.", "category.", "kind.", "app.kind.this", "markColor.name"];
function readyForAi(locale: Locale): boolean {
  if (locale === SOURCE_LOCALE || locale === "en") return true;
  const own = load(locale);
  return Object.keys(load(SOURCE_LOCALE))
    .filter((k) => AI_PREFIXES.some((p) => k.startsWith(p)))
    .every((k) => k in own);
}

/**
 * The CLI's "current language": the system display language (as reported by Intl). It decides the language of REVIEW.md when none is recorded
 * and the file has not been written yet (core's reviewLanguage); a language whose AI messages are incomplete falls back to English
 */
export function systemLocale(): Locale {
  const matched = matchLocale(Intl.DateTimeFormat().resolvedOptions().locale);
  return readyForAi(matched) ? matched : "en";
}
