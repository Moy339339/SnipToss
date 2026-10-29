// Shortcuts the way the Mac writes them. The messages spell shortcuts with words ("Copy as text (Ctrl Shift A)", German "Strg Umschalt A");
// on the Mac the same shortcut is ⇧⌘A: the Ctrl of the messages is the Command key there (keys.ts), and the Mac writes modifiers as
// symbols in the order ⌃ ⌥ ⇧ ⌘ with no space before the key. Applied once to the messages when the UI starts on the Mac (App.tsx), so no
// message has to be written twice

/** The key names of a language (the messages keycap.*), which are what that language's messages use inside a shortcut */
export interface KeyWords {
  ctrl: string;
  shift: string;
  enter: string;
  esc: string;
  delete: string;
  backspace: string;
}

/** Modifiers in the order the Mac writes them */
const ORDER = ["⌃", "⌥", "⇧", "⌘"];

/** A key name as the Mac draws it on a keycap, or undefined when the word stays as it is (Space, Home, End) */
export function macKeyWord(name: string, w: Pick<KeyWords, "enter" | "esc" | "delete" | "backspace">): string | undefined {
  if (name === "Enter" || name === w.enter) return "↩";
  if (name === "Esc" || name === w.esc) return "⎋";
  if (name === "Delete" || name === w.delete) return "⌦";
  if (name === "Backspace" || name === w.backspace) return "⌫";
  return undefined;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const alternation = (words: string[]) =>
  [...new Set(words.filter(Boolean))]
    .sort((a, b) => b.length - a.length)
    .map(escapeRe)
    .join("|");

/**
 * Rewrites the shortcuts inside a text for the Mac: "Ctrl Shift A" → "⇧⌘A", "Ctrl ," → "⌘,", "Alt 1–4" → "⌥1–4", "Shift Enter" → "⇧↩",
 * "hold Ctrl to add" → "hold ⌘ to add", "Ctrl-click" → "⌘-click". Only a run of modifier words counts: a key that follows must be one
 * capital letter, digit or punctuation mark, an F key, or a key name, so ordinary words after a modifier are left alone
 */
export function macifyShortcuts(text: string, w: KeyWords): string {
  const symbolOf = new Map<string, string>();
  for (const word of ["Ctrl", w.ctrl]) symbolOf.set(word, "⌘");
  for (const word of ["Shift", w.shift]) symbolOf.set(word, "⇧");
  symbolOf.set("Alt", "⌥");
  const mod = alternation([...symbolOf.keys()]);
  // A modifier word ends there: Shifting and Controller are not modifiers
  const m = `(?:${mod})(?![\\p{L}\\p{N}])`;
  const named = alternation(["Enter", "Esc", "Delete", "Backspace", "Space", "Home", "End", w.enter, w.esc, w.delete, w.backspace]);
  // Not glued to a letter or digit before the run; the key after it is one capital, digit or mark with no letter or digit after it, an F
  // key, or a key name
  const re = new RegExp(
    `(?<![\\p{L}\\p{N}])((?:${m})(?:[ +]${m})*)(?:[ +](?:(F\\d{1,2}|[A-Z0-9,.+\\-=\\[\\]\\\\/;'↑↓←→])(?![A-Za-z0-9])|(${named})(?![\\p{L}\\p{N}])))?`,
    "gu",
  );
  return text.replace(re, (_all, run: string, key?: string, word?: string) => {
    const symbols = new Set(run.split(/[ +]/).map((name) => symbolOf.get(name) ?? ""));
    const mods = ORDER.filter((s) => symbols.has(s)).join("");
    if (key !== undefined) return mods + key;
    if (word !== undefined) return mods + (macKeyWord(word, w) ?? ` ${word}`).replace(/^ /, "");
    return mods;
  });
}

/** The key names of a language, read from its own messages (keycap.*; a language that has none uses the English names) */
export function keyWordsOf(messages: Record<string, string>): KeyWords {
  const pick = (name: string) => messages[`keycap.${name}`] ?? name;
  return {
    ctrl: pick("Ctrl"),
    shift: pick("Shift"),
    enter: pick("Enter"),
    esc: pick("Esc"),
    delete: pick("Delete"),
    backspace: pick("Backspace"),
  };
}

/** All messages of a language for the Mac: the shortcuts written inside them are rewritten, the key name messages themselves are left alone */
export function macifyMessages(messages: Record<string, string>): Record<string, string> {
  const words = keyWordsOf(messages);
  return Object.fromEntries(
    Object.entries(messages).map(([id, text]) => [id, id.startsWith("keycap.") ? text : macifyShortcuts(text, words)]),
  );
}
