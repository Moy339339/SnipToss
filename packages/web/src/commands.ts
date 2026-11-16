import { platform } from "./host";
import { keycaps } from "./hotkey";

// The table of commands that have keyboard shortcuts: one row per action, with a stable id (what Settings stores when a shortcut is changed),
// the message for its name, the group it is listed under and its default keys (key names as in useKeys: "Ctrl+O", "Shift+ArrowLeft", "?").
// Settings → Keyboard Shortcuts lists this table; docs/shortcuts.md is the same list in prose.
//
// fixed rows are shown for reference but cannot be changed: mouse gestures, and keys whose meaning is a convention people expect everywhere
// (Esc cancels, Enter confirms, Delete deletes, the arrow keys move, list navigation) or that stand for a range (1–8, Alt 1–4).

export type CommandGroup = "global" | "capture" | "list" | "notes" | "canvas" | "video";

export const COMMAND_GROUPS: readonly CommandGroup[] = ["global", "capture", "notes", "canvas", "video", "list"];

export interface Command {
  /** Stable id: written into the settings file when the user changes the keys, never rename */
  id: string;
  /** Message id of the name */
  label: string;
  group: CommandGroup;
  /** Default keys (key names as in useKeys); the first is the one shown in menus and tooltips */
  keys: string[];
  /** More default keys that are not listed (Ctrl and the =/+ key pressed without Shift is "Ctrl+="); dropped once the keys are changed */
  alias?: string[];
  /** Shown but not changeable; shown = how the keys are written (literal keys, or messages starting with key.). Its keys (if any) are still taken: no other command can use them */
  fixed?: { shown: string[] };
  /** Where the keys act, which decides what clashes with what (see clashes); by default from the group */
  scope?: Scope;
  /** Only on this platform (the menu bar the UI draws itself and Shift+F10 exist only on Windows) */
  only?: "windows" | "mac";
  /** The Screen Capture shortcut: a global shortcut registered by the shell, stored with the capture settings rather than here */
  global?: true;
  /** The key the Mac's native menu gives the item while the keys are unchanged, when it differs from the first listed one (⌘= rather than ⌘+, which needs Shift) */
  menuKey?: string;
}

