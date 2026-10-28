import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The descriptions, group names and key names to translate in the shortcut list (SHORTCUT_GROUPS in ShortcutHelp.tsx, which Settings →
// Shortcuts uses too) are all message ids: each must exist in every language, or the list would show a bare id such as sc.xxx. The source
// is read directly rather than imported (it
// drags in React and the browser)
const src = readFileSync(fileURLToPath(new URL("../src/ShortcutHelp.tsx", import.meta.url)), "utf8");
const table = src.slice(src.indexOf("SHORTCUT_GROUPS"), src.indexOf("];", src.indexOf("SHORTCUT_GROUPS")));
const ids = [...table.matchAll(/"((?:sc|key|tool|menu|shortcuts)\.[\w.]+)"/g)].map((m) => m[1]);
const catalog = (lang: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`../../../i18n/locales/${lang}.json`, import.meta.url)), "utf8")) as Record<string, string>;

describe("shortcut list", () => {
  it("the table was read (guards against the extraction above silently failing and checking nothing)", () => {
    expect(ids.length).toBeGreaterThan(60);
    expect(ids).toContain("sc.group.global");
    expect(ids).toContain("key.wheel");
  });
  it.each(["zh-CN", "en"])("every message id exists in %s", (lang) => {
    const c = catalog(lang);
    expect(ids.filter((id) => !(id in c))).toEqual([]);
  });
  it("no repeated description within a group", () => {
    for (const g of table.split("title: ").slice(1)) {
      const labels = [...g.matchAll(/\], "([\w.]+)"\]/g)].map((m) => m[1]);
      expect(new Set(labels).size, g.slice(0, 30)).toBe(labels.length);
    }
  });
});
