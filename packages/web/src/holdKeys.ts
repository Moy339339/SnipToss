import { useEffect, useEffectEvent, useState } from "react";
import type { Tool } from "./annotate";
import { commandById, keysOf, type Bindings, type CommandId } from "./commands";
import { endToolHold, toolHold } from "./hold";
import { keyName, pressesControl } from "./keys";
import { handHold, isTypingTarget } from "./pan";

// "Hold" tool keys (split out of Workspace): useKeys only handles key presses, so keydown / keyup are attached separately here.
// Holding the Hand key (H) = temporary Hand tool, and releasing returns to the previous tool; tapping it = properly switch to the Hand tool (pan.ts).
// Holding a drawing tool's key (C / R / B / A) = hold mode (hold.ts): the press switches the tool as usual through Workspace's shortcuts, and
// this code only records "held" and decides on release whether to return to Select.
// Only keys without modifiers can be held this way (holding Ctrl while drawing means something else); the keys follow Settings → Keyboard
// Shortcuts. The release is matched by the physical key (e.code) the hold started with: the modifiers may have changed by then

/** The drawing tools that can be held (point / rectangle / pen / arrow) */
export const HOLD_TOOL_COMMANDS: CommandId[] = ["tool.point", "tool.rect", "tool.pen", "tool.arrow"];

/** The keys of these commands that can be held: the ones without modifiers */
export function holdableKeys(ids: CommandId[], bindings: Bindings): string[] {
  return ids.flatMap((id) => keysOf(commandById(id), bindings)).filter((k) => !/^(Ctrl|Alt|Shift|Control)\+./.test(k));
}

export function useHoldKeys(opts: {
  chooseTool: (t: Tool) => void;
  setTool: (t: Tool) => void;
  /** "Hold to switch tools" is on in Settings */
  holdTools: boolean;
  canDraw: boolean;
  bindings: Bindings;
}): { handHeld: boolean } {
  const [handHeld, setHandHeld] = useState(false);
  const tapHand = useEffectEvent(() => opts.chooseTool("hand"));
  const holdState = useEffectEvent(() => ({ enabled: opts.holdTools, canDraw: opts.canDraw }));
  const backToSelect = useEffectEvent(() => opts.setTool("select"));
  const isHandKey = useEffectEvent((e: KeyboardEvent) => holdableKeys(["tool.hand"], opts.bindings).includes(keyName(e)));
  const isToolKey = useEffectEvent((e: KeyboardEvent) => holdableKeys(HOLD_TOOL_COMMANDS, opts.bindings).includes(keyName(e)));

  useEffect(() => {
    let since = 0;
    /** The physical key the hold started with */
    let code = "";
    const release = (tap: boolean) => {
      if (!handHold.held) return;
      handHold.held = false;
      setHandHeld(false);
      if (tap) tapHand();
    };
    const down = (e: KeyboardEvent) => {
      // Space only toggles play / pause (VideoPlayer); here it is merely stopped from "clicking" a button that the mouse clicked and that
      // still has focus (a button reached with Tab can still be pressed)
      if (e.code === "Space" && !isTypingTarget(e.target) && !pressesControl(e)) e.preventDefault();
      if (handHold.held && e.code === code) {
        e.preventDefault();
        return;
      }
      if (e.isComposing || !isHandKey(e)) return;
      if (isTypingTarget(e.target) || document.querySelector(".overlay")) return;
      e.preventDefault();
      if (e.repeat || handHold.held) return;
      handHold.held = true;
      handHold.panned = false;
      code = e.code;
      since = performance.now();
      setHandHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTypingTarget(e.target) && !pressesControl(e)) e.preventDefault();
      if (!handHold.held || e.code !== code) return;
      // No drag and a short press = a tap
      release(!handHold.panned && performance.now() - since < 350);
    };
    // The window was switched away while H was held: the release is never received, so treat it as the end of the hold
    const blur = () => release(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // "Held" is recorded whether or not hold mode is on: the composer waits for the release before taking focus and key repeats are
  // swallowed, so holding C while clicking doesn't type a string of c's
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      // Key-repeat presses of the held key are all swallowed: no more tool switching, and once the composer has focus nothing is typed
      // into the input box
      if (toolHold.code && e.code === toolHold.code) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (e.repeat || e.isComposing || !isToolKey(e)) return;
      if (!holdState().canDraw) return;
      if (isTypingTarget(e.target) || document.querySelector(".overlay")) return;
      // One tool key held and another pressed (hold C, then press R): the one pressed later counts, and releasing the earlier one doesn't
      // return to Select. It used to recognize only the first, so releasing C wiped out the R just switched to
      Object.assign(toolHold, { code: e.code, since: performance.now(), used: false });
    };
    // Any click made while the key is held (drawing a mark, clicking a button) counts as using it
    const use = () => {
      if (toolHold.code) toolHold.used = true;
    };
    const release = () => {
      if (!toolHold.code) return;
      // Used while held, or held for long = a long press, return to Select; unused and short = a tap, switch properly (like holding H)
      if (holdState().enabled && (toolHold.used || performance.now() - toolHold.since >= 350)) backToSelect();
      endToolHold();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === toolHold.code) release();
    };
    // The window was switched away while a key was held: the release is never received, so treat it as a release
    window.addEventListener("keydown", down, true);
    window.addEventListener("pointerdown", use, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("pointerdown", use, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("blur", release);
    };
  }, []);

  return { handHeld };
}
