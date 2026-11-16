import { useEffect, useEffectEvent } from "react";
import { useIntl, type IntlShape } from "react-intl";
import { activeKeys, commandById, keyHint, keysOf, type Bindings, type Command, type CommandId } from "./commands";
import { HOLD_TOOL_COMMANDS, holdableKeys } from "./holdKeys";
import { keycaps } from "./hotkey";
import { useKeys, type KeyMap } from "./keys";
import { usePrefs } from "./prefs";

// Shortcuts by command: a component names the commands it handles (ids in commands.ts), and the keys come from the table and the keys the
// user changed in Settings → Keyboard Shortcuts (prefs.keybindings). Menus run a command by its id (runCommand), so an item works even when
// its command has no key, and whatever handles the key handles the menu item too.

/** A command's handler; without an event it was run from a menu. Returning false = not handled this time, as in useKeys */
export type CommandHandler = (e?: KeyboardEvent) => void | boolean;
export type CommandMap = Partial<Record<CommandId, CommandHandler>>;

/** The event runCommand sends; useCommands listens to it where it listens to keys, so the same layering applies (modal, first) */
const COMMAND_EVENT = "sniptoss-command";

/** The key map of a set of handlers under the current keys: every key that triggers each command (aliases included while unchanged) */
export function commandKeyMap(handlers: CommandMap, bindings: Bindings): KeyMap {
  const map: KeyMap = {};
  for (const [id, fn] of Object.entries(handlers) as [CommandId, CommandHandler | undefined][]) {
    if (!fn) continue;
    for (const key of activeKeys(commandById(id), bindings)) map[key] ??= fn;
  }
  return map;
}

/**
 * Registers handlers for commands, with the options of useKeys. extra: keys that are not commands (Esc, Enter, the digits, the arrow keys
 * that move a mark); they win over a command on the same key, which the Settings page never allows anyway (fixed keys are taken).
 * bindings: the changed keys, when the caller is above the settings context (App); otherwise they are read from it
 */
export function useCommands(
  handlers: CommandMap,
  options: { enabled?: boolean; modal?: boolean; first?: boolean; bindings?: Bindings } = {},
  extra: KeyMap = {},
) {
  const { prefs } = usePrefs();
  useKeys({ ...commandKeyMap(handlers, options.bindings ?? prefs.keybindings), ...extra }, options);

  const handlerOf = useEffectEvent((id: CommandId) => handlers[id]);
  const { enabled = true, modal = false, first = false } = options;
  const capture = modal || first;
  useEffect(() => {
    if (!enabled) return;
    const onCommand = (e: Event) => {
      const fn = handlerOf((e as CustomEvent<CommandId>).detail);
      if (fn && fn() !== false) {
        e.preventDefault();
        if (first) e.stopImmediatePropagation();
      }
      // A dialog covers the window: nothing behind it runs (the menus are greyed out then anyway, see nativeMenus.ts)
      if (modal) e.stopImmediatePropagation();
    };
    const target = first && !modal ? document : window;
    target.addEventListener(COMMAND_EVENT, onCommand, { capture });
    return () => target.removeEventListener(COMMAND_EVENT, onCommand, { capture });
  }, [enabled, modal, first, capture]);
}

/**
 * Runs a command as its key would (used by the menus). Sent from body, so it passes the same listeners in the same order as a key press.
 * Returns whether something handled it
 */
export function runCommand(id: CommandId): boolean {
  const e = new CustomEvent(COMMAND_EVENT, { detail: id, bubbles: true, cancelable: true });
  document.body.dispatchEvent(e);
  return e.defaultPrevented;
}

/** The fullwidth space (U+3000) Tooltip.tsx splits the keys off at */
const KEY_GAP = String.fromCharCode(0x3000);

/** A command's first listed key the way people read it (the language's key names, the Mac's symbols); "" when it has none */
export function shortcutText(id: CommandId, bindings: Bindings, t: (id: string) => string): string {
  const first = keysOf(commandById(id), bindings)[0];
  return first === undefined ? "" : keycaps(keyHint(first), t);
}

/**
 * A tooltip with the shortcut of one or more commands: the name, a fullwidth space, then the keys (Tooltip.tsx draws the part after the
 * space as a keycap). Several commands give a pair such as ", ." (slower / faster); a command without a key is left out, and without any
 * key it is the name alone
 */
export function withShortcut(label: string, keys: string[]): string {
  const shown = keys.filter(Boolean);
  return shown.length ? `${label}${KEY_GAP}${shown.join(" ")}` : label;
}

/**
 * How a fixed command's keys are drawn, one keycap per entry: literal keys in the language's key names, messages (key.*) translated. "Hold H"
 * and "Hold C R B A" name the keys the tools have now; undefined when there is nothing to hold (every such key was given a modifier)
 */
export function fixedCaps(cmd: Command, bindings: Bindings, intl: IntlShape): string[] | undefined {
  const t = (id: string) => intl.formatMessage({ id });
  const held = (ids: CommandId[]) => holdableKeys(ids, bindings).map((k) => keycaps(keyHint(k), t));
  const caps: string[] = [];
  for (const k of cmd.fixed?.shown ?? []) {
    if (k === "key.holdH" || k === "key.holdTools") {
      const keys = held(k === "key.holdH" ? ["tool.hand"] : HOLD_TOOL_COMMANDS);
      if (keys.length === 0) return undefined;
      caps.push(intl.formatMessage({ id: k }, { keys: keys.join(" ") }));
    } else caps.push(k.startsWith("key.") ? t(k) : keycaps(k, t));
  }
  return caps;
}

/** Shortcut helpers under the current keys and language: text = the keys of a command, tip = a tooltip with them */
export function useShortcuts() {
  const intl = useIntl();
  const { prefs } = usePrefs();
  const bindings = prefs.keybindings;
  const t = (id: string) => intl.formatMessage({ id });
  const text = (id: CommandId) => shortcutText(id, bindings, t);
  return {
    bindings,
    text,
    tip: (label: string, ...ids: CommandId[]) => withShortcut(label, ids.map(text)),
  };
}
