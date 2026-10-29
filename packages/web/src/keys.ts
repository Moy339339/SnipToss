import { useEffect, useEffectEvent } from "react";
import { platform } from "./host";

// The single entry point for keyboard shortcuts. Key name format: modifiers + main key, e.g. "Ctrl+O", "Shift+ArrowLeft", "Space", "?", ",".
// The full shortcut table is in docs/shortcuts.md; when changing anything here, update that document and the list in ShortcutHelp too.

/**
 * A handler returning false = not handled this time, leave it to others (e.g. the selected mark was not "hit on the canvas", so the arrow
 * keys still step frames)
 */
export type KeyMap = Record<string, (e: KeyboardEvent) => void | boolean>;

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")
  );
}

/**
 * A slider (volume) uses only these keys itself: other keys still act as shortcuts, so Space after clicking the volume slider still plays
 * / pauses
 */
const SLIDER_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);
/** This key belongs to the input the caret is in (typing, moving the caret) and is not a shortcut */
function ownedByInput(target: EventTarget | null, name: string): boolean {
  if (target instanceof HTMLInputElement && target.type === "range") return SLIDER_KEYS.has(name);
  // Function keys (F1 help, F5 refresh, F10 menu bar, F11 full screen) neither type nor move the caret, so they stay shortcuts inside
  // inputs (F5 in the filter box used to not refresh)
  if (/^(Shift\+)?F\d{1,2}$/.test(name)) return false;
  return isTyping(target);
}

/**
 * Text-editing keys that inputs handle themselves: with the caret in an input they always go to the input (undo typing, select all text…)
 * and are not shortcuts (Ctrl+Z used to undo the last note)
 */
const TEXT_EDITING = new Set([
  "Ctrl+Z",
  "Ctrl+Shift+Z",
  "Ctrl+Y",
  "Ctrl+A",
  "Ctrl+C",
  "Ctrl+X",
  "Ctrl+V",
  "Ctrl+Shift+V",
  "Ctrl+Backspace",
  "Ctrl+Delete",
  "Ctrl+ArrowLeft",
  "Ctrl+ArrowRight",
  "Ctrl+Shift+ArrowLeft",
  "Ctrl+Shift+ArrowRight",
  "Ctrl+Home",
  "Ctrl+End",
  "Ctrl+Shift+Home",
  "Ctrl+Shift+End",
]);

/**
 * The Mac's own text editing keys, on top of the ones above: Option+arrows move by word, Option+Backspace / Delete delete a word, Command+Up /
 * Down go to the start / end of the text. Inside an input they belong to it (Command is "Ctrl" in key names, see keyName)
 */
const MAC_TEXT_EDITING = new Set([
  "Alt+ArrowLeft",
  "Alt+ArrowRight",
  "Alt+Shift+ArrowLeft",
  "Alt+Shift+ArrowRight",
  "Alt+Backspace",
  "Alt+Delete",
  "Ctrl+ArrowUp",
  "Ctrl+ArrowDown",
  "Ctrl+Shift+ArrowUp",
  "Ctrl+Shift+ArrowDown",
]);

const CONTROL =
  "button, a[href], summary, [role=button], [role=menuitem], [role=menuitemcheckbox], [role=menuitemradio], [role=checkbox], [role=switch], [role=tab], [role=radio], [role=option]";

/**
 * Whether focus was last moved by keyboard (Tab, arrow keys and Home / End in menus and lists); a mouse press makes it false.
 * :focus-visible is not used: at the moment Enter / Space is pressed, Chromium counts even a mouse-clicked button as focus-visible,
 * so after clicking a number on the canvas, Enter became "press this button" instead of opening the editor
 */
let keyboardFocus = false;
const NAV_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"]);
/**
 * On the canvas arrow keys are mostly shortcuts (step frames, move marks, switch items) and focus doesn't move: when pressed, the focus
 * location is recorded, and only if focus really moved does it count as reached by keyboard.
 * It used to count after a single press, so after clicking the mute button with the mouse and then stepping frames, Space pressed mute again
 */
let navFrom: Element | null | undefined;
function settleNav() {
  if (navFrom !== undefined && document.activeElement !== navFrom) keyboardFocus = true;
  navFrom = undefined;
}
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener(
    "pointerdown",
    () => {
      keyboardFocus = false;
      navFrom = undefined;
    },
    true,
  );
  window.addEventListener(
    "keydown",
    (e) => {
      settleNav();
      if (e.key === "Tab") keyboardFocus = true;
      else if (NAV_KEYS.has(e.key)) navFrom = document.activeElement;
    },
    true,
  );
}

