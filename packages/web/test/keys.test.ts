import { describe, expect, it } from "vitest";
import { keyName, keyNames, letterOf } from "../src/keys";
import { mnemonic } from "../src/mnemonic";

const ev = (o: Partial<KeyboardEvent>) =>
  ({ key: "", code: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o }) as KeyboardEvent;

describe("keyName", () => {
  it("letters are uppercased, and Shift appears only when needed", () => {
    expect(keyName(ev({ key: "k", code: "KeyK" }))).toBe("K");
    expect(keyName(ev({ key: "?", code: "Slash", shiftKey: true }))).toBe("?");
    expect(keyName(ev({ key: "ArrowLeft", code: "ArrowLeft", shiftKey: true }))).toBe("Shift+ArrowLeft");
    expect(keyName(ev({ key: " ", code: "Space" }))).toBe("Space");
  });

  it("Shift+digit is recorded as the digit and does not turn into a symbol with the keyboard layout", () => {
    expect(keyName(ev({ key: "!", code: "Digit1", shiftKey: true }))).toBe("Shift+1");
    expect(keyName(ev({ key: ")", code: "Digit0", shiftKey: true }))).toBe("Shift+0");
  });

  it("a digit key pressed alone is also recorded by key position (mark colors 1–6): & é on a French layout and ě on a Czech one are digits too; the numpad works as usual; Ctrl combinations use the character typed", () => {
    expect(keyName(ev({ key: "1", code: "Digit1" }))).toBe("1");
    expect(keyName(ev({ key: "&", code: "Digit1" }))).toBe("1");
    expect(keyName(ev({ key: "é", code: "Digit2" }))).toBe("2");
    expect(keyName(ev({ key: "ě", code: "Digit2" }))).toBe("2");
    expect(keyName(ev({ key: "5", code: "Numpad5" }))).toBe("5");
    expect(keyName(ev({ key: "-", code: "Digit6", ctrlKey: true }))).toBe("Ctrl+-");
  });

  it("Ctrl combinations", () => {
    expect(keyName(ev({ key: "o", code: "KeyO", ctrlKey: true }))).toBe("Ctrl+O");
    expect(keyName(ev({ key: "=", code: "Equal", ctrlKey: true }))).toBe("Ctrl+=");
    expect(keyName(ev({ key: "\\", code: "Backslash", ctrlKey: true }))).toBe("Ctrl+\\");
  });
});

