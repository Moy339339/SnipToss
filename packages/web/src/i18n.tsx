// Internationalization (docs/adr/0001-i18n.md). Messages live in i18n/locales/<language>.json at the repository root (ICU MessageFormat),
// and the shell's C# (app/Locale.cs) reads the same files. Usage: useIntl().formatMessage({ id }) or <FormattedMessage id=… /> in
// components; class components use static contextType = IntlContext. New UI text is always written as a message, first in zh-CN (the
// source language) and en; the other languages follow later (missing ones fall back to English)

import { IntlMessageFormat } from "intl-messageformat";
import { LOCALES, matchLocale, SOURCE_LOCALE, type Locale, type Translate } from "@sniptoss/core";

// Which languages are supported and how system language tags are matched live in core (the command line needs them too); re-exported here
export { LOCALES, matchLocale, SOURCE_LOCALE, type Locale };

/** Each language's name in its own language (used by the language list in Settings) */
export const LOCALE_NAMES: Record<Locale, string> = {
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
  en: "English",
  ja: "日本語",
  ko: "한국어",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
  it: "Italiano",
  "pt-BR": "Português (Brasil)",
  ru: "Русский",
};

/**
 * Languages that "Follow system" may pick: those the whole app is already translated into. Unfinished ones are not picked, otherwise only
 * the few strings already extracted into messages would follow the system and the rest would stay Chinese (e.g. a mixed Chinese/English
 * UI on an English Windows). When one is added, the shell pins existing users to Chinese (Settings.Migrate), so the interface doesn't
 * suddenly change language after an upgrade. A language is added once it is fully translated; a language chosen manually in Settings is
 * not limited by this (for development and proofreading). The shell (app/Locale.cs) picks its own language by the same rules: when
 * changing this, update FollowSystem there and the golden file tests/golden/locale.json
 */
export const SYSTEM_LOCALES: readonly Locale[] = LOCALES;

/**
 * Second-tier languages (ADR-0001 item 4): fully translated but not yet reviewed by native speakers. Choosing one in Settings shows a
 * note welcoming corrections
 */
export const NEEDS_REVIEW: readonly Locale[] = LOCALES.filter((l) => l !== SOURCE_LOCALE && l !== "en");

/**
 * The language chosen in Settings ("system" = follow the system) + the system's language → the language to use this time. If the system
 * language is not fully translated: English if available, otherwise the source language
 */
export function resolveLocale(
  pref: string | undefined,
  system: string | null | undefined,
  ready: readonly Locale[] = SYSTEM_LOCALES,
): Locale {
  if (pref && pref !== "system" && (LOCALES as readonly string[]).includes(pref)) return pref as Locale;
  const matched = matchLocale(system);
  if (ready.includes(matched)) return matched;
  return ready.includes("en") ? "en" : SOURCE_LOCALE;
}

const catalogs = import.meta.glob<{ default: Record<string, string> }>("../../../i18n/locales/*.json");

/**
 * Languages that have messages (selectable in Settings): once a second-tier language is translated, adding i18n/locales/<language>.json
 * is enough for it to show up here
 */
export const AVAILABLE_LOCALES: readonly Locale[] = LOCALES.filter((l) => `../../../i18n/locales/${l}.json` in catalogs);

async function load(locale: string): Promise<Record<string, string>> {
  return (await catalogs[`../../../i18n/locales/${locale}.json`]?.())?.default ?? {};
}

/** Loads only the catalog in use (the 11 languages are not all pulled into the first screen); missing messages are filled in from English */
export async function loadMessages(locale: Locale): Promise<Record<string, string>> {
  const [base, own] = await Promise.all([load("en"), locale === "en" ? Promise.resolve({}) : load(locale)]);
  return { ...base, ...own };
}

const translators = new Map<Locale, Promise<Translate>>();

/**
 * The message lookup function for a language (not necessarily the UI language), for core: REVIEW.md is written in the language recorded
 * in the notes folder (docs/annotation-format.md, "Folder settings"). Parsed messages are kept, since REVIEW.md is rewritten on every
 * note change
 */
export function translatorFor(locale: Locale): Promise<Translate> {
  let t = translators.get(locale);
  if (!t) {
    t = loadMessages(locale).then((messages) => {
      const parsed = new Map<string, IntlMessageFormat>();
      const translate: Translate = (id, values) => {
        const text = messages[id];
        if (text === undefined) return id;
        let f = parsed.get(id);
        if (!f) parsed.set(id, (f = new IntlMessageFormat(text, locale)));
        return String(f.format(values));
      };
      return translate;
    });
    translators.set(locale, t);
  }
  return t;
}
