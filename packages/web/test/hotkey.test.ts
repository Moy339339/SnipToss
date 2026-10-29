import { describe, expect, it } from "vitest";
import { hotkeyFrom, hotkeyParts, keycaps } from "../src/hotkey";

const key = (code: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean; win?: boolean } = {}) => ({
  code,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
  metaKey: !!mods.win,
});

describe("hotkeyFrom: recording the screen capture shortcut", () => {
  it("letters, digits and F keys work as usual", () => {
    expect(hotkeyFrom(key("KeyA", { ctrl: true, alt: true }))).toBe("Ctrl+Alt+A");
    expect(hotkeyFrom(key("Digit5", { ctrl: true }))).toBe("Ctrl+5");
    expect(hotkeyFrom(key("F9", { shift: true }))).toBe("Shift+F9");
  });
  it("keys that used to be impossible to record: PrintScreen, arrow keys, Space, numpad digits, Home / End…", () => {
    expect(hotkeyFrom(key("PrintScreen", { alt: true }))).toBe("Alt+PrintScreen");
    expect(hotkeyFrom(key("PrintScreen", { shift: true }))).toBe("Shift+PrintScreen");
    expect(hotkeyFrom(key("ArrowUp", { ctrl: true, alt: true }))).toBe("Ctrl+Alt+Up");
    expect(hotkeyFrom(key("Space", { ctrl: true, alt: true }))).toBe("Ctrl+Alt+Space");
    expect(hotkeyFrom(key("Numpad7", { ctrl: true }))).toBe("Ctrl+NumPad7");
    expect(hotkeyFrom(key("End", { win: true }))).toBe("Win+End");
  });
  it("Shift plus a typing key alone: rejected (that character could no longer be typed in any program)", () => {
    expect(hotkeyFrom(key("KeyA", { shift: true }))).toBe("shiftOnly");
    expect(hotkeyFrom(key("Digit1", { shift: true }))).toBe("shiftOnly");
    expect(hotkeyFrom(key("Space", { shift: true }))).toBe("shiftOnly");
  });
  it("Shift plus a selection or paste key alone (arrows, Home / End, Page Up / Down, Insert): rejected too; Shift plus F keys, PrintScreen or Pause is fine", () => {
    for (const code of ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", "Insert"])
      expect(hotkeyFrom(key(code, { shift: true })), code).toBe("shiftOnly");
    expect(hotkeyFrom(key("ArrowLeft", { ctrl: true, shift: true }))).toBe("Ctrl+Shift+Left");
    expect(hotkeyFrom(key("Pause", { shift: true }))).toBe("Shift+Pause");
    expect(hotkeyFrom(key("F24", { shift: true }))).toBe("Shift+F24");
  });
  it("combinations with Win are accepted and not treated as Shift alone", () => {
    expect(hotkeyFrom(key("KeyA", { win: true }))).toBe("Win+A");
    expect(hotkeyFrom(key("KeyS", { win: true, shift: true }))).toBe("Shift+Win+S");
  });
  it("incomplete (only a modifier pressed, or no modifier) or an unrecognized key: keeps waiting", () => {
    expect(hotkeyFrom(key("ControlLeft", { ctrl: true }))).toBeUndefined();
    expect(hotkeyFrom(key("KeyA"))).toBeUndefined();
    expect(hotkeyFrom(key("Semicolon", { ctrl: true }))).toBeUndefined();
  });
});

describe("keycaps on the Mac", () => {
  const t = (id: string) => ({ "keycap.Space": "Leertaste", "keycap.Home": "Pos1", "keycap.End": "Ende" })[id] ?? id;
  const mac = (text: string) => keycaps(text, t, true);

  it("modifiers are symbols in the Mac's order with no space before the key", () => {
    expect(mac("Ctrl Shift Z")).toBe("⇧⌘Z");
    expect(mac("Ctrl Alt B")).toBe("⌥⌘B");
    expect(mac("Ctrl O")).toBe("⌘O");
    expect(mac("Ctrl ,")).toBe("⌘,");
    expect(mac("Alt")).toBe("⌥");
    expect(mac("Ctrl")).toBe("⌘");
    expect(mac("Shift")).toBe("⇧");
  });

  it("key names: symbols where the Mac has them, the language's words where it does not", () => {
    expect(mac("Shift Enter")).toBe("⇧↩");
    expect(mac("Enter")).toBe("↩");
    expect(mac("Delete")).toBe("⌦");
    expect(mac("Backspace")).toBe("⌫");
    expect(mac("Esc")).toBe("⎋");
    expect(mac("Ctrl Home")).toBe("⌘Pos1");
    expect(mac("Space")).toBe("Leertaste");
  });

  it("text that is not a shortcut, and the Windows form", () => {
    expect(mac("? / F1")).toBe("? / F1");
    expect(keycaps("Ctrl Shift Z", (id) => id.replace("keycap.", ""), false)).toBe("Ctrl Shift Z");
    expect(keycaps("Ctrl Shift Z", (id) => ({ "keycap.Ctrl": "Strg", "keycap.Shift": "Umschalt" })[id] ?? id, false)).toBe(
      "Strg Umschalt Z",
    );
  });
});

describe("the capture shortcut on the Mac: Control, Command, Option and Shift", () => {
  const mac = (code: string, mods: Parameters<typeof key>[1] = {}) => hotkeyFrom(key(code, mods), true);

  it("the real Control key is Control and the Command key is Ctrl, written in that order, then Option and Shift", () => {
    expect(mac("KeyA", { ctrl: true, alt: true, win: true })).toBe("Control+Ctrl+Alt+A");
    expect(mac("KeyA", { ctrl: true, alt: true, shift: true, win: true })).toBe("Control+Ctrl+Alt+Shift+A");
    expect(mac("KeyA", { win: true })).toBe("Ctrl+A");
    expect(mac("KeyA", { ctrl: true })).toBe("Control+A");
    expect(mac("KeyA", { alt: true, win: true })).toBe("Ctrl+Alt+A");
  });
  it("there is no Win key: Command is never recorded as Win", () => {
    expect(mac("KeyS", { win: true, shift: true })).toBe("Ctrl+Shift+S");
    expect(hotkeyFrom(key("KeyS", { win: true, shift: true }), false)).toBe("Shift+Win+S");
  });
  it("it needs Command or Control: Option and Shift alone type characters (Option+A is å), so those are refused", () => {
    expect(mac("KeyA", { alt: true })).toBe("shiftOnly");
    expect(mac("KeyA", { shift: true })).toBe("shiftOnly");
    expect(mac("KeyA", { alt: true, shift: true })).toBe("shiftOnly");
    expect(mac("Digit1", { alt: true })).toBe("shiftOnly");
    // Keys that type nothing are fine with Option or Shift alone, as on Windows
    expect(mac("F5", { alt: true })).toBe("Alt+F5");
    expect(mac("F9", { shift: true })).toBe("Shift+F9");
    expect(mac("PrintScreen", { shift: true })).toBe("Shift+PrintScreen");
  });
  it("incomplete: only a modifier pressed, or none", () => {
    expect(mac("MetaLeft", { win: true })).toBeUndefined();
    expect(mac("KeyA")).toBeUndefined();
  });
  it("on Windows nothing changed: Control is Ctrl, and Alt alone is enough", () => {
    expect(hotkeyFrom(key("KeyA", { ctrl: true, alt: true }), false)).toBe("Ctrl+Alt+A");
    expect(hotkeyFrom(key("KeyA", { alt: true }), false)).toBe("Alt+A");
  });
});

describe("drawing a shortcut: one keycap per part, in the order of the platform", () => {
  it("the Mac puts the modifiers in its order, ⌃ ⌥ ⇧ ⌘, then the key", () => {
    expect(hotkeyParts("Control+Ctrl+Alt+A", true)).toEqual(["Control", "Alt", "Ctrl", "A"]);
    expect(hotkeyParts("Ctrl+Shift+Alt+Left", true)).toEqual(["Alt", "Shift", "Ctrl", "Left"]);
    expect(hotkeyParts("Shift+F9", true)).toEqual(["Shift", "F9"]);
  });
  it("Windows keeps the order that was recorded", () => {
    expect(hotkeyParts("Ctrl+Alt+A", false)).toEqual(["Ctrl", "Alt", "A"]);
    expect(hotkeyParts("Shift+Win+S", false)).toEqual(["Shift", "Win", "S"]);
  });
  it("the Control key is ⌃ on the Mac and stays a word elsewhere", () => {
    const t = (id: string) => id;
    expect(keycaps("Control", t, true)).toBe("⌃");
    expect(keycaps("Control Ctrl Alt A", t, true)).toBe("⌃⌥⌘A");
    expect(keycaps("Control", t, false)).toBe("Control");
  });
});
