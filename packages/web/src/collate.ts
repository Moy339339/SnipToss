import { SOURCE_LOCALE } from "./i18n";

// How names are sorted (library, notes panel groups): follows the UI language (ADR-0001 item 9): the Chinese UI sorts by pinyin, in the
// German UI ä sorts next to a. The language is the html lang (set by App when it loads the messages); if it isn't set yet (no page in
// tests) the source language is used. Numbers sort by value (2 comes before 10) and case is ignored

const collators = new Map<string, Intl.Collator>();

export function collator(): Intl.Collator {
  const lang = (typeof document !== "undefined" && document.documentElement.lang) || SOURCE_LOCALE;
  let c = collators.get(lang);
  if (!c) collators.set(lang, (c = new Intl.Collator(lang, { numeric: true, sensitivity: "base" })));
  return c;
}

export const compareNames = (a: string, b: string) => collator().compare(a, b);
