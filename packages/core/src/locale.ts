import { DATA_DIR } from "./store.js";

// Languages (docs/adr/0001-i18n.md): which are supported and how a system language tag maps onto them, shared by the UI
// (packages/web/src/i18n.tsx) and the CLI; the shell's app/Locale.cs follows the same rules, and the golden file tests/golden/locale.json
// is checked against both. Also which language
// this notes folder's REVIEW.md uses (project.json)

export const LOCALES = ["zh-CN", "zh-TW", "en", "ja", "ko", "fr", "de", "es", "it", "pt-BR", "ru"] as const;
export type Locale = (typeof LOCALES)[number];
export const SOURCE_LOCALE: Locale = "zh-CN";

export const isLocale = (v: unknown): v is Locale => (LOCALES as readonly unknown[]).includes(v);

/**
 * A language tag from the system or browser (zh-Hans-CN, zh-HK, pt-PT, en-GB…) → a supported language (ADR-0001 item 5):
 * Chinese splits into Simplified and Traditional (Traditional-script regions and Hant map to Traditional Chinese), all Portuguese maps to
 * Brazilian Portuguese, the rest match on the language part, and anything else falls back to English
 */
export function matchLocale(tag: string | null | undefined): Locale {
  const t = (tag ?? "").toLowerCase();
  if (t === "zh" || t.startsWith("zh-")) return /hant|-tw|-hk|-mo/.test(t) ? "zh-TW" : "zh-CN";
  if (t === "pt" || t.startsWith("pt-")) return "pt-BR";
  const lang = t.split(/[-_]/)[0];
  return LOCALES.find((l) => l.toLowerCase() === lang) ?? "en";
}

// ---------- This notes folder's settings, .sniptoss/project.json (docs/annotation-format.md, "Folder settings") ----------

export const PROJECT_FILE = `${DATA_DIR}/project.json`;

/** The REVIEW.md language recorded in project.json; undefined if the file is missing, broken, or records something unrecognized */
export function projectLanguage(text: string | null | undefined): Locale | undefined {
  if (!text) return undefined;
  try {
    const language = (JSON.parse(text) as { language?: unknown } | null)?.language;
    return isLocale(language) ? language : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Which language REVIEW.md is written in (ADR-0001 item 7): the one recorded in project.json; if none is recorded, an existing REVIEW.md
 * (written by earlier versions, always in Chinese) means Chinese, otherwise the current language (the UI language; for the CLI, the system language).
 * write = whether the decision should be recorded in project.json: only when the file is missing; a broken or unrecognized one is not overwritten
 */
export function reviewLanguage(
  project: string | null | undefined,
  reviewExists: boolean,
  current: Locale,
): { language: Locale; write: boolean } {
  const recorded = projectLanguage(project);
  if (recorded) return { language: recorded, write: false };
  return { language: reviewExists ? SOURCE_LOCALE : current, write: project == null };
}

/** A newly created project.json (UTF-8, 2-space indent, trailing newline) */
export const serializeProject = (language: Locale) => JSON.stringify({ language }, null, 2) + "\n";
