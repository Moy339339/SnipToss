import { useEffect, useEffectEvent } from "react";
import { useIntl } from "react-intl";
import { cssZoom } from "./cssZoom";
import { punctuationNodes } from "./KeepPunctuation";

/**
 * Global tooltip: when the mouse rests on anything with a title or data-tip, this one self-drawn bubble is used.
 * Otherwise the toolbar would have CSS-drawn tooltips and 40-odd other places system tooltips, each with a different look and delay;
 * CSS-drawn ones are also clipped by the side panel's overflow and run out of bounds next to the window edge.
 * Elements just keep writing title: while the mouse rests, the title is taken off (so the system tooltip does not appear) and put back on leave,
 * so the DOM React sees is still what it wrote (title follows state; even when it becomes empty no stale text is left behind).
 * The bubble sits 8 below the element, flipping above when there is no room below; it is kept 8 inside the window horizontally.
 * It closes on mouse press, key press and scroll.
 * It edits the DOM directly, not through React state: moving the mouse around triggers no re-render.
 */
const DELAY = 350;
/** Pointing at another element with a tooltip soon after one closed shows it immediately: sweeping across the toolbar reveals them one after another */
const REGRACE = 300;
const EDGE = 8;
const GAP = 8;

/** What looks like a shortcut: Ctrl B, Ctrl Alt B, Alt F4, N, Esc, Ctrl , ...; key names (Space, Wheel) follow the interface language and come from messages */
const MODIFIERS = /^((Ctrl|Shift|Alt) )*(.+)$/;
const KEY = /^([A-Za-z0-9]{1,6}|[?,.=\-[\]\\/])$/;
const isKey = (text: string, names: readonly string[]) => {
  const key = MODIFIERS.exec(text)?.[3] ?? "";
  return KEY.test(key) || names.includes(key);
};

/**
 * Split off the shortcut at the end and show it right-aligned in a lighter gray (like in menus): "Settings（Ctrl ,）", "Settings (Ctrl ,)",
 * "Hand: pan the canvas　H" (separated by a fullwidth space, U+3000).
 * Both fullwidth and halfwidth parentheses are recognized; when the parentheses hold explanatory text ("(Files are kept, Delete)") it is not split and shown as is.
 * Paths break lines only after a \ or /, never in the middle of a file name.
 */
function splitKey(text: string, names: readonly string[]): [string, string?] {
  const tab = /^(.+?)\u3000(\S[^\u3000]*)$/.exec(text);
  if (tab) return [tab[1], tab[2]];
  const paren = /^(.+?)\s*[\uFF08(]([^\uFF08\uFF09()]+)[\uFF09)]$/.exec(text);
  if (paren && isKey(paren[2], names)) return [paren[1], paren[2]];
  return [text];
}

/** While the bubble is open, close it right away (no fade-out) */
let hideNow: (() => void) | null = null;

/**
 * Hide the tooltip immediately (without waiting for the fade-out) and continue only after the hidden state has been painted. Used when Screen Capture is started
 * from a title bar button or a menu: when the window is not hidden the shell takes the screenshot on the spot,
 * and a tooltip still fading out or a menu not yet removed would be frozen into the screenshot
 */
export function dismissTooltip(): Promise<void> {
  hideNow?.();
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

export function Tooltips() {
  const intl = useIntl();
  /** Split off the shortcut: key names follow the language ("Space" in English, the local word elsewhere). The bubble's listeners attach once in the effect and read the latest messages through this */
  const split = useEffectEvent((text: string) =>
    splitKey(text, [intl.formatMessage({ id: "key.space" }), intl.formatMessage({ id: "key.wheel" })]),
  );
  useEffect(() => {
    const tip = document.createElement("div");
    tip.className = "tooltip";
    tip.setAttribute("role", "tooltip");
    document.body.appendChild(tip);

    let target: Element | null = null;
    /** The title taken off target, put back on leave */
    let title: string | null = null;
    let timer = 0;
    let shown = false;
    let hiddenAt = 0;

    const hide = () => {
      clearTimeout(timer);
      if (shown) hiddenAt = performance.now();
      shown = false;
      // If React wrote a new title while the mouse rested, keep the new one rather than overwrite it with the old
      if (target && title !== null && !target.hasAttribute("title")) target.setAttribute("title", title);
      target = null;
      title = null;
      tip.classList.remove("is-on");
    };

    const show = () => {
      if (!target?.isConnected) return hide();
      const now = target.getAttribute("title");
      if (now !== null) {
        title = now;
        target.removeAttribute("title");
      }
      const text = target.getAttribute("data-tip") ?? title ?? "";
      if (!text) return;
      const [label, key] = split(text);
      tip.replaceChildren(...punctuationNodes(label.replace(/[\\/]/g, "$&\u200b")));
      if (key) {
        const k = document.createElement("span");
        k.className = "tooltip-key";
        k.textContent = key;
        tip.append(k);
      }
      tip.style.left = "0px";
      tip.style.top = "0px";
      // Positions are computed in screen pixels; convert back to pre-zoom values before writing them (when the interface size is not 100%, see cssZoom.ts)
      const z = cssZoom(tip);
      const r = target.getBoundingClientRect();
      const w = tip.offsetWidth * z;
      const h = tip.offsetHeight * z;
      const x = Math.max(EDGE, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - EDGE));
      const below = r.bottom + GAP;
      const above = r.top - GAP - h;
      // The caller asked for upward (data-tip-side="top": the color bar above a canvas mark, where a tooltip below would cover the mark being recolored)
      const up = target.closest("[data-tip-side]")?.getAttribute("data-tip-side") === "top" && above >= EDGE;
      const y = !up && below + h <= innerHeight - EDGE ? below : above;
      tip.style.left = `${Math.round(x / z)}px`;
      tip.style.top = `${Math.round(y / z)}px`;
      tip.dataset.side = y < r.top ? "top" : "bottom";
      tip.classList.add("is-on");
      shown = true;
    };

    const onOver = (e: PointerEvent) => {
      // No tooltips for things swept over while dragging with a button held (marquee select, drawing a mark, resizing a panel)
      if (e.buttons !== 0) return hide();
      const over = e.target as Element;
      const el = over.closest?.("[title], [data-tip]") ?? null;
      // Still inside the current one (its title was taken off, so closest cannot find it): do not switch unless the pointer is on another element with a tooltip inside it
      if (target?.contains(over) && (el === null || el === target || !target.contains(el))) return;
      const quick = shown || performance.now() - hiddenAt < REGRACE;
      hide();
      if (!el) return;
      target = el;
      // The system tooltip appears only once the mouse rests, so take the title off first to block it; keep the text for when the bubble appears
      title = el.getAttribute("title");
      if (title !== null) el.removeAttribute("title");
      timer = window.setTimeout(show, quick ? 0 : DELAY);
    };
    const onLeaveWindow = (e: PointerEvent) => {
      if (!e.relatedTarget) hide();
    };

    hideNow = () => {
      tip.style.transition = "none";
      hide();
      void getComputedStyle(tip).opacity; // Compute the style once without the transition, then put the transition back
      tip.style.transition = "";
    };
    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointerout", onLeaveWindow, true);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("keydown", hide, true);
    document.addEventListener("wheel", hide, { capture: true, passive: true });
    window.addEventListener("blur", hide);
    return () => {
      hide();
      hideNow = null;
      tip.remove();
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointerout", onLeaveWindow, true);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("keydown", hide, true);
      document.removeEventListener("wheel", hide, true);
      window.removeEventListener("blur", hide);
    };
  }, []);
  return null;
}
