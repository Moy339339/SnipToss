import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { prevProjectPinned, type Row } from "./library";

// Virtual scrolling for the library (split out of LibraryPanel): only the visible rows are drawn (plus a margin above and below).
// With 20,000 items, drawing 20,000 rows at once drops frames while scrolling (perf budget in tests/perf: 5.9% dropped frames against a budget of 3%). Row heights differ (a project is two lines with 8 of space above,
// pinned separators, ...): rows that have been drawn are measured and remembered, and ones not drawn yet are estimated by type. Row positions are all computed from offsets: marquee selection, keyboard movement and scrolling into view never look up rows in the DOM.
// Measuring relies on the .lib-row-wrap[data-index] layer wrapping each row in LibraryPanel; renaming the class means changing both places

/** Estimated row heights (for rows not drawn yet): a normal row, a project row (two lines), the gap above a project, the pinned separator. Once drawn, the measured value is used */
const ROW = 28;
const ROW_PROJECT = 44;
const GAP = 8;
const SEP = 9;
/** Draw this much extra above and below the visible range (so no blank shows when scrolling fast) */
const OVERSCAN = 600;

export function useVirtualRows(rows: Row[], list: RefObject<HTMLDivElement | null>) {
  const heights = useRef(new Map<string, number>());
  const [measured, setMeasured] = useState(0);
  const [view, setView] = useState({ top: 0, height: 0 });
  /** A project row (other than the first) has 8 of space above it, counted into that row together with the pinned separator */
  const gapAbove = (i: number) => rows[i].type === "project" && i > 0;
  const estimate = (i: number) =>
    rows[i].type === "project"
      ? ROW_PROJECT + (gapAbove(i) ? GAP : 0) + (prevProjectPinned(rows, i) && !rows[i].project.pinned ? SEP : 0)
      : ROW;
  const offsets = useMemo(() => {
    const o = new Float64Array(rows.length + 1);
    for (let i = 0; i < rows.length; i++) o[i + 1] = o[i] + (heights.current.get(rows[i].id) ?? estimate(i));
    return o;
    // measured is the version number of heights: incremented when a new row height is measured
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, measured]);
  /** The first row whose bottom edge is below y (offsets are ascending, found by binary search) */
  const rowAt = (y: number) => {
    let lo = 0;
    let hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (offsets[mid + 1] <= y) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  /** The padding above the list: offsets are counted from below it */
  const listPad = () => (list.current ? parseFloat(getComputedStyle(list.current).paddingTop) || 0 : 0);
  /** Which rows to draw: [first, last) */
  const first = rows.length ? Math.max(0, rowAt(view.top - OVERSCAN)) : 0;
  const last = rows.length ? Math.min(rows.length, rowAt(view.top + (view.height || 1200) + OVERSCAN) + 1) : 0;
  /** The rows and positions drawn most recently: used in events and rAF (the rows may have changed during a marquee drag) */
  const layout = useRef({ rows, offsets });
  useLayoutEffect(() => {
    layout.current = { rows, offsets };
  });
  /** Scroll this row into view (like scrollIntoView({ block: "nearest" }), but without depending on whether the row is in the DOM) */
  const revealRow = (id: string | undefined) => {
    const el = list.current;
    const { rows: rs, offsets: o } = layout.current;
    const i = id === undefined ? -1 : rs.findIndex((r) => r.id === id);
    if (!el || i < 0) return;
    const pad = listPad();
    const top = pad + o[i];
    const bottom = pad + o[i + 1];
    if (top < el.scrollTop) el.scrollTop = top;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight;
  };
  // Scrolling and resizing: record the visible range (at most once per frame)
  useEffect(() => {
    const el = list.current;
    if (!el) return;
    let raf = 0;
    const read = () => {
      raf = 0;
      const pad = parseFloat(getComputedStyle(el).paddingTop) || 0;
      setView((v) =>
        v.top === el.scrollTop - pad && v.height === el.clientHeight ? v : { top: el.scrollTop - pad, height: el.clientHeight },
      );
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(read);
    };
    read();
    el.addEventListener("scroll", onScroll, { passive: true });
    const ro = new ResizeObserver(onScroll);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [list]);
  // Measure the rows that were drawn: if one differs from what is remembered (first draw, text wrapped, a separator was added), record it and recompute positions.
  // No dependencies on purpose: row heights vary with content and it is hard to list every value they depend on, so measure after every render; setState is called only when something changed, and once measurements stop changing it stops, so there is no infinite loop
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    let changed = false;
    for (const wrap of el.querySelectorAll<HTMLElement>(".lib-row-wrap[data-index]")) {
      const row = rows[Number(wrap.dataset.index)];
      if (!row) continue;
      const h = wrap.offsetHeight;
      if (h > 0 && heights.current.get(row.id) !== h) {
        heights.current.set(row.id, h);
        changed = true;
      }
    }
    if (changed) setMeasured((n) => n + 1);
  });

  return { offsets, first, last, gapAbove, listPad, layout, revealRow };
}
