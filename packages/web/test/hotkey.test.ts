import { describe, expect, it } from "vitest";
import { hotkeyFrom } from "../src/hotkey";

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
