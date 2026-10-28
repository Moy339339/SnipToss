import { useEffect, useEffectEvent, useState } from "react";
import type { Tool } from "./annotate";
import { endToolHold, HOLD_TOOLS, toolHold } from "./hold";
import { pressesControl } from "./keys";
import { handHold, isTypingTarget } from "./pan";

// "Hold" tool keys (split out of Workspace): useKeys only handles key presses, so keydown / keyup are attached separately here.
// Holding H = temporary Hand tool, and releasing returns to the previous tool; tapping H = properly switch to the Hand tool (pan.ts).
// Holding C / R / B / A = hold mode (hold.ts): the press switches the tool as usual through useKeys, and this code only records "held"
// and decides on release whether to return to Select

export function useHoldKeys(opts: {
  chooseTool: (t: Tool) => void;
  setTool: (t: Tool) => void;
  /** "Hold to switch tools" is on in Settings */
  holdTools: boolean;
  canDraw: boolean;
}): { handHeld: boolean } {
  const [handHeld, setHandHeld] = useState(false);
  const tapHand = useEffectEvent(() => opts.chooseTool("hand"));
  const holdState = useEffectEvent(() => ({ enabled: opts.holdTools, canDraw: opts.canDraw }));
  const backToSelect = useEffectEvent(() => opts.setTool("select"));

  useEffect(() => {
    let since = 0;
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
      if (e.code !== "KeyH" || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
      if (isTypingTarget(e.target) || document.querySelector(".overlay")) return;
      e.preventDefault();
      if (e.repeat || handHold.held) return;
      handHold.held = true;
      handHold.panned = false;
      since = performance.now();
      setHandHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTypingTarget(e.target) && !pressesControl(e)) e.preventDefault();
      if (e.code !== "KeyH") return;
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
      if (e.repeat || !HOLD_TOOLS.includes(e.code) || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
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
