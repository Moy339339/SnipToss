import { useEffect, useEffectEvent, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useIntl } from "react-intl";
import { cssZoom } from "./cssZoom";
import { useKeys } from "./keys";
import { sameColor, swatchLabel } from "./markColors";
import { MARK_COLORS } from "./prefs";

/** Gap to the badge and to the canvas edge, 8 each (scales with the interface size) */
const GAP = 8;

/**
 * The row of colors that pops up next to a mark's badge after the mark is clicked on the canvas
 * (otherwise a clicked mark could only be recolored with 1–6 or the context menu, with no visible hint;
 * Screen Capture likewise leaves only colors in its sub-toolbar once a mark is picked).
 * Sits above the badge; below it when there is no room or it would cover the composer; kept inside the canvas horizontally.
 * Follows the badge every frame, so zoom, pan and window resizing need no extra notification;
 * closes when the badge is gone (other item, mark hidden, video moved to another frame, composer saved).
 * Closes on a click elsewhere or Esc; number keys 1–6 do the same as the swatches.
 * Swatches do not take focus on press, so the caret in the composer stays where it was after the color changes
 */
export function MarkColorBar(props: {
  /** Which badge to sit next to (.annot-badge on the canvas); not found = close */
  anchor: () => Element | null | undefined;
  /** The color this mark is drawn in right now (the lit swatch) */
  current: string;
  /** The color from Settings: its swatch is labeled "default", picking it clears the per-mark color */
  defaultColor: string;
  /** The name screen readers announce ("color of this mark", "mark color") */
  label: string;
  onPick: (color: string | undefined) => void;
  onClose: () => void;
}) {
  const intl = useIntl();
  const bar = useRef<HTMLDivElement>(null);
  // Every frame and every press needs the latest props: call through an Effect Event (like Composer's tellLive), so listeners attach once
  const close = useEffectEvent(() => props.onClose());

  /** Position the bar; returns false when the badge is gone */
  const place = useEffectEvent(() => {
    const el = bar.current;
    const badge = props.anchor();
    if (!el) return true;
    if (!badge?.isConnected) return false;
    const z = cssZoom();
    const gap = GAP * z;
    const b = badge.getBoundingClientRect();
    const area = badge.closest(".zoom-view")?.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth * z, innerHeight * z);
    const { width: w, height: h } = el.getBoundingClientRect();
    const x = Math.max(area.left + gap, Math.min(b.left + b.width / 2 - w / 2, area.right - gap - w));
    const composer = document.querySelector(".composer")?.getBoundingClientRect();
    const covers = (y: number) => !!composer && x < composer.right && x + w > composer.left && y < composer.bottom && y + h > composer.top;
    const above = b.top - gap - h;
    const below = b.bottom + gap;
    const fitsAbove = above >= area.top + gap;
    const fitsBelow = below + h <= area.bottom - gap;
    // Fits above without covering the composer → above; else fits below without covering it → below;
    // otherwise whichever side fits (covering the composer beats leaving the canvas)
    const y = fitsAbove && !covers(above) ? above : fitsBelow && !covers(below) ? below : fitsAbove || !fitsBelow ? above : below;
    el.style.left = `${Math.round(x / z)}px`;
    el.style.top = `${Math.round(y / z)}px`;
    // The swatch tooltip appears on the outer side of the bar (upward when the bar is above the badge), so it never covers the badge
    el.dataset.tipSide = y === above ? "top" : "bottom";
    // The badge was panned out of the canvas: hide the bar until it comes back
    const inView = b.right > area.left && b.left < area.right && b.bottom > area.top && b.top < area.bottom;
    el.style.visibility = inView ? "" : "hidden";
    return true;
  });

  // Place it before the first paint (no flash in the top-left corner), then follow every frame
  useLayoutEffect(() => {
    if (!place()) close();
  }, []);
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      if (!place()) return close();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  // A press elsewhere closes it (clicking another mark pops up that mark's bar on release)
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!bar.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
  }, []);

  const pick = (color: string) => props.onPick(sameColor(color, props.defaultColor) ? undefined : color);
  // Runs before other shortcuts: Esc closes only this row (not the note being written), and 1–6 recolor the mark that was clicked
  useKeys(
    {
      Escape: () => props.onClose(),
      ...Object.fromEntries(MARK_COLORS.map((c, i) => [String(i + 1), () => pick(c)])),
    },
    { first: true },
  );

  return createPortal(
    <div
      ref={bar}
      className="mark-colors"
      role="radiogroup"
      aria-label={props.label}
      tabIndex={-1}
      style={{ visibility: "hidden" }}
      // Keep presses, right-clicks and double-clicks from reaching the canvas and window (same as the composer); a press does not take focus
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.preventDefault()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {MARK_COLORS.map((color, i) => {
        const on = sameColor(color, props.current);
        const name = swatchLabel(intl, color, props.defaultColor);
        return (
          <button
            key={color}
            type="button"
            className={`menu-swatch${on ? " is-on" : ""}`}
            role="radio"
            aria-checked={on}
            aria-label={name}
            // Name + fullwidth space + number key: Tooltip draws the part after the space as a keycap (same as the row in the menu)
            data-tip={`${name}\u3000${i + 1}`}
            style={{ "--swatch": color } as React.CSSProperties}
            onClick={() => pick(color)}
          />
        );
      })}
    </div>,
    document.body,
  );
}
