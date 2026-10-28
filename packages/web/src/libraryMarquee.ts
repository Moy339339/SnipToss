import { useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import { cssZoom } from "./cssZoom";
import type { Row } from "./library";

// Marquee selection in the library (split out of LibraryPanel): press the left button on the list and drag to pull out a selection box,
// and all rows it touches are selected (as in File Explorer); holding Ctrl adds to the existing selection. Rows cannot be dragged away,
// so starting on a row is also a marquee; without a drag (under 4px) it stays an ordinary click. The box and the auto-scroll change every
// frame and are applied to the DOM directly; the selected rows are updated only when the set of rows touched changes. On release, if the
// item open on the canvas is not among the selected ones, the first selected item with open notes is opened

export function useMarquee(opts: {
  list: RefObject<HTMLDivElement | null>;
  rows: Row[];
  picked: Set<string>;
  setPicked: Dispatch<SetStateAction<Set<string>>>;
  /** The start of a Shift range selection: the row where the drag began */
  anchor: RefObject<string | undefined>;
  /** The rows and positions drawn last time (virtualRows.ts) */
  layout: RefObject<{ rows: Row[]; offsets: Float64Array }>;
  listPad: () => number;
  openFirstOf: (rs: Row[]) => void;
}) {
  const { list, rows, picked, setPicked, anchor, layout, listPad, openFirstOf } = opts;
  const marquee = useRef<HTMLDivElement>(null);
  const onListPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest(".lib-twisty, button, input, .lib-empty")) return;
    const el = list.current!;
    const box = marquee.current!;
    // The mouse position is in screen pixels, while sizes, scrolling and the box position inside the list are pre-zoom: convert to list
    // coordinates first (when the interface size is not 100%, see cssZoom.ts)
    const zoom = cssZoom(el);
    const local = (p: { x: number; y: number }) => {
      const r = el.getBoundingClientRect();
      return { x: (p.x - r.left) / zoom, y: (p.y - r.top) / zoom };
    };
    const at = local({ x: e.clientX, y: e.clientY });
    // Pressed on the scrollbar at the right: the user wants to drag the scrollbar, so no marquee starts (a press on the scrollbar still
    // delivers pointerdown to the list)
    if (at.x >= el.clientLeft + el.clientWidth) return;
    // The browser itself gives the list focus on mouse down (no scripted focus: when coming from the filter box, scripted focus is
    // treated as keyboard focus and the cursor row would show a focus ring)
    const start = { x: at.x, y: at.y + el.scrollTop };
    const add = e.ctrlKey || e.metaKey;
    const base = add ? new Set(picked) : new Set<string>();
    const startRow = (e.target as HTMLElement).closest<HTMLElement>("[data-row]")?.dataset.row;
    let pointer = { x: e.clientX, y: e.clientY };
    let dragging = false;
    let shown = "";
    let raf = 0;
    const update = () => {
      const now = local(pointer);
      const y2 = now.y + el.scrollTop;
      const top = Math.min(start.y, y2);
      const bottom = Math.max(start.y, y2);
      const left = Math.max(0, Math.min(start.x, now.x));
      const right = Math.min(el.clientWidth, Math.max(start.x, now.x));
      Object.assign(box.style, {
        display: "block",
        left: `${left}px`,
        top: `${top}px`,
        width: `${right - left}px`,
        height: `${bottom - top}px`,
      });
      // Rows are full width, so only the top and bottom need to touch. Found by computed position (rows not visible aren't in the DOM):
      // binary search to the top of the box, then count down to its bottom
      const hit = new Set(base);
      const { rows: rs, offsets: o } = layout.current;
      const pad = listPad();
      let lo = 0;
      let hi = rs.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (pad + o[mid + 1] <= top) lo = mid + 1;
        else hi = mid;
      }
      for (let k = lo; k < rs.length && pad + o[k] < bottom; k++) hit.add(rs[k].id);
      const key = [...hit].join("\n");
      if (key !== shown) {
        shown = key;
        setPicked(hit);
      }
    };
    const tick = () => {
      // Dragging within 24 of the top or bottom edge of the list scrolls automatically, faster the closer to the edge
      const y = local(pointer).y;
      const h = el.clientHeight;
      const edge = 24;
      const dy = y < edge ? y - edge : y > h - edge ? y - (h - edge) : 0;
      if (dy) {
        el.scrollTop += Math.max(-16, Math.min(16, dy / 2));
        update();
      }
      raf = requestAnimationFrame(tick);
    };
    const move = (ev: PointerEvent) => {
      pointer = { x: ev.clientX, y: ev.clientY };
      if (!dragging) {
        if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 4) return;
        dragging = true;
        anchor.current = startRow;
        raf = requestAnimationFrame(tick);
      }
      update();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      if (!dragging) return;
      cancelAnimationFrame(raf);
      box.style.display = "none";
      // After release the browser still fires a click (on the common ancestor of the start and end points): swallow it, otherwise it
      // would count as a click on a row or on blank space
      const swallow = (ev: MouseEvent) => {
        ev.stopPropagation();
        ev.preventDefault();
      };
      window.addEventListener("click", swallow, { capture: true });
      setTimeout(() => window.removeEventListener("click", swallow, { capture: true }), 0);
      openFirstOf(rows.filter((r) => shown.split("\n").includes(r.id)));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };
  return { marquee, onListPointerDown };
}
