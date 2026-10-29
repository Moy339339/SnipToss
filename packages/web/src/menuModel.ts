import type { MenuItem } from "./Menu";
import type { TopMenu } from "./MenuBar";

// The Mac draws the menus itself (NSMenu, at the top of the screen). The page stays the one place that knows what the menus say, which items
// are greyed out or ticked, and what each one does: it turns the menus into plain data, sends them to the shell (setMenus), and when the
// shell reports a click (menuCommand) it runs the action it kept for that item. Nothing here touches React or the DOM.

export type Platform = "windows" | "mac";

/** A shortcut as the shell needs it to draw it and to give the item its key: `cmd` is the Command key (the "Ctrl" of the key names) */
export interface NativeShortcut {
  /** A lower case letter or digit, a mark, or a key name like ArrowUp, Enter, Home, F5 */
  key: string;
  cmd: boolean;
  alt: boolean;
  shift: boolean;
}

export interface NativeSwatch {
  id: string;
  label: string;
  /** Hex color */
  color: string;
  /** The digit key that picks it, drawn on the right */
  key?: string;
  checked: boolean;
}

export interface NativeItem {
  /** Only means something together with the version of the model it came in (see NativeMenuSync) */
  id: string;
  label: string;
  title?: string;
  disabled: boolean;
  checked: boolean;
  shortcut?: NativeShortcut;
  /** Text the item shows on its right that is not one shortcut ("3 checked", "? / F1"): the shell adds it to the title */
  hintText?: string;
  role?: "undo" | "redo";
  /** A row of choices (mark color): the item opens them as a list; the row itself does nothing */
  swatches?: NativeSwatch[];
}

export type NativeEntry = NativeItem | "-";

export interface NativeMenu {
  label: string;
  items: NativeEntry[];
}

/** What setMenus carries */
export interface SetMenus {
  /** Counts up with every model that differs from the one before; menuCommand brings it back */
  version: number;
  /** A dialog is open: the shell greys out everything the page gave it (the menu bar is behind the dialog on Windows too) */
  modal: boolean;
  menus: NativeMenu[];
}

/** What menuCommand carries: the item, and the version of the model it was in */
export interface NativeCommand {
  id: string;
  version: number;
}

const ARROWS: Record<string, string> = { "↑": "ArrowUp", "↓": "ArrowDown", "←": "ArrowLeft", "→": "ArrowRight" };
const KEY_WORDS = new Set([
  "Enter",
  "Delete",
  "Backspace",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "Space",
  "Escape",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
]);

