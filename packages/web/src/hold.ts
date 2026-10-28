// Hold mode (Settings → Advanced → Annotations "Hold to switch tools", off by default): holding C / R / B / A temporarily switches to
// that tool, and marking works as usual while it is held; on release it goes back to the Select tool (the arrow, whichever tool was
// active before), and a half-written note is continued. A single tap still switches properly (like holding H, rules in holdKeys.ts). H is
// not handled here: holding H is a temporary Hand tool, and releasing returns to the previous tool (pan.ts). The composer that pops up
// while a key is held doesn't take focus until release: otherwise the held letter would be typed into the input box repeatedly, and an
// IME would pop up candidates. This part runs whether or not hold mode is on (when it is off, release just doesn't return to Select).

/**
 * Which keys can be held: point / rectangle / pen / arrow (switching tools itself is still handled by Workspace's useKeys, so change the
 * keys in both places)
 */
export const HOLD_TOOLS = ["KeyC", "KeyR", "KeyB", "KeyA"];

/** The tool key currently held (KeyboardEvent.code, e.g. "KeyC"); empty = none held */
export const toolHold = { code: "", since: 0, used: false };

const waiting = new Set<() => void>();

/** If no tool key is held, do it right away; if one is held, wait until it is released. Returns a cancel function (for when a component unmounts) */
export function afterToolHold(fn: () => void): () => void {
  if (!toolHold.code) {
    fn();
    return () => {};
  }
  waiting.add(fn);
  return () => waiting.delete(fn);
}

/** Released: clear the state and run what was waiting */
export function endToolHold() {
  toolHold.code = "";
  const fns = [...waiting];
  waiting.clear();
  for (const fn of fns) fn();
}
