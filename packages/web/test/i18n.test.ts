import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse, TYPE, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { IntlMessageFormat } from "intl-messageformat";
import { describe, expect, it } from "vitest";
import { LOCALES, matchLocale, resolveLocale, SOURCE_LOCALE, SYSTEM_LOCALES } from "../src/i18n";
// The message check is the same one the CLI uses (scripts/check-catalog.mjs, plain JS)
import { checkCatalog } from "../../../scripts/check-catalog.mjs";

const DIR = fileURLToPath(new URL("../../../i18n/locales/", import.meta.url));
const catalogs = Object.fromEntries(
  readdirSync(DIR)
    .filter((n) => n.endsWith(".json"))
    .map((n) => [n.replace(/\.json$/, ""), JSON.parse(readFileSync(join(DIR, n), "utf8")) as Record<string, string>]),
);

// The golden file for which language is used: the shell's app/Locale.cs runs the same one (tests/AppTests/LocaleTests.cs)
const golden = JSON.parse(readFileSync(fileURLToPath(new URL("../../../tests/golden/locale.json", import.meta.url)), "utf8")) as {
  followSystem: string[];
  match: [string | null, string][];
  resolve: { pref: string | null; system: string; want: string }[];
};

describe("matchLocale: the Windows display language → a supported language (ADR-0001 item 5, golden file tests/golden/locale.json)", () => {
  it.each(golden.match)("%s → %s", (tag, want) => expect(matchLocale(tag)).toBe(want));
});

describe("resolveLocale: the language chosen in Settings wins, and Follow system looks at the system", () => {
  it("the languages Follow system can pick are the same as in the golden file (which the shell follows)", () =>
    expect([...SYSTEM_LOCALES]).toEqual(golden.followSystem));
  it.each(golden.resolve)("setting $pref, system $system → $want", ({ pref, system, want }) =>
    expect(resolveLocale(pref ?? undefined, system)).toBe(want),
  );
  it("follow system", () => expect(resolveLocale("system", "ja-JP", LOCALES)).toBe("ja"));
  it("an unrecognized value in Settings (broken by a hand edit): follows the system", () =>
    expect(resolveLocale("xx", "de-DE", LOCALES)).toBe("de"));
  // While the interface is not fully translated, Follow system does not pick a half-translated language, to avoid mixed languages
  it("the system language is not fully translated: uses the source language", () =>
    expect(resolveLocale("system", "en-US", ["zh-CN"])).toBe("zh-CN"));
  it("the system language is not fully translated but English is: uses English", () =>
    expect(resolveLocale("system", "ja-JP", ["zh-CN", "en"])).toBe("en"));
});

describe("messages (i18n/locales)", () => {
  it("the source language and English are both present", () => {
    expect(Object.keys(catalogs)).toContain(SOURCE_LOCALE);
    expect(Object.keys(catalogs)).toContain("en");
  });

  it("every file name is a supported language", () => {
    for (const name of Object.keys(catalogs)) expect(LOCALES as readonly string[]).toContain(name);
  });

  it("English and the source language have exactly the same messages (a missing message in a first-tier language blocks the release)", () => {
    expect(Object.keys(catalogs.en).sort()).toEqual(Object.keys(catalogs[SOURCE_LOCALE]).sort());
  });

  it("every message is valid ICU and its placeholders match the source language", () => {
    // Placeholders are taken with the ICU parser: a regex would also take the words in a branch (English other {Undone}) for placeholders
    const placeholders = (msg: string) => {
      const names: string[] = [];
      const walk = (els: MessageFormatElement[]) => {
        for (const el of els) {
          if ("value" in el && el.type !== TYPE.literal && typeof el.value === "string") names.push(el.value);
          if ("options" in el) for (const o of Object.values(el.options)) walk(o.value);
          if ("children" in el) walk(el.children);
        }
      };
      walk(parse(msg));
      return names.sort();
    };
    for (const [locale, messages] of Object.entries(catalogs)) {
      for (const [id, msg] of Object.entries(messages)) {
        expect(() => new IntlMessageFormat(msg, locale), `${locale} ${id}`).not.toThrow();
        const source = catalogs[SOURCE_LOCALE][id];
        if (source !== undefined) expect(new Set(placeholders(msg)), `${locale} ${id} placeholders`).toEqual(new Set(placeholders(source)));
      }
    }
  });

  it("every language: valid ICU, placeholders equal to the source language, every plural form the language needs (Russian one / few / many / other), no leftover Chinese punctuation (scripts/check-catalog.mjs)", () => {
    for (const locale of Object.keys(catalogs)) {
      if (locale === SOURCE_LOCALE) continue;
      // A missing message in a second-tier language falls back to English (ADR-0001 item 4), so missing ones are not blocked here; the
      // English check above blocks those
      expect(
        checkCatalog(locale).filter((p) => !p.startsWith("missing:")),
        locale,
      ).toEqual([]);
    }
  });

  it("plurals follow each language's rules", () => {
    expect(new IntlMessageFormat(catalogs.en["app.notes.count"], "en").format({ count: 1 })).toBe("1 note");
    expect(new IntlMessageFormat(catalogs.en["app.notes.count"], "en").format({ count: 3 })).toBe("3 notes");
    expect(new IntlMessageFormat(catalogs["zh-CN"]["app.notes.count"], "zh-CN").format({ count: 3 })).toBe("3 条批注");
  });
});
