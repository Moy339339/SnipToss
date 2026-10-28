import { useCallback, useEffect, useState, type RefObject } from "react";
import { useIntl } from "react-intl";
import { cssZoom } from "./cssZoom";

// The left (library) and right (notes) side panels: drag the edge to resize, each collapses on its own; state is kept in localStorage (WebView2 persists it).
// While dragging, the CSS variable is set directly, not through React state; the result is stored on release.

export type Side = "left" | "right";

export interface PanelState {
  width: number;
  collapsed: boolean;
}

const LIMITS: Record<Side, { min: number; max: number; initial: number }> = {
  left: { min: 180, max: 520, initial: 260 },
  right: { min: 240, max: 640, initial: 320 },
};
/** The canvas keeps at least this width: both panels at their widest (520 + 640) are wider than the minimum window width (960), which would squeeze the canvas to 0 */
export const STAGE_MIN = 360;
/** Dragging this far below the minimum width counts as a request to collapse (like VS Code) */
const SNAP = 72;
const STORE_KEY = "sniptoss.panels";

function load(): Record<Side, PanelState> {
  const fallback = {
    left: { width: LIMITS.left.initial, collapsed: false },
    right: { width: LIMITS.right.initial, collapsed: false },
  };
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null");
    return saved?.left && saved?.right ? saved : fallback;
  } catch {
    return fallback;
  }
}

/**
 * The widths actually given to the two panels in the window: when they do not fit (the window got smaller), each shrinks in proportion to its excess over the minimum width,
 * leaving STAGE_MIN for the canvas; the stored widths stay unchanged and come back when the window grows again. While layoutWidth is still unknown (0), the stored widths are used as is
 */
export function fitWidths(panels: Record<Side, PanelState>, layoutWidth: number): Record<Side, number> {
  const w = { left: panels.left.collapsed ? 0 : panels.left.width, right: panels.right.collapsed ? 0 : panels.right.width };
  const over = w.left + w.right - (layoutWidth - STAGE_MIN);
  if (!layoutWidth || over <= 0) return w;
  const spare = (s: Side) => (w[s] ? w[s] - LIMITS[s].min : 0);
  const total = spare("left") + spare("right");
  const k = total > 0 ? Math.min(1, over / total) : 0;
  return { left: w.left - spare("left") * k, right: w.right - spare("right") * k };
}

export function usePanels(layout: RefObject<HTMLDivElement | null>) {
  const [panels, setPanels] = useState(load);
  const [layoutWidth, setLayoutWidth] = useState(0);
  useEffect(() => {
    const el = layout.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setLayoutWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [layout]);
  const fitted = fitWidths(panels, layoutWidth);

  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify(panels));
  }, [panels]);

  const toggle = useCallback((side: Side) => {
    setPanels((p) => ({ ...p, [side]: { ...p[side], collapsed: !p[side].collapsed } }));
  }, []);

  /** If either side is open, collapse both (focus on the canvas); expand both only when both are collapsed */
  const toggleBoth = useCallback(() => {
    setPanels((p) => {
      const collapse = !p.left.collapsed || !p.right.collapsed;
      return { left: { ...p.left, collapsed: collapse }, right: { ...p.right, collapsed: collapse } };
    });
  }, []);

  // Not wrapped in useCallback: it reads the latest panels / fitted on every render, and the dependency list would have to name layout.current
  // (layout is a ref passed in as a parameter, and writing [layout] gets flagged as "can't preserve manual memoization");
  // where it is used (the Sash in Workspace) is an inline arrow function anyway, so wrapping would not save any renders (react-hooks)
  const startDrag = (side: Side, e: React.PointerEvent) => {
    const el = layout.current;
    if (!el || e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);
    el.classList.add("is-resizing");
    handle.classList.add("is-active");
    const { min } = LIMITS[side];
    // At most as wide as still leaves STAGE_MIN for the canvas (the opposite panel counted at its current actual width)
    const other = side === "left" ? fitted.right : fitted.left;
    const max = Math.max(min, Math.min(LIMITS[side].max, el.clientWidth - other - STAGE_MIN));
    const startX = e.clientX;
    // The mouse moves in screen pixels while panel widths are pre-zoom (so the edge keeps up with the mouse when the interface size is not 100%)
    const zoom = cssZoom(el);
    const start = panels[side].collapsed ? 0 : Math.min(fitted[side], max);
    let width = start;
    let collapsed = panels[side].collapsed;
    let moved = false;

    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - startX) / zoom;
      if (dx !== 0) moved = true;
      const raw = start + (side === "left" ? dx : -dx);
      collapsed = raw < min - SNAP;
      width = Math.min(max, Math.max(min, raw));
      el.style.setProperty(`--${side}-drag`, collapsed ? "0px" : `${width}px`);
    };
    const up = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      el.classList.remove("is-resizing");
      handle.classList.remove("is-active");
      el.style.removeProperty(`--${side}-drag`);
      // Just a click, no drag: leave the stored width alone (in a narrow window the shown width is the shrunken one; storing it on a click would stick even after the window grows)
      if (!moved) return;
      setPanels((p) => ({
        ...p,
        [side]: { width: collapsed ? p[side].width : width, collapsed },
      }));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  };

  const reset = useCallback((side: Side) => {
    setPanels((p) => ({ ...p, [side]: { width: LIMITS[side].initial, collapsed: false } }));
  }, []);
  /** Menu "View → Restore Default Layout": both sides back to the default width and expanded */
  const resetAll = useCallback(() => {
    setPanels({
      left: { width: LIMITS.left.initial, collapsed: false },
      right: { width: LIMITS.right.initial, collapsed: false },
    });
  }, []);

  const vars = {
    "--left-size": `${fitted.left}px`,
    "--right-size": `${fitted.right}px`,
  } as React.CSSProperties;

  return { panels, vars, toggle, toggleBoth, startDrag, reset, resetAll };
}

/** The drag handle on a side panel's edge. Double-click restores the default width */
export function Sash(props: { side: Side; onPointerDown: (e: React.PointerEvent) => void; onDoubleClick: () => void }) {
  const intl = useIntl();
  return (
    <div
      className={`sash sash-${props.side}`}
      onPointerDown={props.onPointerDown}
      onDoubleClick={props.onDoubleClick}
      title={intl.formatMessage({ id: "panels.sashTitle" })}
    />
  );
}

/** Icon of the small button that collapses / expands a side panel */
export function PanelIcon({ side, open }: { side: Side; open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="2" y="2.5" width="12" height="11" rx="2" />
      <path d={side === "left" ? "M6 2.5v11" : "M10 2.5v11"} />
      {open && (
        <rect x={side === "left" ? 2.6 : 10.6} y="3.1" width="2.8" height="9.8" rx="1" fill="currentColor" stroke="none" opacity="0.5" />
      )}
    </svg>
  );
}