const c = <const I extends string>(id: I, label: string, group: CommandGroup, keys: string[], extra: Partial<Command> = {}) => ({
  ...extra,
  id,
  label,
  group,
  keys,
});
const fixed = <const I extends string>(
  id: I,
  label: string,
  group: CommandGroup,
  shown: string[],
  keys: string[] = [],
  extra: Partial<Command> = {},
) => ({
  ...extra,
  id,
  label,
  group,
  keys,
  fixed: { shown },
});
const digits = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i + 1}`);
/** The four arrow keys, alone and with Shift (a mark moves by 1 or by 10) */
const arrows = () => ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].flatMap((k) => [k, `Shift+${k}`]);

const TABLE = [
  // Global
  c("file.addFiles", "sc.addFiles", "global", ["Ctrl+O"]),
  c("file.addFolder", "sc.addFolder", "global", ["Ctrl+Shift+O"]),
  c("file.paste", "sc.paste", "global", ["Ctrl+V"]),
  c("file.find", "shortcuts.find", "global", ["Ctrl+P"]),
  c("file.refresh", "sc.refresh", "global", ["F5"]),
  c("view.prevItem", "menu.view.prevItem", "global", ["Ctrl+ArrowUp"]),
  c("view.nextItem", "menu.view.nextItem", "global", ["Ctrl+ArrowDown"]),
  c("view.toggleLeft", "sc.toggleLeft", "global", ["Ctrl+B"]),
  c("view.toggleRight", "sc.toggleRight", "global", ["Ctrl+Alt+B"]),
  c("view.toggleBoth", "sc.toggleBoth", "global", ["Ctrl+\\"]),
  c("window.fullscreen", "sc.fullscreen", "global", ["F11"]),
  c("app.settings", "sc.settings", "global", ["Ctrl+,"]),
  c("app.shortcuts", "sc.shortcuts", "global", ["?", "F1"]),
  fixed(
    "app.menus",
    "sc.menus",
    "global",
    ["Alt", "F / E / V / N / P / W / H"],
    // F10 enters the menu bar like a lone Alt (MenuBar.tsx)
    [..."FEVNPWH"].map((k) => `Alt+${k}`).concat("F10"),
    { only: "windows" },
  ),
  // The Mac's window keys, handled by the page like every shortcut (Workspace.tsx); listed so that no command takes them
  fixed("window.close", "menu.file.closeWindow", "global", ["Ctrl", "W"], ["Ctrl+W"], { only: "mac" }),
  fixed("window.minimize", "menu.window.minimize", "global", ["Ctrl", "M"], ["Ctrl+M"], { only: "mac" }),
  // The keys of the Mac's app menu (MainMenu.swift), named as the menu names them: the system's, listed so that no command takes them.
  // ⌘Q quits from the capture overlay too (it lets ⌘Q through to the menu), so it is taken there as well. Shown one keycap per part, as the
  // changeable keys are, in the Mac's order (⌥ before ⌘)
  fixed("app.hide", "shell.menu.hide", "global", ["Ctrl", "H"], ["Ctrl+H"], { only: "mac" }),
  fixed("app.hideOthers", "shell.menu.hideOthers", "global", ["Alt", "Ctrl", "H"], ["Ctrl+Alt+H"], { only: "mac" }),
  fixed("app.quit", "shell.menu.quit", "global", ["Ctrl", "Q"], ["Ctrl+Q"], { only: "mac", scope: "app" }),

  // Screen Capture (the overlay drawn by the shell)
  c("capture.start", "sc.capture.start", "capture", [], { global: true }),
  fixed("capture.select", "sc.capture.select", "capture", ["key.clickDrag"]),
  c("capture.rect", "tool.rect", "capture", ["R"]),
  c("capture.ellipse", "sc.capture.ellipse", "capture", ["O"]),
  c("capture.arrow", "tool.arrow", "capture", ["A"]),
  c("capture.pen", "tool.pen", "capture", ["B"]),
  c("capture.mosaic", "sc.capture.mosaic", "capture", ["M"]),
  c("capture.text", "sc.capture.text", "capture", ["T"]),
  c("capture.point", "tool.point", "capture", ["C"]),
  c("capture.whole", "sc.notes.whole", "capture", ["N"]),
  c("capture.undo", "sc.notes.undo", "capture", ["Ctrl+Z"]),
  fixed("capture.color", "sc.capture.color", "capture", ["1–8"], digits("", 8)),
  fixed("capture.nudge", "sc.notes.nudge", "capture", ["↑ ↓ ← →"], arrows()),
  fixed("capture.delete", "sc.capture.delete", "capture", ["Delete"], ["Delete", "Backspace"]),
  // Ctrl+C finishes too (copy, as in other capture tools)
  fixed("capture.done", "sc.capture.done", "capture", ["Enter"], ["Enter", "Ctrl+C"]),
  fixed("capture.cancel", "sc.capture.cancel", "capture", ["Esc"], ["Escape"], { only: "windows" }),
  // The Mac's overlay also cancels with ⌘W and ⌘. (OverlayStateMachine.swift), the Mac's keys for closing and for cancelling
  fixed("capture.cancelMac", "sc.capture.cancel", "capture", ["Esc / Ctrl W / Ctrl ."], ["Escape", "Ctrl+W", "Ctrl+."], { only: "mac" }),

  // Notes
  c("tool.select", "tool.select.tip", "notes", ["V"]),
  c("tool.hand", "sc.notes.hand", "notes", ["H"]),
  c("tool.point", "tool.point", "notes", ["C"]),
  c("tool.rect", "tool.rect", "notes", ["R"]),
  c("tool.pen", "tool.pen", "notes", ["B"]),
  c("tool.arrow", "tool.arrow", "notes", ["A"]),
  fixed("tool.holdHand", "sc.notes.holdHand", "notes", ["key.holdH"]),
  fixed("tool.holdTools", "sc.notes.holdTools", "notes", ["key.holdTools"]),
  c("note.timed", "sc.notes.timed", "notes", ["T"]),
  c("note.whole", "sc.notes.whole", "notes", ["N"]),
  c("note.folder", "sc.notes.folder", "notes", ["Shift+N"]),
  // Ctrl+Enter saves too, also with the focus outside the composer (Composer.tsx)
  fixed("note.save", "sc.notes.save", "notes", ["Enter"], ["Enter", "Ctrl+Enter"], { scope: "composer" }),
  fixed("note.category", "sc.notes.category", "notes", ["Alt", "1–4"], digits("Alt+", 4), { scope: "composer" }),
  c("note.undoPlace", "sc.notes.undoPlace", "notes", ["Alt+Z"], { scope: "composer" }),
  c("note.prev", "menu.note.prev", "notes", ["["]),
  c("note.next", "menu.note.next", "notes", ["]"]),
  c("note.find", "shortcuts.findNotes", "notes", ["Ctrl+F"]),
  c("note.check", "sc.notes.check", "notes", ["X"]),
  c("note.done", "shortcuts.done", "notes", ["D"]),
  c("note.wontfix", "shortcuts.wontfix", "notes", ["Shift+D"]),
  fixed("note.color", "sc.notes.color", "notes", ["1–8"], digits("", 8)),
  c("note.copyText", "sc.notes.copy", "notes", ["Ctrl+Shift+A"]),
  c("note.copyImages", "sc.notes.copyImages", "notes", ["Ctrl+Shift+I"]),
  fixed("note.nudge", "sc.notes.nudge", "notes", ["↑ ↓ ← →"], [], { scope: "selection" }),
  fixed("note.editDelete", "sc.notes.editDelete", "notes", ["Enter / Delete"], ["Enter", "Delete", "Backspace"]),
  c("edit.undo", "sc.notes.undo", "notes", ["Ctrl+Z"]),
  c("edit.redo", "cmd.redo", "notes", ["Ctrl+Shift+Z", "Ctrl+Y"]),
  fixed("note.cancel", "sc.notes.cancel", "notes", ["Esc"], ["Escape"]),

  // Canvas
  fixed("view.wheelZoom", "sc.canvas.wheel", "canvas", ["Ctrl", "key.wheel"]),
  c("view.zoomIn", "menu.view.zoomIn", "canvas", ["Ctrl++"], { alias: ["Ctrl+="], menuKey: "Ctrl+=" }),
  c("view.zoomOut", "menu.view.zoomOut", "canvas", ["Ctrl+-"]),
  c("view.fit", "sc.canvas.fit", "canvas", ["Shift+1", "Ctrl+0"]),
  c("view.fill", "sc.canvas.fill", "canvas", ["Shift+2"]),
  c("view.actual", "sc.canvas.actual", "canvas", ["Shift+0"]),
  fixed("view.dblclick", "sc.canvas.dblclick", "canvas", ["key.dblclick"]),
  c("view.marks", "sc.canvas.marks", "canvas", ["Shift+H"]),
  fixed("view.pan", "sc.canvas.pan", "canvas", ["key.middleDrag"]),
  fixed("view.stepImage", "sc.canvas.stepItem", "canvas", ["← / →"], ["ArrowLeft", "ArrowRight"], { scope: "image" }),

  // Video
  c("play.toggle", "menu.play.toggle", "video", ["Space", "K"]),
  c("play.back5", "menu.play.back5", "video", ["J"]),
  c("play.forward5", "menu.play.forward5", "video", ["L"]),
  c("play.prevFrame", "menu.play.prevFrame", "video", ["ArrowLeft"]),
  c("play.nextFrame", "menu.play.nextFrame", "video", ["ArrowRight"]),
  c("play.back1", "menu.play.back1", "video", ["Shift+ArrowLeft"]),
  c("play.forward1", "menu.play.forward1", "video", ["Shift+ArrowRight"]),
  c("play.start", "menu.play.start", "video", ["Home"]),
  c("play.end", "menu.play.end", "video", ["End"]),
  c("play.slower", "menu.play.slower", "video", [","]),
  c("play.faster", "menu.play.faster", "video", ["."]),
  c("play.mute", "menu.play.mute", "video", ["M"]),
  c("play.volumeUp", "sc.video.volumeUp", "video", ["ArrowUp"]),
  c("play.volumeDown", "sc.video.volumeDown", "video", ["ArrowDown"]),
  c("play.loop", "sc.video.loop", "video", ["Ctrl+L"]),
  // While writing a note on a video; a bare I / O works too when the caret is not in the text box (Composer.tsx)
  c("play.rangeIn", "sc.video.rangeIn", "video", ["Alt+I"], { alias: ["I"] }),
  c("play.rangeOut", "sc.video.rangeOut", "video", ["Alt+O"], { alias: ["O"] }),

  // Library (list navigation: the keys every list has, not changeable)
  fixed("list.step", "sc.list.step", "list", ["↑ / ↓"]),
  fixed("list.range", "sc.list.range", "list", ["Shift", "↑ / ↓"]),
  fixed("list.all", "sc.list.all", "list", ["Ctrl", "A"]),
  fixed("list.marquee", "sc.list.marquee", "list", ["key.drag"]),
  fixed("list.clear", "sc.list.clear", "list", ["Esc"]),
  fixed("list.expand", "sc.list.expand", "list", ["→ / ←"]),
  fixed("list.open", "sc.list.open", "list", ["key.enterSpace"]),
  fixed("list.copy", "sc.list.copy", "list", ["Ctrl", "C"]),
  fixed("list.remove", "sc.list.remove", "list", ["Delete"]),
  // Opens the context menu wherever the focus is, so its key is taken in the whole window
  fixed("list.menu", "sc.list.menu", "list", ["Shift", "F10"], ["Shift+F10"], { only: "windows", scope: "main" }),
] satisfies readonly Command[];

/** The id of a command in the table: what useCommands, runCommand and the menus name commands by (a typo does not compile) */
export type CommandId = (typeof TABLE)[number]["id"];

export const COMMANDS: readonly Command[] = TABLE;

const BY_ID = new Map(COMMANDS.map((x) => [x.id, x]));

export function commandById(id: CommandId): Command {
  return BY_ID.get(id)!;
}

/**
 * Where a command's keys act: the main window (main), only on a video (video) or an image (image), while writing a note (composer), with a mark
 * selected (selection), in the library (list), on the capture overlay (capture), everywhere in the app, the capture overlay included (app)
 */
export type Scope = "main" | "video" | "image" | "composer" | "selection" | "list" | "capture" | "app";

export function scopeOf(cmd: Command): Scope {
  if (cmd.scope) return cmd.scope;
  return cmd.group === "capture" ? "capture" : cmd.group === "video" ? "video" : cmd.group === "list" ? "list" : "main";
}

/**
 * Whether keys in these two scopes can be pressed in the same place. Everything in the main window can: its keys still act while a note is
 * being written, a mark is selected or the library has the focus, and on videos and images alike; only a video is never an image. The
 * capture overlay is a window of its own
 */
export function clashes(a: Scope, b: Scope): boolean {
  if (a === b || a === "app" || b === "app") return true;
  if (a === "capture" || b === "capture") return false;
  const pair = new Set([a, b]);
  return !(pair.has("video") && pair.has("image"));
}

/**
 * A command's name in the interface language. The rows of the Mac's app menu keys use the app menu's own messages, which name the app
 * ("Quit {app}")
 */
export function commandName(cmd: Command, t: (id: string, values?: Record<string, string>) => string): string {
  return t(cmd.label, { app: t("brand.name") });
}

/** The commands of this platform */
export function commandsFor(mac = platform === "mac"): Command[] {
  return COMMANDS.filter((x) => !x.only || x.only === (mac ? "mac" : "windows"));
}

/** Keys changed in Settings: command id → its keys ([] = no shortcut). Commands not listed use their defaults */
export type Bindings = Record<string, string[]>;

/** The keys a command has now (the listed ones) */
export function keysOf(cmd: Command, bindings: Bindings): string[] {
  return bindings[cmd.id] ?? cmd.keys;
}

/** Every key that triggers a command now: the listed ones plus the unlisted defaults while it is unchanged */
export function activeKeys(cmd: Command, bindings: Bindings): string[] {
  return bindings[cmd.id] ?? [...cmd.keys, ...(cmd.alias ?? [])];
}

/** The other command that already uses this key where cmd acts (undefined: free) */
export function clashOf(cmd: Command, key: string, bindings: Bindings, commands: readonly Command[] = commandsFor()): Command | undefined {
  const scope = scopeOf(cmd);
  return commands.find((o) => o.id !== cmd.id && clashes(scope, scopeOf(o)) && activeKeys(o, bindings).includes(key));
}

/** Whether the user changed this command's keys (the same keys as the default in another order do not count) */
export function isChanged(cmd: Command, bindings: Bindings): boolean {
  const now = bindings[cmd.id];
  return now !== undefined && (now.length !== cmd.keys.length || now.some((k, i) => k !== cmd.keys[i]));
}

/** The parts of a key name: "Ctrl++" → ["Ctrl", "+"] (a plain split would lose the plus key) */
export function keyParts(name: string): string[] {
  if (name === "+") return ["+"];
  const parts = name.split("+");
  if (name.endsWith("++")) {
    parts.splice(parts.length - 2, 2, "+");
  }
  return parts;
}

const ARROWS: Record<string, string> = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Escape: "Esc" };

/** The Mac writes modifiers in this order, ⌘ last ("Control" is the Control key, "Ctrl" the Command key) */
const MAC_MODIFIERS = ["Control", "Alt", "Shift", "Ctrl"];

/** How one key name is drawn: one keycap per part, in the platform's modifier order, key names in the interface language */
export function keyCaps(name: string, t: (id: string) => string, mac = platform === "mac"): string[] {
  const parts = keyParts(name).map((p) => ARROWS[p] ?? p);
  const ordered = mac ? [...MAC_MODIFIERS.filter((m) => parts.includes(m)), ...parts.filter((p) => !MAC_MODIFIERS.includes(p))] : parts;
  return ordered.map((p) => keycaps(p, t, mac));
}

/**
 * A key name the way menus write it on their right and tooltips carry it, in the Windows spelling with spaces ("Ctrl+Shift+O" → "Ctrl Shift O",
 * "ArrowUp" → "↑"); keycaps() turns it into the language's key names and the Mac's symbols, menuModel.parseHint into a native shortcut
 */
export function keyHint(name: string): string {
  return keyParts(name)
    .map((p) => ARROWS[p] ?? p)
    .join(" ");
}

/** The first listed key of a command in the menus' spelling (keyHint); undefined when it has none */
export function shortcutHint(id: CommandId, bindings: Bindings): string | undefined {
  const first = keysOf(commandById(id), bindings)[0];
  return first === undefined ? undefined : keyHint(first);
}

/** The key the Mac's native menu shows for a command: its menuKey while unchanged, otherwise the first listed key */
export function menuKeyOf(id: CommandId, bindings: Bindings): string | undefined {
  const cmd = commandById(id);
  return bindings[id] ? bindings[id][0] : (cmd.menuKey ?? cmd.keys[0]);
}

/** The text a key name is searched by: what is drawn on its keycaps, in both the plain and the localized form */
export function keySearchText(name: string, t: (id: string) => string): string {
  return [...keyParts(name), ...keyCaps(name, t)].join(" ").toLowerCase();
}
