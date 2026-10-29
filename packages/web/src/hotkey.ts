// Recording the Screen Capture shortcut (Settings → Screen Capture): a key pressed in the browser → the notation the shell's GlobalHotKey
// accepts, with the same rules as the shell.

import { platform } from "./host";

/**
 * A keyboard key (e.code) → the notation accepted by the shell's GlobalHotKey.TryParse (WPF Key names). It used to accept only letters,
 * digits and F1~F24
 */
const NAMED_KEYS: Record<string, string> = {
  PrintScreen: "PrintScreen",
  Space: "Space",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  ArrowUp: "Up",
  ArrowDown: "Down",
  Insert: "Insert",
  Home: "Home",
  End: "End",
  PageUp: "PageUp",
  PageDown: "PageDown",
  Pause: "Pause",
};

/** The human-readable form, like shortcuts elsewhere in the UI (same as the shell's GlobalHotKey.Pretty): "Ctrl+Alt+A" → "Ctrl Alt A" */
export const prettyKeys = (hotkey: string) => hotkey.split("+").join(" ");

/** The Mac writes the modifiers of a shortcut in this order, ⌘ last; "Control" is the real Control key, "Ctrl" the Command key */
const MAC_MODIFIER_ORDER = ["Control", "Alt", "Shift", "Ctrl"];

/** The parts of a shortcut in the order they are drawn (one keycap each): on the Mac the modifiers come in the Mac's order, ⌃ ⌥ ⇧ ⌘ */
export function hotkeyParts(hotkey: string, mac = platform === "mac"): string[] {
  const parts = hotkey.split("+");
  if (!mac) return parts;
  return [...MAC_MODIFIER_ORDER.filter((m) => parts.includes(m)), ...parts.filter((p) => !MAC_MODIFIER_ORDER.includes(p))];
}

const KEYCAP_NAMES = /\b(Ctrl|Shift|Enter|Esc|Delete|Backspace|Space|Home|End)\b/g;
/** The keycaps the Mac draws as symbols; Space, Home and End stay words there */
const MAC_KEYCAPS: Record<string, string> = { Ctrl: "⌘", Shift: "⇧", Enter: "↩", Esc: "⎋", Delete: "⌦", Backspace: "⌫" };
/**
 * Key names on keycaps follow the UI language (messages keycap.*, matching Windows in each language and the wording in running text:
 * German Strg, Umschalt; French Maj, Entrée…). Only these whole words are replaced; letters, F keys, arrow keys and symbols are untouched.
 * Shortcuts on the right of menus, the shortcut list and the Screen Capture shortcut description all go through this (the text used to
 * say Strg while the keycap said Ctrl)
 */
export const keycaps = (text: string, t: (id: string) => string, mac = platform === "mac") =>
  mac ? macKeycaps(text, t) : text.replace(KEYCAP_NAMES, (k) => t(`keycap.${k}`));

/**
 * The Mac's way to write a shortcut: symbols in the order ⌃ ⌥ ⇧ ⌘ and no space before the key ("Ctrl Shift Z" → "⇧⌘Z"; the "Ctrl" of these
 * names is the Command key there, see keys.ts). Names without a symbol (Space, Home, End) go through the language's key name messages
 */
function macKeycaps(text: string, t: (id: string) => string): string {
  const run = new RegExp(`(?<![\\p{L}\\p{N}])((?:Control|Ctrl|Alt|Shift)(?: (?:Control|Ctrl|Alt|Shift))*)(?: (\\S+))?`, "gu");
  const symbolOf: Record<string, string> = { Control: "⌃", Ctrl: "⌘", Alt: "⌥", Shift: "⇧" };
  const order = ["⌃", "⌥", "⇧", "⌘"];
  const name = (k: string) => MAC_KEYCAPS[k] ?? (/^(Space|Home|End)$/.test(k) ? t(`keycap.${k}`) : k);
  return text
    .replace(run, (_all, mods: string, key?: string) => {
      const symbols = new Set(mods.split(" ").map((m) => symbolOf[m]));
      return order.filter((s) => symbols.has(s)).join("") + (key === undefined ? "" : name(key));
    })
    .replace(KEYCAP_NAMES, (k) => name(k));
}

/**
 * Keys used for typing and selecting text (with Shift it selects text, Shift+Insert pastes): not accepted with Shift alone, same as the
 * shell's GlobalHotKey.UsedForText
 */
const TEXT_KEYS = new Set(["Space", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", "Insert"]);

/**
 * A browser key → the shortcut notation; unsupported keys return undefined. text = keys used for typing and selecting text (letters,
 * digits, Space, arrow keys, Home / End, page keys, Insert)
 */
export function hotkeyKey(code: string): { key: string; text: boolean } | undefined {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return { key: letter[1], text: true };
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return { key: digit[1], text: true };
  const pad = /^Numpad(\d)$/.exec(code);
  if (pad) return { key: `NumPad${pad[1]}`, text: true };
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return { key: code, text: false };
  if (NAMED_KEYS[code]) return { key: NAMED_KEYS[code], text: TEXT_KEYS.has(code) };
  return undefined;
}

/**
 * Whether the pressed combination can be a global shortcut: it needs Ctrl, Alt or Win; with only Shift it can pair only with keys not used
 * for typing or selecting text, such as F keys, PrintScreen and Pause: once Shift+A is registered as a global shortcut, no program can type
 * a capital A and Shift+← cannot select text. Same rule as the shell's GlobalHotKey.Set.
 * On the Mac the modifiers are Control ("Control"), Command ("Ctrl", as everywhere on the Mac), Option ("Alt") and Shift, written in that
 * order, and it needs Command or Control: Option and Shift alone type characters (Option+A is å)
 * Returns the shortcut notation; undefined if it is incomplete (only a modifier pressed, or no modifier); "shiftOnly" if it is not allowed
 */
export function hotkeyFrom(
  e: Pick<KeyboardEvent, "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">,
  mac = platform === "mac",
): string | "shiftOnly" | undefined {
  const k = hotkeyKey(e.code);
  const mods = (
    mac
      ? [e.ctrlKey && "Control", e.metaKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift"]
      : [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Win"]
  ).filter(Boolean) as string[];
  if (!k || mods.length === 0) return undefined;
  const enough = mac ? e.ctrlKey || e.metaKey : e.ctrlKey || e.altKey || e.metaKey;
  if (!enough && k.text) return "shiftOnly";
  return [...mods, k.key].join("+");
}