describe("keyboard layouts (ADR-0001 item 10)", () => {
  it("letters typed on a non-Latin layout (Russian, Korean) count as Latin letters by key position, so shortcuts still work", () => {
    expect(keyName(ev({ key: "я", code: "KeyZ", ctrlKey: true }))).toBe("Ctrl+Z");
    expect(keyName(ev({ key: "м", code: "KeyV" }))).toBe("V");
    expect(keyName(ev({ key: "ㅁ", code: "KeyA" }))).toBe("A");
    expect(keyName(ev({ key: "Я", code: "KeyZ", ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+Z");
  });

  it("Latin layouts use the character typed: the top-left key on French AZERTY is A, and Z on German QWERTZ; accented letters are not mistaken for other letters", () => {
    expect(keyName(ev({ key: "a", code: "KeyQ" }))).toBe("A");
    expect(keyName(ev({ key: "z", code: "KeyY", ctrlKey: true }))).toBe("Ctrl+Z");
    expect(keyName(ev({ key: "è", code: "BracketLeft" }))).toBe("È");
  });

  it("a symbol typed with AltGr counts as the symbol itself (German AltGr+8 = [); letters typed with AltGr (such as €) are not shortcuts", () => {
    const altGr = (o: Partial<KeyboardEvent>) =>
      ev({ ctrlKey: true, altKey: true, getModifierState: (k: string) => k === "AltGraph", ...o });
    expect(keyName(altGr({ key: "[", code: "Digit8" }))).toBe("[");
    expect(keyName(altGr({ key: "\\", code: "Minus" }))).toBe("\\");
    expect(keyName(ev({ key: "[", code: "BracketLeft", ctrlKey: true, altKey: true }))).toBe("Ctrl+Alt+["); // a real Ctrl+Alt (not AltGr) works as before
  });

  it("with AltGr, WebView2 reports ctrlKey and altKey as false (only AltGraph): the typed symbol still counts, not the digit key position as 8 or 9", () => {
    const chromiumAltGr = (o: Partial<KeyboardEvent>) => ev({ getModifierState: (k: string) => k === "AltGraph", ...o });
    expect(keyName(chromiumAltGr({ key: "[", code: "Digit8" }))).toBe("[");
    expect(keyName(chromiumAltGr({ key: "]", code: "Digit9" }))).toBe("]");
    expect(keyName(chromiumAltGr({ key: "@", code: "KeyQ" }))).toBe("@");
  });

  it("besides the name by key position, the typed symbol is also given: Shift+7 types ? on a Russian layout, and counts as ? when Shift+7 is not bound to a shortcut", () => {
    expect(keyNames(ev({ key: "?", code: "Digit7", shiftKey: true }))).toEqual(["Shift+7", "?"]);
    expect(keyNames(ev({ key: "?", code: "Slash", shiftKey: true }))).toEqual(["?"]);
    expect(keyNames(ev({ key: "k", code: "KeyK" }))).toEqual(["K"]);
    // Only falls back to symbols: Shift+6 types 6 on a French layout and does not fall back to 6 (that is the shortcut for pressing 6
    // alone); letters typed on a Czech layout do not fall back either
    expect(keyNames(ev({ key: "6", code: "Digit6", shiftKey: true }))).toEqual(["Shift+6"]);
    expect(keyNames(ev({ key: "á", code: "Digit8" }))).toEqual(["8"]);
  });

  it("letterOf: this is what mnemonic letters are compared with", () => {
    expect(letterOf({ key: "d", code: "KeyD" })).toBe("D");
    expect(letterOf({ key: "ф", code: "KeyA" })).toBe("A");
    expect(letterOf({ key: "é", code: "Digit2" })).toBe("E");
    expect(letterOf({ key: "1", code: "Digit1" })).toBe("");
    expect(letterOf({ key: "Enter", code: "Enter" })).toBe("");
  });
});

describe("mnemonic: the mnemonic letter in a menu name", () => {
  it("Chinese, Japanese, Korean and Russian, e.g. File(&F): the label has no parentheses and the letter is shown separately", () => {
    expect(mnemonic("文件(&F)")).toEqual({ label: "文件", key: "F" });
    expect(mnemonic("Файл(&F)")).toEqual({ label: "Файл", key: "F" });
  });
  it("languages in Latin script, e.g. &Datei and A&nnotieren: that letter is underlined; accented letters count as unaccented", () => {
    expect(mnemonic("&Datei")).toEqual({ label: "Datei", key: "D", at: 0 });
    expect(mnemonic("A&nnotieren")).toEqual({ label: "Annotieren", key: "N", at: 1 });
    expect(mnemonic("&Édition")).toEqual({ label: "Édition", key: "E", at: 0 });
  });
  it("a name without & has no mnemonic letter", () => {
    expect(mnemonic("Datei")).toEqual({ label: "Datei", key: "" });
  });
  it("the menu bar in every language: all seven menus have a mnemonic letter and no two are the same", async () => {
    const { readdirSync, readFileSync } = await import("node:fs");
    const dir = new URL("../../../i18n/locales/", import.meta.url);
    for (const name of readdirSync(dir).filter((n) => n.endsWith(".json"))) {
      const cat = JSON.parse(readFileSync(new URL(name, dir), "utf8")) as Record<string, string>;
      const keys = ["file", "edit", "view", "note", "play", "window", "help"].map((k) => mnemonic(cat[`menu.top.${k}`]).key);
      expect(
        keys.every((k) => /^[A-Z]$/.test(k)),
        name,
      ).toBe(true);
      expect(new Set(keys).size, name).toBe(7);
    }
  });
});