/**
 * This Enter / Space is "pressing" a button, checkbox or menu item reached by keyboard: leave it to that control, not a shortcut.
 * Only keyboard-reached ones count: after a mouse click focus stays on the button, and then Space still plays / pauses and Enter still edits the note
 */
export function pressesControl(e: KeyboardEvent): boolean {
  if (e.key !== "Enter" && e.key !== " ") return false;
  settleNav();
  const t = e.target;
  return keyboardFocus && t instanceof HTMLElement && t.matches(CONTROL);
}

/**
 * Which letter (upper case) this key is: Latin-letter layouts go by the character typed (on French AZERTY the A key is A); non-Latin layouts
 * such as Russian, Greek and Korean fall back to the US keyboard letter by key position (on a Russian layout Ctrl plus the C key is still Ctrl+C,
 * as in Windows programs; ADR-0001 item 10). Returns an empty string for a key that isn't a letter
 */
export function letterOf(e: Pick<KeyboardEvent, "key" | "code">): string {
  if (e.key.length !== 1 || !/^\p{L}$/u.test(e.key)) return "";
  if (/^\p{Script=Latin}$/u.test(e.key)) {
    const k = e.key.normalize("NFD")[0].toUpperCase();
    return /^[A-Z]$/.test(k) ? k : "";
  }
  return /^Key([A-Z])$/.exec(e.code)?.[1] ?? "";
}

/**
 * Normalizes a key press into a key name. A printable symbol (? , .) already implies Shift, so no Shift+ is added.
 * byPosition = false: digit keys are also taken by the character typed (see keyNames)
 */
export function keyName(e: KeyboardEvent, byPosition = true, mac = platform === "mac"): string {
  let key = e.key;
  if (key === " ") key = "Space";
  // Letters typed on a non-Latin layout (я, ㅁ) are taken as Latin letters by key position, so shortcuts still work
  if (key.length === 1 && /^\p{L}$/u.test(key) && !/^\p{Script=Latin}$/u.test(key)) key = letterOf(e) || key;
  const altGraph = typeof e.getModifierState === "function" && e.getModifierState("AltGraph");
  // Digit keys are recorded by key position: Shift+digit is "Shift+1" and does not become ! ) etc. with the keyboard layout; a bare press
  // is also the digit (mark colors 1–6): on a French layout a bare press types & é, on Czech + ě, and they still count as 1, 2. Ctrl and
  // Alt combinations still go by the character typed (Ctrl+- on a French layout is that key). While AltGr is held the key position is not
  // used: a symbol is typed (German AltGr+8 = [). When WebView2 reports AltGr, ctrlKey and altKey are both false, and it used to be taken
  // as 8
  const digit = byPosition && !altGraph && (e.shiftKey || !(e.ctrlKey || e.altKey || e.metaKey)) ? /^Digit(\d)$/.exec(e.code) : null;
  if (digit) key = digit[1];
  // Mac: Option changes the character a key types (Option+Z is Ω, Option+1 is ¡), so a shortcut with Option goes by the key position
  if (mac && e.altKey) {
    const position = /^Digit(\d)$/.exec(e.code) ?? /^Key([A-Z])$/.exec(e.code);
    if (position) key = position[1];
  }
  const printable = key.length === 1;
  if (printable) key = key.toUpperCase();
  const mods: string[] = [];
  // A symbol typed with AltGr (German AltGr+8 = [, AltGr+ß = \): taken as the symbol itself, so shortcuts like [ ] still work on these layouts.
  // Some environments report AltGr as Ctrl+Alt; those two modifiers are not added here. Letters are different (AltGr+E types €, that is
  // typing, not a shortcut)
  const altGr = altGraph && printable && !/^\p{L}$/u.test(key);
  // Mac: the Command key is the "Ctrl" of the shortcut names; the real Control key is a modifier of its own that no shortcut uses (the system
  // and text fields use Control+letters for moving the caret)
  if (mac) {
    if (e.metaKey && !altGr) mods.push("Ctrl");
    else if (e.ctrlKey) mods.push("Control");
  } else if ((e.ctrlKey || e.metaKey) && !altGr) mods.push("Ctrl");
  if (e.altKey && !altGr) mods.push("Alt");
  if (e.shiftKey && (digit || !printable || /[A-Z]/.test(key))) mods.push("Shift");
  return [...mods, key].join("+");
}

/**
 * The shortcut names a key press can match, tried in order: the one by key position (keyName); when a digit key types a symbol, that symbol too:
 * on a Russian layout ? is on Shift+7, and when Shift+7 has no shortcut bound, ? counts (opens the shortcut list). It falls back to symbols only:
 * falling back to letters or digits would make Shift+6 on a French layout (which types 6) collide with the bare 6 shortcut
 */