/** One key as the shell names it; undefined if it is none of the keys a menu item can show */
function keyOf(token: string): string | undefined {
  if (ARROWS[token]) return ARROWS[token];
  if (/^F\d{1,2}$/.test(token) || KEY_WORDS.has(token)) return token;
  if (token === "Esc") return "Escape";
  if (/^[A-Z0-9]$/.test(token)) return token.toLowerCase();
  if (/^[a-z]$/.test(token) || /^[,.+\-=[\]\\/;'`]$/.test(token)) return token;
  return undefined;
}

const shortcutOf = (mods: Set<string>, key: string): NativeShortcut => ({
  key,
  cmd: mods.has("Ctrl"),
  alt: mods.has("Alt"),
  shift: mods.has("Shift"),
});

/**
 * The text an item shows on its right (Windows spelling, "Ctrl Shift O") → a shortcut when it is exactly modifiers and one key, otherwise
 * the text itself. On the Mac the "Ctrl" of these texts is the Command key, as everywhere in the page (keys.ts)
 */
export function parseHint(hint: string | undefined): { shortcut?: NativeShortcut; hintText?: string } {
  if (!hint) return {};
  const tokens = hint.split(" ");
  const mods = new Set<string>();
  while (tokens.length > 1 && ["Ctrl", "Alt", "Shift"].includes(tokens[0])) mods.add(tokens.shift()!);
  const key = tokens.length === 1 ? keyOf(tokens[0]) : undefined;
  return key === undefined ? { hintText: hint } : { shortcut: shortcutOf(mods, key) };
}

/** A key name as keys.ts and pressKey write it ("Shift+ArrowLeft", "Ctrl+=", "Ctrl++", "Space") → a shortcut */
export function parseKeyName(name: string): NativeShortcut | undefined {
  const parts = name.split("+");
  let key = parts.pop() || "+"; // "Ctrl++" leaves an empty string after the split
  if (name.endsWith("++")) parts.pop();
  const mods = new Set(parts);
  key = key.length === 1 ? (/^[A-Za-z0-9]$/.test(key) ? key.toLowerCase() : key) : key;
  const known = keyOf(key.length === 1 ? key.toUpperCase() : key) ?? (key.length === 1 ? key : undefined);
  return known === undefined ? undefined : shortcutOf(mods, known);
}

const forPlatform = (item: MenuItem | "-", platform: Platform) => item === "-" || item.only === undefined || item.only === platform;

/** Leaving items out can leave a separator at an end or two in a row: only separators between items stay */
function tidy(items: (MenuItem | "-")[]): (MenuItem | "-")[] {
  const out: (MenuItem | "-")[] = [];
  for (const item of items) {
    if (item === "-" && (out.length === 0 || out[out.length - 1] === "-")) continue;
    out.push(item);
  }
  while (out[out.length - 1] === "-") out.pop();
  return out;
}

/**
 * The menus as data, and the action of every item they contain. Ids are positions (`menu.item`, `menu.item.swatch`) and mean something only
 * within one serialization: `actions` is what to run for them, and it must be kept as long as the shell can still answer with them
 */
export function serializeMenus(menus: TopMenu[], platform: Platform): { model: NativeMenu[]; actions: Map<string, () => void> } {
  const actions = new Map<string, () => void>();
  const model = menus.map((menu, m): NativeMenu => {
    const entries = tidy(menu.items().filter((item) => forPlatform(item, platform)));
    return {
      label: menu.label,
      items: entries.map((item, i): NativeEntry => {
        if (item === "-") return "-";
        const id = `${m}.${i}`;
        const native: NativeItem = { id, label: item.label, disabled: !!item.disabled, checked: !!item.checked };
        if (item.title) native.title = item.title;
        if (item.role) native.role = item.role;
        const byKeys = item.keys ? parseKeyName(item.keys) : undefined;
        const hint = parseHint(item.hint);
        const shortcut = byKeys ?? hint.shortcut;
        if (shortcut) native.shortcut = shortcut;
        else if (hint.hintText) native.hintText = hint.hintText;
        if (item.swatches) {
          native.swatches = item.swatches.map((s, k) => {
            const swatch: NativeSwatch = { id: `${id}.${k}`, label: s.label, color: s.color, checked: s.checked };
            if (s.key) swatch.key = s.key;
            actions.set(swatch.id, s.onClick);
            return swatch;
          });
        } else {
          actions.set(id, item.onClick);
        }
        return native;
      }),
    };
  });
  return { model, actions };
}

interface Kept {
  actions: Map<string, () => void>;
  roles: Map<string, "undo" | "redo">;
  modal: boolean;
}

/**
 * The state between the page and the shell's menus. `update` is called with the menus as they are now; it sends them (setMenus) only when
 * they differ from what the shell has. A command (menuCommand) names the version of the model the item was in, because the menus may have
 * been sent again between the click and its arrival (a note got selected, an item appeared): an id means something only in its own version,
 * so the actions of the last few versions are kept, and a command from an older one is dropped and logged rather than run on a different item
 */
export class NativeMenuSync {
  private version = 0;
  private last = "";
  private readonly kept = new Map<number, Kept>();

  constructor(
    private readonly options: { send: (model: SetMenus) => void; log: (line: string) => void; platform: Platform; keep?: number },
  ) {}

  /** Returns whether the menus were sent */
  update(menus: TopMenu[], modal: boolean): boolean {
    const { model, actions } = serializeMenus(menus, this.options.platform);
    const json = JSON.stringify({ modal, model });
    if (json === this.last) return false;
    this.last = json;
    this.version += 1;
    const roles = new Map<string, "undo" | "redo">();
    for (const menu of model) for (const item of menu.items) if (item !== "-" && item.role) roles.set(item.id, item.role);
    this.kept.set(this.version, { actions, roles, modal });
    for (const old of this.kept.keys()) if (old <= this.version - (this.options.keep ?? 3)) this.kept.delete(old);
    this.options.send({ version: this.version, modal, menus: model });
    return true;
  }

  /**
   * A command from the shell. `inTextBox`: the caret is in a text box; then undo and redo are the box's own (`textUndo`), not the notes'.
   * Returns whether something ran
   */
  run(command: NativeCommand, inTextBox: boolean, textUndo?: (what: "undo" | "redo") => void): boolean {
    const kept = this.kept.get(command.version);
    if (!kept) {
      this.options.log(`menu command ${command.id} came from an old menu (version ${command.version}) and was dropped`);
      return false;
    }
    // The menu bar is behind a dialog on Windows; the Mac's menus are greyed out as long as one is open, and a late click does nothing
    if (kept.modal) return false;
    const action = kept.actions.get(command.id);
    if (!action) {
      this.options.log(`menu command ${command.id} is not in menu version ${command.version} and was dropped`);
      return false;
    }
    const role = kept.roles.get(command.id);
    if (role && inTextBox && textUndo) {
      textUndo(role);
      return true;
    }
    action();
    return true;
  }
}
