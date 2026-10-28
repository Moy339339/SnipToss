// Mnemonic letters of the menu bar (ADR-0001 item 10): each language marks them in its own messages, and MenuBar displays them accordingly and opens with Alt+letter

/**
 * A menu name in a message → label and mnemonic letter: "文件(&F)" = "(F)" appended after the label; "&Datei" and "A&nnotieren" = the letter after & (an accented letter counts as the unaccented one: É → E).
 * Without & there is no mnemonic letter
 */
export function mnemonic(label: string): { label: string; key: string; at?: number } {
  const suffix = /^(.*)\(&(\w)\)$/u.exec(label);
  if (suffix) return { label: suffix[1], key: suffix[2].toUpperCase() };
  const at = label.indexOf("&");
  if (at < 0 || at === label.length - 1) return { label, key: "" };
  const text = label.slice(0, at) + label.slice(at + 1);
  return { label: text, key: text[at].normalize("NFD")[0].toUpperCase(), at };
}