export function keyNames(e: KeyboardEvent): string[] {
  const name = keyName(e);
  const typed = keyName(e, false);
  return typed !== name && typed.length === 1 && !/[\p{L}\p{N}]/u.test(typed) ? [name, typed] : [name];
}

/**
 * Simulates pressing a shortcut once (used by the menu bar: clicking a menu item = pressing its shortcut, so both always do the same thing).
 * Dispatched on body rather than window, so the event goes through capture → bubble as usual and "handle first and stop" shortcuts work too.
 * Key name format is the same as useKeys, e.g. "Shift+1", "Ctrl+=", "Space", "ArrowLeft"
 */
export function pressKey(name: string, mac = platform === "mac") {
  const parts = name.split("+");
  let key = parts.pop() || "+"; // "Ctrl++" ends up with an empty string after splitting
  if (name.endsWith("++")) parts.pop();
  const mods = new Set(parts);
  let code = "";
  if (/^\d$/.test(key)) code = `Digit${key}`;
  else if (/^[A-Z]$/.test(key)) {
    code = `Key${key}`;
    key = mods.has("Shift") ? key : key.toLowerCase();
  } else if (key === "Space") {
    code = "Space";
    key = " ";
  } else code = key;
  const init = {
    key,
    code,
    // On the Mac the "Ctrl" of a key name is the Command key
    ctrlKey: !mac && mods.has("Ctrl"),
    metaKey: mac && mods.has("Ctrl"),
    shiftKey: mods.has("Shift"),
    altKey: mods.has("Alt"),
    bubbles: true,
    cancelable: true,
  };
  document.body.dispatchEvent(new KeyboardEvent("keydown", init));
  document.body.dispatchEvent(new KeyboardEvent("keyup", init));
}

/**
 * Among the keys a modal took, those pressed with the caret in the modal's own input: not cut off on window (otherwise the input's own
 * onKeyDown would not receive them, and pressing Enter after typing in Settings "Skipped folders" would not add the entry); they are only
 * recorded here, and other shortcuts that see this mark leave them alone
 */
const takenByModal = new WeakSet<Event>();

/**
 * Registers a group of shortcuts, removed automatically when the component unmounts.
 * - With the caret in an input, keys without Ctrl/Alt and text-editing keys (Ctrl+Z, Ctrl+A…) always go to the input (typing Chinese is
 *   unaffected), and Esc blurs the input.
 * - Pressing Enter / Space on a button reached with Tab presses that button (pressesControl), not a shortcut.
 * - modal: for overlays; handled before all other shortcuts (including first), and swallows every key (what the input in the overlay
 *   receives still goes to the input, see takenByModal). Attached in the capture phase on window.
 * - first: handled before ordinary shortcuts; once handled it is not passed on (the same key's meaning elsewhere doesn't apply this
 *   time). Attached in the capture phase on document,
 * after overlays (window capture, including Menu): both used to be attached to window, whichever registered first got the key first, and
 * with a menu open the arrow keys were stolen by moving a mark
 */
export function useKeys(map: KeyMap, options: { enabled?: boolean; modal?: boolean; first?: boolean } = {}) {
  // The listener is re-attached only when enabled / modal / first change, but the latest map must be found on a key press: use an Effect
  // Event instead of writing a ref during render (react(refs))
  const handlerOf = useEffectEvent((name: string) => map[name]);
  const { enabled = true, modal = false, first = false } = options;
  const capture = modal || first;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || (!modal && takenByModal.has(e))) return;
      const [name, typed] = keyNames(e);
      let skip = pressesControl(e);
      if (!modal && ownedByInput(e.target, name)) {
        if (name === "Escape") (e.target as HTMLElement).blur();
        // The Command key is the Ctrl of the names on the Mac
        const ctrl = platform === "mac" ? e.metaKey : e.ctrlKey;
        if ((!ctrl && !e.altKey) || TEXT_EDITING.has(name) || (platform === "mac" && MAC_TEXT_EDITING.has(name))) skip = true;
      }
      const handler = skip ? undefined : (handlerOf(name) ?? (typed ? handlerOf(typed) : undefined));
      if (handler && handler(e) !== false) {
        e.preventDefault();
        if (first) e.stopImmediatePropagation();
      }
      if (modal) {
        if (isTyping(e.target)) takenByModal.add(e);
        else e.stopImmediatePropagation();
      }
    };
    const target = first && !modal ? document : window;
    target.addEventListener("keydown", onKey as EventListener, { capture });
    return () => target.removeEventListener("keydown", onKey as EventListener, { capture });
  }, [enabled, modal, first, capture]);
}
