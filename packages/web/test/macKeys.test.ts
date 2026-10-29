import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { IntlMessageFormat } from "intl-messageformat";
import { describe, expect, it } from "vitest";
import { keyWordsOf, macifyMessages, macifyShortcuts, type KeyWords } from "../src/macKeys";

const EN: KeyWords = { ctrl: "Ctrl", shift: "Shift", enter: "Enter", esc: "Esc", delete: "Delete", backspace: "Backspace" };
const DE: KeyWords = { ctrl: "Strg", shift: "Umschalt", enter: "Eingabe", esc: "Esc", delete: "Entf", backspace: "Rücktaste" };
const FR: KeyWords = { ctrl: "Ctrl", shift: "Maj", enter: "Entrée", esc: "Échap", delete: "Suppr", backspace: "Retour arrière" };

describe("macifyShortcuts", () => {
  it.each([
    ["Copy as text (Ctrl Shift A)", "Copy as text (⇧⌘A)"],
    ["Undo (Ctrl Z)", "Undo (⌘Z)"],
    ["Settings (Ctrl ,)", "Settings (⌘,)"],
    ["Zoom in (Ctrl +)", "Zoom in (⌘+)"],
    ["Zoom out (Ctrl -)", "Zoom out (⌘-)"],
    ["Hide library (Ctrl B)", "Hide library (⌘B)"],
    ["Hide notes panel (Ctrl Alt B)", "Hide notes panel (⌥⌘B)"],
    ["Press Alt 1⁠–⁠4 to switch", "Press ⌥1⁠–⁠4 to switch"],
    ["Remove the most recent mark (Alt Z)", "Remove the most recent mark (⌥Z)"],
    ["Shift Enter for a new line", "⇧↩ for a new line"],
    ["Ctrl Enter also works", "⌘↩ also works"],
    ["Ctrl-click adds or removes", "⌘-click adds or removes"],
    ["Marquee select (hold Ctrl to add)", "Marquee select (hold ⌘ to add)"],
    ["Press Ctrl V to paste it", "Press ⌘V to paste it"],
    ["Undo (Ctrl Shift Z or Ctrl Y to redo)", "Undo (⇧⌘Z or ⌘Y to redo)"],
    ["Fit to window (or Ctrl 0)", "Fit to window (or ⌘0)"],
    ["Add Ctrl, Alt or Win.", "Add ⌘, ⌥ or Win."],
    ["Refresh (F5)", "Refresh (F5)"],
    ["Ctrl F5", "⌘F5"],
    ["Ctrl Home goes to the start", "⌘Home goes to the start"],
  ])("%s", (text, expected) => {
    expect(macifyShortcuts(text, EN)).toBe(expected);
  });

  it("leaves ordinary words after a modifier alone", () => {
    expect(macifyShortcuts("Hold Ctrl and drag to add", EN)).toBe("Hold ⌘ and drag to add");
    expect(macifyShortcuts("the Controller and Shifting", EN)).toBe("the Controller and Shifting");
    expect(macifyShortcuts("Alternatively press Ctrl", EN)).toBe("Alternatively press ⌘");
  });

  it("uses the language's own key names (German, French) and still reads the English ones", () => {
    expect(macifyShortcuts("Kopieren (Strg Umschalt A)", DE)).toBe("Kopieren (⇧⌘A)");
    expect(macifyShortcuts("Umschalt Eingabe für eine neue Zeile", DE)).toBe("⇧↩ für eine neue Zeile");
    expect(macifyShortcuts("Copier en texte (Ctrl Maj A)", FR)).toBe("Copier en texte (⇧⌘A)");
    expect(macifyShortcuts("Maj Entrée pour une nouvelle ligne", FR)).toBe("⇧↩ pour une nouvelle ligne");
  });

  it("works next to Chinese text", () => {
    expect(macifyShortcuts("删除后可按 Ctrl Z 撤销。", EN)).toBe("删除后可按 ⌘Z 撤销。");
    expect(macifyShortcuts("复制成文字（Ctrl Shift A）：适用于", EN)).toBe("复制成文字（⇧⌘A）：适用于");
  });
});

describe("macifyMessages on the real catalogs", () => {
  const dir = join(__dirname, "..", "..", "..", "i18n", "locales");
  const catalogs = readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => ({ locale: f.replace(/\.json$/, ""), messages: JSON.parse(readFileSync(join(dir, f), "utf8")) as Record<string, string> }));

  it("finds the catalogs", () => {
    expect(catalogs.length).toBeGreaterThanOrEqual(2);
  });

  it.each(catalogs.map((c) => [c.locale, c.messages] as const))(
    "%s: every message still parses and the key name messages are untouched",
    (locale, messages) => {
      const mac = macifyMessages(messages);
      expect(Object.keys(mac)).toEqual(Object.keys(messages));
      for (const [id, text] of Object.entries(mac)) {
        if (id.startsWith("keycap.")) expect(text).toBe(messages[id]);
        expect(() => new IntlMessageFormat(text, locale), id).not.toThrow();
      }
    },
  );

  it("English: no shortcut is left written with words, and some were rewritten", () => {
    const en = catalogs.find((c) => c.locale === "en")!.messages;
    const mac = macifyMessages(en);
    const changed = Object.keys(en).filter((id) => en[id] !== mac[id]);
    expect(changed.length).toBeGreaterThan(20);
    for (const [id, text] of Object.entries(mac)) {
      if (id.startsWith("keycap.")) continue;
      // A modifier word followed by a key is what the Mac spells with symbols
      expect(text, id).not.toMatch(/\b(?:Ctrl|Shift|Alt) (?:[A-Z0-9,.+-]|F\d|Enter|Esc)\b/);
    }
  });

  it("every language: the shortcuts of the three most used messages are rewritten", () => {
    for (const { messages } of catalogs) {
      const mac = macifyMessages(messages);
      const text = mac["app.copy.title.checked"];
      if (text !== undefined) expect(text).toContain("⇧⌘A");
      const add = mac["library.add.files"];
      if (add !== undefined) expect(add).toContain("⌘O");
    }
  });

  it("keyWordsOf falls back to the English names", () => {
    expect(keyWordsOf({})).toEqual(EN);
    expect(keyWordsOf({ "keycap.Ctrl": "Strg" }).ctrl).toBe("Strg");
  });
});
