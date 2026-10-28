import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useIntl } from "react-intl";
import {
  clipPolyline,
  clipRect,
  clipSegment,
  isMarkColor,
  keepColor,
  pathFromRuns,
  pathRuns,
  roundShape,
  shapeHit,
  shapesOf,
  type Annotation,
  type Shape,
} from "@sniptoss/core";
import type { Tool } from "./annotate";
import { toolCursor } from "./cursors";
import { useKeys } from "./keys";
import { cssZoom } from "./cssZoom";
import { placeColorOf, placeStyle } from "./markColors";
import { drawGuard, ZoomBlankDrag, ZoomOverlay, type BlankDrag } from "./ZoomView";

// The annotation layer on the canvas. It lives inside ZoomView's zoom-content and zooms and pans with the canvas. Anything that must keep
// a fixed size on screen is scaled by --inv-zoom: line width and hit range (screenWidth), numbers, pins, handles and the pixel readout
// (transform). Line width cannot rely on vector-effect: non-scaling-stroke: ZoomView scales the whole canvas with a CSS transform, and
// Chromium's non-scaling-stroke only cancels transforms inside the SVG, not the outer CSS scale: when a 1920-wide image is fitted at
// 0.37x, a 2px line is really 0.75px. While dragging, SVG attributes and the readout are changed directly, not through React state;
// editing an existing mark (move, drag a handle) redraws only that one mark. One note can mark several places (anchor.shapes, ADR-0009):
// every place is drawn with the same number, and moving, dragging handles and arrow keys act on "the place that was hit" (part). Points,
// rectangles and arrows snap to whole pixels of the item; freehand does not, so the line stays smooth. A stroke may start outside the
// canvas: while drawing it follows the hand (the part outside is visible too), and on release only the part inside the canvas is recorded
// (core's clip*), without squeezing against the canvas edge, which would drag a freehand stroke into a straight line along the edge.

/** Bounding box in screen coordinates (as in getBoundingClientRect) */
export interface ScreenBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ShownAnnotation {
  annotation: Annotation;
  /** Number in the panel; the same number is shown on the canvas */
  index: number;
  dim: boolean;
}

type Pt = [number, number];
type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "from" | "to";

interface Edit {
  id: string;
  /** Which place of this note */
  part: number;
  handle: Handle | "move";
  start: Pt;
  orig: Shape;
  moved: boolean;
}

/** Drawing tools: pressing on the canvas draws */
const DRAW_TOOLS: Tool[] = ["point", "rect", "pen", "arrow"];

export function AnnotationLayer(props: {
  /** Drawn size: layout and whole-pixel snapping use it */
  size: { w: number; h: number };
  /** Original image size (given when it differs from size): the pixel readout uses it */
  natural?: { w: number; h: number };
  shown: ShownAnnotation[];
  /** Places already drawn for the note being written (not saved yet); anything drawn on the canvas while the composer is open is added here */
  draft?: readonly Shape[];
  /** Number of the note being written (a new note gets the next number of the canvas-marks section; an existing one keeps its own) */
  draftIndex?: number;
  tool: Tool;
  selectedId?: string;
  /** Mark color from Settings: used by marks without their own color (a mark with its own color uses the note's color, markColors.ts) */
  color: string;
  /** The note being edited in the composer already has its own color: draft is drawn in it */
  draftColor?: string;
  width: number;
  /** box: bounding box of the mark just drawn on screen; the input box pops up next to it without covering it */
  onCreate: (shape: Shape, box: ScreenBox) => void;
  onSelect: (id: string) => void;
  /** Moving / dragging a handle changed place `part` of an existing mark */
  onChange: (id: string, part: number, shape: Shape) => void;
  /** Double-click a mark: edit that note (same as double-clicking its card in the notes panel) */
  onEdit?: (id: string) => void;
  /** View-only (the notes file for this item cannot be read, or was written by a newer version): marks can be selected but not moved or resized */
  locked?: boolean;
  /**
   * Which place of which note was hit on the canvas (undefined = clicked outside the annotation layer): number keys 1–6 change the color of
   * this place only (when a note has several places; same as hitting one place in Screen Capture). It is the same place the arrow keys
   * move (armed)
   */
  onArm?: (hit: { id: string; part: number } | undefined) => void;
  /**
   * Single click (press, release without dragging) on one mark on the canvas: Workspace pops up a row of colors next to it (MarkColorBar;
   * after a hit it was not obvious that the color could be changed, as with a hit mark in Screen Capture). With the Select tool: click an
   * existing mark; with a drawing tool: a click on a mark without dragging also counts as a hit and places nothing new (same as the
   * capture overlay; dragging draws as usual); the places of the note being written can be hit with any tool (while writing, clicking
   * another note still adds a place)
   */
  onPick?: (hit: MarkHit) => void;
  /** The place that was hit (blue ring around its number; the color bar sits next to it) */
  picked?: MarkHit;
  /** With the Select tool, dragging on blank canvas draws a rectangle */
  drawOnBlank?: boolean;
  /** With the Select tool, the drag started and a rectangle is being drawn (a video pauses on this frame first) */
  onDrawStart?: () => void;
}) {
  const { w, h } = props.size;
  /**
   * The readout reports original image size (the SVG uses its declared size; a shell-converted image uses the pre-conversion size; same
   * as the pixels given to AI, mediaSize.ts)
   */
  const { w: rw, h: rh } = props.natural ?? props.size;
  const intl = useIntl();
  /** Arrow length readout (message, e.g. "Length 230"). The number is turned into text first: the readout has no thousands separator */
  const lengthText = (len: number) => intl.formatMessage({ id: "stage.reading.length" }, { len: String(len) });
  const root = useRef<HTMLDivElement>(null);
  const live = useRef<SVGGElement>(null);
  const readout = useRef<HTMLDivElement>(null);
  const drawing = useRef<{ tool: Tool; start: Pt; points: Pt[] } | undefined>(undefined);
  const edit = useRef<Edit | undefined>(undefined);
  const [preview, setPreview] = useState<{ id: string; part: number; shape: Shape }>();
  const previewRef = useRef(preview);
  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;
  const onArmRef = useRef(props.onArm);
  onArmRef.current = props.onArm;
  const onPickRef = useRef(props.onPick);
  onPickRef.current = props.onPick;
  /** Which mark the press landed on (release without moving = single click, handed to onPick) */
  const press = useRef<{ hit: MarkHit; x: number; y: number } | undefined>(undefined);
  /**
   * The mark hit on the canvas (which place of which note): only it can be moved with the arrow keys. A note selected from the notes
   * panel doesn't count; the arrow keys still step frames / switch items
   */
  const armed = useRef<{ id: string; part: number } | undefined>(undefined);
  /**
   * While nudging with arrow keys: only the canvas changes first, and it is saved when the key is released (holding the key doesn't take
   * a snapshot on every step)
   */
  const nudging = useRef<{ id: string; part: number; shape: Shape; timer: number } | undefined>(undefined);

  const drawingTool = DRAW_TOOLS.includes(props.tool);
  /** Only the Select tool can select, move and drag handles; with the Hand or a drawing tool the marks let the mouse through */
  const editable = props.tool === "select";
  const movable = editable && !props.locked;
  const cursor = useMemo(() => toolCursor(props.tool, props.color), [props.tool, props.color]);
  /**
   * The drawing input layer hangs on ZoomView's layer that covers the whole canvas area: a stroke can start on blank space outside the
   * canvas, and coordinates are clamped to the canvas edge
   */
  const overlay = useContext(ZoomOverlay);

  const layerRect = () => root.current!.getBoundingClientRect();
  /**
   * Screen coordinates → 0–1. snap: align to whole pixels of the item (zoomed in, edges fall on pixel borders; zoomed out, single pixels
   * can't be told apart anyway). keepOutside: when drawing a new mark keep coordinates outside the canvas (below 0 or above 1) and clip
   * on release; when moving or dragging handles, clamp to the canvas
   */
  const toNorm = (clientX: number, clientY: number, snap = true, keepOutside = false): Pt => {
    const r = layerRect();
    let x = (clientX - r.left) / r.width;
    let y = (clientY - r.top) / r.height;
    if (!keepOutside) [x, y] = [clamp01(x), clamp01(y)];
    return snap ? [Math.round(x * w) / w, Math.round(y * h) / h] : [x, y];
  };
  /** Coordinates for drawing a new mark: freehand doesn't snap to whole pixels, and all keep the part outside the canvas */
  const drawPoint = (tool: Tool, x: number, y: number) => toNorm(x, y, tool !== "pen", true);

  // ---------- Pixel readout: next to the pointer while drawing, moving or dragging ----------
  const showReadout = (at: Pt, [main, sub]: Reading) => {
    const el = readout.current;
    if (!el) return;
    el.style.left = `${at[0] * 100}%`;
    el.style.top = `${at[1] * 100}%`;
    el.innerHTML = `<b>${main}</b>${sub ? `<span>${sub}</span>` : ""}`;
    el.classList.add("is-on");
    // Near the right / bottom edge of the canvas area it flips to the left / top of the pointer so it isn't clipped.
    // The offset matches the CSS translate(18px, 30px), in screen pixels
    const view = el.closest(".zoom-view")?.getBoundingClientRect();
    if (!view) return;
    const r = layerRect();
    const size = el.getBoundingClientRect();
    const z = cssZoom();
    el.classList.toggle("flip-x", r.left + at[0] * r.width + 18 * z + size.width > view.right - 4 * z);
    el.classList.toggle("flip-y", r.top + at[1] * r.height + 30 * z + size.height > view.bottom - 4 * z);
  };
  const hideReadout = () => readout.current?.classList.remove("is-on");
  const screenDist = (a: Pt, b: Pt) => {
    const r = layerRect();
    return Math.hypot((a[0] - b[0]) * r.width, (a[1] - b[1]) * r.height);
  };

  // ---------- Drawing a new mark ----------
  const beginDraw = (tool: Tool, x: number, y: number) => {
    drawGuard.at = performance.now();
    const p = drawPoint(tool, x, y);
    drawing.current = { tool, start: p, points: [p] };
    renderLive(tool, p, p, [p]);
  };
  const moveDraw = (x: number, y: number) => {
    const d = drawing.current;
    if (!d) return;
    const p = drawPoint(d.tool, x, y);
    if (d.tool === "pen" && screenDist(d.points[d.points.length - 1], p) >= 2) d.points.push(p);
    renderLive(d.tool, d.start, p, d.points);
  };
  const endDraw = (x: number, y: number) => {
    const d = drawing.current;
    drawing.current = undefined;
    if (live.current) live.current.innerHTML = "";
    hideReadout();
    if (!d) return;
    const p = drawPoint(d.tool, x, y);
    const shape = recorded(d.tool, d.start, p, d.points);
    if (!shape) return; // entirely outside the canvas, or so small it counts as a shaky hand
    // The note being written already has a pin at almost the same spot (a fast double-click, an extra click): don't drop another on top
    if (shape.type === "point" && props.draft?.some((s) => s.type === "point" && screenDist([s.x, s.y], [shape.x, shape.y]) < 6)) return;
    const [l, t, r, b] = bounds(shape);
    const lr = layerRect();
    props.onCreate(roundShape(shape, w, h), {
      left: lr.left + l * lr.width,
      top: lr.top + t * lr.height,
      right: lr.left + r * lr.width,
      bottom: lr.top + b * lr.height,
    });
  };
  const onDrawDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return; // the middle button is for panning
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const hit = pickableAt(e.clientX, e.clientY);
    press.current = hit && { hit, x: e.clientX, y: e.clientY };
    e.currentTarget.classList.remove("is-over-mark");
    beginDraw(props.tool, e.clientX, e.clientY);
  };
  /** Release with a drawing tool: pressed on a mark and didn't drag = hit it (draws nothing); otherwise finish drawing as usual */
  const onDrawUp = (e: React.PointerEvent) => {
    const pr = press.current;
    press.current = undefined;
    if (!pr || !isClick(pr, e)) return endDraw(e.clientX, e.clientY);
    drawing.current = undefined;
    if (live.current) live.current.innerHTML = "";
    hideReadout();
    props.onPick?.(pr.hit);
  };
  /**
   * The mark that can be hit at this screen point (found by position with a drawing tool, or with the Select tool on blank space):
   * while a note is being written only its own places count, and clicking on another note still adds a place (ADR-0009)
   */
  const pickableAt = (x: number, y: number): MarkHit | undefined => {
    if (!root.current || !props.onPick) return undefined;
    const find = (id: string) => props.shown.find((s) => s.annotation.id === id)?.annotation;
    const hit = markAt(root.current, x, y, find, props.selectedId, props.draft);
    return hit && (hit.id === undefined || !props.draft?.length) ? hit : undefined;
  };
  /**
   * Over a mark that can be hit, the pointer becomes a hand (a click changes its color rather than drawing; as in the capture overlay,
   * hovering shows that a click can change the color). Used with a drawing tool, and with the Select tool over the places of the note
   * being written: in both cases the marks don't take the mouse, so it is computed by position (draftOnly: only the places being
   * written; existing marks have their own hand cursor). At most once per frame, using the last position of the frame
   */
  const hover = useRef<{ el: Element; x: number; y: number; draftOnly: boolean; frame: number }>(undefined);
  const hoverMark = (el: Element, x: number, y: number, draftOnly = false) => {
    const prev = hover.current;
    hover.current = { el, x, y, draftOnly, frame: prev?.frame ?? 0 };
    if (prev?.frame) return;
    hover.current.frame = requestAnimationFrame(() => {
      const now = hover.current!;
      now.frame = 0;
      const hit = drawing.current ? undefined : pickableAt(now.x, now.y);
      now.el.classList.toggle("is-over-mark", !!hit && (!now.draftOnly || hit.id === undefined));
    });
  };
  useEffect(() => () => cancelAnimationFrame(hover.current?.frame ?? 0), []);
  // With the Select tool, dragging on blank space draws a rectangle (ZoomView takes the gesture and hands it over only once it
  // becomes a drag; without a drag it is still a single click: deselect, play / pause a video)
  const blankDrag = useContext(ZoomBlankDrag);
  useEffect(() => {
    if (!props.drawOnBlank) return;
    const handlers: BlankDrag = {
      start: (x, y) => {
        props.onDrawStart?.();
        beginDraw("rect", x, y);
      },
      move: moveDraw,
      end: endDraw,
      // The places of the note being written don't take the mouse (a drag starting on top still draws a rectangle); a single click
      // lands here and the place hit is found by position. Existing marks take the mouse themselves and never get here
      click: (x, y) => {
        const hit = pickableAt(x, y);
        if (hit?.id !== undefined || !hit) return false;
        drawGuard.at = performance.now(); // a second click right after must not pair up into a double-click zoom
        props.onPick?.(hit);
        return true;
      },
      hover: (el, x, y) => hoverMark(el, x, y, true),
    };
    blankDrag.current = handlers;
    return () => {
      if (blankDrag.current === handlers) blankDrag.current = undefined;
    };
  });

  /**
   * The mark actually recorded on release: only the part inside the canvas. Too small ones don't count (rectangle 6, arrow 8 screen
   * pixels, freehand fewer than 3 points). A point outside the canvas is not placed
   */
  const recorded = (tool: Tool, a: Pt, b: Pt, pts: Pt[]): Shape | undefined => {
    switch (tool) {
      case "point":
        return b[0] >= 0 && b[0] <= 1 && b[1] >= 0 && b[1] <= 1 ? { type: "point", x: b[0], y: b[1] } : undefined;
      case "rect": {
        const r = clipRect(a, b);
        return r && screenDist([r.x, r.y], [r.x + r.w, r.y + r.h]) >= 6 ? r : undefined;
      }
      case "arrow": {
        const seg = clipSegment(a, b);
        return seg && screenDist(seg[0], seg[1]) >= 8 ? { type: "arrow", from: seg[0], to: seg[1] } : undefined;
      }
      case "pen": {
        const runs = clipPolyline(pts).filter((run) => run.length >= 2);
        return runs.reduce((n, run) => n + run.length, 0) >= 3 ? pathFromRuns(runs) : undefined;
      }
      default:
        return undefined;
    }
  };

  /**
   * Preview while dragging, written straight into the SVG and following the hand (the part outside the canvas is drawn too); the readout
   * reports the part that will be recorded on release
   */
  const renderLive = (tool: Tool, a: Pt, b: Pt, pts: Pt[]) => {
    const g = live.current;
    if (!g) return;
    const s: Shape | undefined =
      tool === "rect"
        ? rectFrom(a, b)
        : tool === "arrow"
          ? { type: "arrow", from: a, to: b }
          : tool === "pen"
            ? { type: "path", points: pts }
            : undefined;
    g.innerHTML = s ? shapeMarkup(s, w, h, props.color, props.width + 0.5) : "";
    const kept = tool === "pen" ? undefined : recorded(tool, a, b, pts);
    const r = kept && reading(kept, rw, rh, "draw", kept.type === "arrow" ? kept.to : b, lengthText);
    if (r) showReadout(b, r);
    else hideReadout();
  };

  // ---------- Editing an existing mark: move, drag a handle ----------
  const startEdit = (e: React.PointerEvent, a: Annotation, part: number, handle: Handle | "move") => {
    if (!editable || e.button !== 0) return;
    e.stopPropagation();
    armed.current = { id: a.id, part };
    props.onArm?.(armed.current);
    if (handle === "move") press.current = { hit: { id: a.id, part }, x: e.clientX, y: e.clientY };
    if (a.id !== props.selectedId) {
      // The first click only selects; dragging after it is selected moves
      props.onSelect(a.id);
      if (handle === "move") return;
    }
    if (!movable) return;
    const shape = shapesOf(a)[part];
    if (!shape) return;
    commitNudge();
    edit.current = { id: a.id, part, handle, start: toNorm(e.clientX, e.clientY), orig: shape, moved: false };
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const ed = edit.current;
      if (!ed) return;
      const p = toNorm(e.clientX, e.clientY);
      if (!ed.moved && screenDist(ed.start, p) < 3) return;
      ed.moved = true;
      const shape = snapShape(applyEdit(ed.orig, ed.handle, [p[0] - ed.start[0], p[1] - ed.start[1]], p), w, h);
      previewRef.current = { id: ed.id, part: ed.part, shape };
      setPreview(previewRef.current);
      const active = shape.type === "arrow" ? (ed.handle === "to" ? shape.to : shape.from) : p;
      const r = reading(shape, rw, rh, ed.handle === "move" ? "move" : "draw", active, lengthText);
      if (r) showReadout(p, r);
    };
    const up = (e: PointerEvent) => {
      const ed = edit.current;
      const pv = previewRef.current;
      const pr = press.current;
      edit.current = undefined;
      previewRef.current = undefined;
      press.current = undefined;
      hideReadout();
      // With the Select tool, a click on a mark without dragging hits it (color bar). A drag moves it
      if (pr && e.type === "pointerup" && isClick(pr, e)) onPickRef.current?.(pr.hit);
      if (!ed) return;
      if (ed.moved && pv) onChangeRef.current(ed.id, ed.part, roundShape(pv.shape, w, h));
      setPreview(undefined);
    };
    // A click outside the annotation layer (notes panel, playback bar, blank space) stops the arrow keys from moving the mark
    const disarm = (e: PointerEvent) => {
      if (root.current?.contains(e.target as Node) || !armed.current) return;
      armed.current = undefined;
      onArmRef.current?.(undefined);
    };
    const keyUp = (e: KeyboardEvent) => {
      if (e.key.startsWith("Arrow")) commitNudge();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("pointerdown", disarm, true);
    window.addEventListener("keyup", keyUp);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("pointerdown", disarm, true);
      window.removeEventListener("keyup", keyUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The item was switched before the nudge was saved: save it when the old canvas unmounts. This must be a layout effect: the cleanup of
  // a normal effect runs only after the new item is mounted, so the snapshot would capture the new item; with the old canvas already
  // gone the snapshot step is skipped (the position is still stored correctly, and the snapshot updates on the next change)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useLayoutEffect(() => () => commitNudge(), []);

  /** The places of a note, with the one being moved replaced by its new position */
  const partsOf = (a: Annotation): readonly Shape[] => {
    const parts = shapesOf(a);
    return preview?.id === a.id ? parts.map((s, i) => (i === preview.part ? preview.shape : s)) : parts;
  };
  const selected = props.shown.find((s) => s.annotation.id === props.selectedId)?.annotation;
  const selectedParts = selected ? partsOf(selected) : [];

  // ---------- Arrow keys move the selected mark: 1 pixel, 10 with Shift held ----------
  function commitNudge() {
    const n = nudging.current;
    if (!n) return;
    clearTimeout(n.timer);
    nudging.current = undefined;
    onChangeRef.current(n.id, n.part, roundShape(n.shape, w, h));
    setPreview(undefined);
    hideReadout();
  }
  const nudge = (e: KeyboardEvent, dx: number, dy: number) => {
    // Menu items like Playback → Previous Frame send simulated arrow keys (pressKey): those step frames or skip seconds, they don't
    // move the mark (opening a menu by keyboard involves no mouse press, so the mark would still count as "hit")
    const part = selected && armed.current?.id === selected.id ? armed.current.part : undefined;
    const shape = part !== undefined ? selectedParts[part] : undefined;
    if (!e.isTrusted || !selected || part === undefined || !shape || document.querySelector(".overlay")) return false;
    const next = snapShape(applyEdit(shape, "move", [dx / w, dy / h], [0, 0]), w, h);
    clearTimeout(nudging.current?.timer);
    // Saved when the arrow key is released; if the release never arrives (window lost focus), it is saved shortly after the last press
    nudging.current = { id: selected.id, part, shape: next, timer: window.setTimeout(commitNudge, 800) };
    setPreview({ id: selected.id, part, shape: next });
    const [, , r, b] = bounds(next);
    const reads = reading(next, rw, rh, "move", labelPoint(next)!, lengthText);
    if (reads) showReadout([r, b], reads);
  };
  useKeys(
    {
      ArrowLeft: (e) => nudge(e, -1, 0),
      ArrowRight: (e) => nudge(e, 1, 0),
      ArrowUp: (e) => nudge(e, 0, -1),
      ArrowDown: (e) => nudge(e, 0, 1),
      "Shift+ArrowLeft": (e) => nudge(e, -10, 0),
      "Shift+ArrowRight": (e) => nudge(e, 10, 0),
      "Shift+ArrowUp": (e) => nudge(e, 0, -10),
      "Shift+ArrowDown": (e) => nudge(e, 0, 10),
    },
    { enabled: movable && selectedParts.length > 0, first: true },
  );

  return (
    <div
      ref={root}
      className={`annot-layer tool-${props.tool}${editable ? " is-editable" : ""}`}
      style={{ "--mark": props.color } as React.CSSProperties}
    >
      <svg className="annot-svg" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
        {props.shown.flatMap(({ annotation: a, dim }) =>
          partsOf(a).map((s, part) => (
            <ShapeView
              key={`${a.id}:${part}`}
              id={a.id}
              part={part}
              shape={s}
              w={w}
              h={h}
              color={placeColorOf(a, part, props.color)}
              width={props.width}
              selected={a.id === props.selectedId}
              dim={dim}
              onPointerDown={editable ? (e) => startEdit(e, a, part, "move") : undefined}
              onDoubleClick={props.onEdit && (() => props.onEdit!(a.id))}
            />
          )),
        )}
        {props.draft?.map((s, part) => (
          <ShapeView
            key={`draft:${part}`}
            part={part}
            draft
            shape={s}
            w={w}
            h={h}
            color={isMarkColor(s.color) ? s.color : (props.draftColor ?? props.color)}
            width={props.width}
            selected
            dim={false}
          />
        ))}
        <g ref={live} />
      </svg>

      {props.shown.flatMap(({ annotation: a, index, dim }) =>
        partsOf(a).map((s, part) => {
          const at = labelPoint(s);
          if (!at) return null;
          return (
            <button
              key={`${a.id}:${part}`}
              data-id={a.id}
              data-part={part}
              className={`annot-badge${a.id === props.selectedId ? " is-selected" : ""}${dim ? " is-dim" : ""}${s.type === "point" ? " is-pin" : ""}${props.picked?.id === a.id && props.picked.part === part ? " is-picked" : ""}`}
              style={{ left: `${at[0] * 100}%`, top: `${at[1] * 100}%`, ...placeStyle(a, part) }}
              onPointerDown={editable ? (e) => startEdit(e, a, part, "move") : undefined}
              onDoubleClick={props.onEdit && (() => props.onEdit!(a.id))}
              title={a.body}
            >
              {index}
            </button>
          );
        }),
      )}
      {/* The note being written: every place shows the number it will get (without numbers a pin was invisible altogether: the pin is the number) */}
      {props.draft?.map((s, part) => {
        const at = labelPoint(s);
        if (!at) return null;
        return (
          <span
            key={`draft:${part}`}
            data-draft-part={part}
            className={`annot-badge is-selected is-draft${s.type === "point" ? " is-pin" : ""}${props.picked && props.picked.id === undefined && props.picked.part === part ? " is-picked" : ""}`}
            style={{
              left: `${at[0] * 100}%`,
              top: `${at[1] * 100}%`,
              ...(isMarkColor(s.color) ? { "--mark": s.color } : props.draftColor ? { "--mark": props.draftColor } : {}),
            }}
          >
            {props.draftIndex}
          </span>
        );
      })}

      {movable &&
        selected &&
        selectedParts.flatMap((s, part) =>
          handlesFor(s).map(([name, pt]) => (
            <div
              key={`${part}:${name}`}
              className={`annot-handle handle-${name}`}
              style={{ left: `${pt[0] * 100}%`, top: `${pt[1] * 100}%`, ...placeStyle(selected, part) }}
              onPointerDown={(e) => startEdit(e, selected, part, name)}
            />
          )),
        )}

      {drawingTool &&
        overlay &&
        createPortal(
          <div
            className={`annot-input tool-${props.tool}`}
            style={{ "--draw-cursor": cursor } as React.CSSProperties}
            onPointerDown={onDrawDown}
            onPointerMove={(e) => (drawing.current ? moveDraw(e.clientX, e.clientY) : hoverMark(e.currentTarget, e.clientX, e.clientY))}
            onPointerUp={onDrawUp}
            onPointerCancel={(e) => endDraw(e.clientX, e.clientY)}
          />,
          overlay,
        )}
      <div className="annot-readout" ref={readout} />
    </div>
  );
}

/** Readout: [main (the value that is changing), secondary] */
type Reading = [string, string?];

/**
 * Pixel readout for a mark. draw: drawing a new one or dragging a handle; move: moving it as a whole.
 * active: the end of the arrow that is moving (its coordinates are read)
 */
function reading(
  s: Shape,
  w: number,
  h: number,
  mode: "draw" | "move",
  active: Pt,
  lengthText: (len: number) => string,
): Reading | undefined {
  const px = (v: number, total: number) => Math.round(v * total);
  // A fullwidth space (U+3000) between x and y keeps the two numbers apart even when one is long and the other short
  const at = (p: Pt) => `x ${px(p[0], w)}\u3000y ${px(p[1], h)}`;
  switch (s.type) {
    case "rect": {
      const size = `${px(s.w, w)} × ${px(s.h, h)}`;
      const pos = at([s.x, s.y]);
      // Just pressed and not dragged yet: report only the start point
      if (mode === "move" || (px(s.w, w) === 0 && px(s.h, h) === 0)) return [pos, mode === "move" ? size : undefined];
      return [size, pos];
    }
    case "point":
      return [at([s.x, s.y])];
    case "arrow": {
      const len = Math.round(Math.hypot((s.to[0] - s.from[0]) * w, (s.to[1] - s.from[1]) * h));
      return [at(active), lengthText(len)];
    }
    case "path": {
      if (mode === "draw") return undefined;
      const [l, t] = bounds(s);
      return [at([l, t])];
    }
  }
}

/** Bounding box: [left, top, right, bottom] */
function bounds(s: Shape): [number, number, number, number] {
  switch (s.type) {
    case "rect":
      return [s.x, s.y, s.x + s.w, s.y + s.h];
    case "point":
      return [s.x, s.y, s.x, s.y];
    case "arrow":
      return [Math.min(s.from[0], s.to[0]), Math.min(s.from[1], s.to[1]), Math.max(s.from[0], s.to[0]), Math.max(s.from[1], s.to[1])];
    case "path": {
      const xs = s.points.map((q) => q[0]);
      const ys = s.points.map((q) => q[1]);
      return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
    }
  }
}

function ShapeView(props: {
  /** Note id, written to data-id: the canvas context menu uses it to tell which note was clicked */
  id?: string;
  /** Which place of this note (data-part; for the note being written it goes to data-draft-part) */
  part: number;
  draft?: boolean;
  shape: Shape;
  w: number;
  h: number;
  color: string;
  width: number;
  selected: boolean;
  dim: boolean;
  onPointerDown?: (e: React.PointerEvent) => void;
  onDoubleClick?: () => void;
}) {
  const { shape: s, w, h } = props;
  const sw = props.selected ? props.width + 1 : props.width;
  const common = {
    stroke: props.color,
    style: { strokeWidth: screenWidth(sw) },
    fill: "none",
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  // A dark casing under the line, 1 wider on each side: an orange line over red, magenta or yellow has under 3:1 contrast and a blurry
  // halo alone doesn't separate them
  const casing = {
    ...common,
    stroke: undefined,
    className: "annot-casing",
    style: { stroke: "var(--casing)", strokeWidth: screenWidth(sw + 2) },
  };
  // An invisible thick stroke / fill so thin lines are easy to hit (14px wide on screen); a selected rectangle can be dragged anywhere inside
  const hit = props.onPointerDown
    ? {
        stroke: "transparent",
        style: { strokeWidth: screenWidth(HIT_WIDTH) },
        className: "annot-hit",
        onPointerDown: props.onPointerDown,
        onDoubleClick: props.onDoubleClick,
      }
    : undefined;
  const cls = `annot-shape${props.selected ? " is-selected" : ""}${props.dim ? " is-dim" : ""}${props.draft ? " is-draft" : ""}`;
  const data = props.draft ? { "data-draft-part": props.part } : { "data-id": props.id, "data-part": props.part };
  /** The glow (--mark) when selected or hovered follows this note's own color */
  const glow = { "--mark": props.color } as React.CSSProperties;
  switch (s.type) {
    case "rect": {
      const r = { x: s.x * w, y: s.y * h, width: s.w * w, height: s.h * h };
      return (
        <g className={cls} {...data} style={glow}>
          <rect {...r} {...casing} />
          <rect {...r} {...common} />
          {hit && <rect {...r} {...hit} fill={props.selected ? "rgba(0,0,0,0)" : "none"} />}
        </g>
      );
    }
    case "path": {
      // A stroke split into several runs (it left the canvas and came back): each run is drawn separately and runs are not joined
      const runs = pathRuns(s).map((run) => run.map(([x, y]) => `${x * w},${y * h}`).join(" "));
      return (
        <g className={cls} {...data} style={glow}>
          {runs.map((points, i) => (
            <polyline key={`c${i}`} points={points} {...casing} />
          ))}
          {runs.map((points, i) => (
            <polyline key={i} points={points} {...common} />
          ))}
          {hit && runs.map((points, i) => <polyline key={`h${i}`} points={points} {...hit} fill="none" />)}
        </g>
      );
    }
    case "arrow": {
      const [x1, y1, x2, y2] = [s.from[0] * w, s.from[1] * h, s.to[0] * w, s.to[1] * h];
      const deg = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
      return (
        <g className={cls} {...data} style={glow}>
          <line x1={x1} y1={y1} x2={x2} y2={y2} {...casing} />
          <line x1={x1} y1={y1} x2={x2} y2={y2} {...common} />
          {/* Dark casing of the arrowhead: stroke 2, stroke painted before fill, so exactly 1 shows outside (the head is already scaled
              to screen pixels) */}
          <path
            d="M0 0 L-14 -7 L-14 7 Z"
            fill={props.color}
            style={{
              transform: `translate(${x2}px, ${y2}px) rotate(${deg}deg) scale(var(--inv-zoom, 1))`,
              stroke: "var(--casing)",
              strokeWidth: 2,
              strokeLinejoin: "round",
              paintOrder: "stroke",
            }}
          />
          {hit && <line x1={x1} y1={y1} x2={x2} y2={y2} {...hit} />}
        </g>
      );
    }
    case "point":
      return null; // a point is drawn as an HTML pin (annot-badge.is-pin), with a fixed size on screen
  }
}

/** Handles of the selected mark: 8 for a rectangle, the two ends for an arrow; a point and freehand can only be moved as a whole */
function handlesFor(s: Shape): [Handle, Pt][] {
  switch (s.type) {
    case "rect": {
      const [l, t, r, b, cx, cy] = [s.x, s.y, s.x + s.w, s.y + s.h, s.x + s.w / 2, s.y + s.h / 2];
      return [
        ["nw", [l, t]],
        ["n", [cx, t]],
        ["ne", [r, t]],
        ["e", [r, cy]],
        ["se", [r, b]],
        ["s", [cx, b]],
        ["sw", [l, b]],
        ["w", [l, cy]],
      ];
    }
    case "arrow":
      return [
        ["from", s.from],
        ["to", s.to],
      ];
    default:
      return [];
  }
}

/** Changes a mark by the drag distance. d is the normalized displacement, p the current point; this place's own color is kept */
function applyEdit(s: Shape, handle: Handle | "move", d: Pt, p: Pt): Shape {
  return keepColor(s, moved(s, handle, d, p));
}

function moved(s: Shape, handle: Handle | "move", d: Pt, p: Pt): Shape {
  if (handle === "move") {
    switch (s.type) {
      case "rect":
        return { ...s, x: clamp(s.x + d[0], 0, 1 - s.w), y: clamp(s.y + d[1], 0, 1 - s.h) };
      case "point":
        return { ...s, x: clamp01(s.x + d[0]), y: clamp01(s.y + d[1]) };
      case "arrow": {
        const dx = clamp(d[0], -Math.min(s.from[0], s.to[0]), 1 - Math.max(s.from[0], s.to[0]));
        const dy = clamp(d[1], -Math.min(s.from[1], s.to[1]), 1 - Math.max(s.from[1], s.to[1]));
        return { ...s, from: [s.from[0] + dx, s.from[1] + dy], to: [s.to[0] + dx, s.to[1] + dy] };
      }
      case "path": {
        const xs = s.points.map((q) => q[0]);
        const ys = s.points.map((q) => q[1]);
        const dx = clamp(d[0], -Math.min(...xs), 1 - Math.max(...xs));
        const dy = clamp(d[1], -Math.min(...ys), 1 - Math.max(...ys));
        return { ...s, points: s.points.map(([x, y]) => [x + dx, y + dy] as Pt) };
      }
    }
  }
  if (s.type === "arrow") return handle === "from" ? { ...s, from: p } : { ...s, to: p };
  if (s.type !== "rect") return s;
  let [l, t, r, b] = [s.x, s.y, s.x + s.w, s.y + s.h];
  if (handle.includes("w")) l = p[0];
  if (handle.includes("e")) r = p[0];
  if (handle.includes("n")) t = p[1];
  if (handle.includes("s")) b = p[1];
  // Dragging past the opposite edge flips it and still gives a rectangle with positive size
  return rectFrom([l, t], [r, b]);
}

function rectFrom(a: Pt, b: Pt): Shape {
  return { type: "rect", x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1]) };
}

/**
 * Snaps to whole pixels of the item (freehand is untouched). A rectangle's width and height are rounded separately, so its size
 * doesn't wobble while moving. Every result of moving or dragging a handle goes through here: saving trims decimals later (core's
 * roundShape, digits chosen by the side length), and reading back rounds to the same integer, so stepping with arrow keys doesn't
 * drift (without snapping each save loses a little, and 25 presses are off by 1 pixel)
 */
function snapShape(s: Shape, w: number, h: number): Shape {
  const sx = (v: number) => Math.round(v * w) / w;
  const sy = (v: number) => Math.round(v * h) / h;
  switch (s.type) {
    case "rect":
      return keepColor(s, { type: "rect", x: sx(s.x), y: sy(s.y), w: sx(s.w), h: sy(s.h) });
    case "point":
      return keepColor(s, { type: "point", x: sx(s.x), y: sy(s.y) });
    case "arrow":
      return keepColor(s, { type: "arrow", from: [sx(s.from[0]), sy(s.from[1])], to: [sx(s.to[0]), sy(s.to[1])] });
    case "path":
      return s;
  }
}

/**
 * Hit range of a line: its width on screen (with the Select tool an invisible thick stroke sits under the line; right-click lookup by
 * position uses the same width)
 */
const HIT_WIDTH = 14;

/** A mark that was hit: which note (id) and which place (part); without an id it is on the note being written */
export interface MarkHit {
  id?: string;
  part: number;
}

const hitOf = (el: Element): MarkHit => {
  const draft = el.getAttribute("data-draft-part");
  return draft !== null
    ? { part: Number(draft) }
    : { id: el.getAttribute("data-id") ?? "", part: Number(el.getAttribute("data-part") ?? 0) };
};

/**
 * Which place of which note lies under this screen point (used by the canvas context menu); layer is the .annot-layer on the canvas,
 * draft holds the places already drawn for the note being written. With a drawing tool or the Hand the mark layer doesn't take the
 * mouse and a DOM lookup only finds the numbers, so this is computed by position: numbers and pins by bounding box, lines by screen
 * distance (as with the Select tool; a selected rectangle and the one being written count as a whole); later drawn ones are on top
 */
export function markAt(
  layer: Element,
  x: number,
  y: number,
  find: (id: string) => Annotation | undefined,
  selectedId?: string,
  draft?: readonly Shape[],
): MarkHit | undefined {
  const inBox = (el: Element) => {
    const b = el.getBoundingClientRect();
    return x >= b.left && x <= b.right && y >= b.top && y <= b.bottom;
  };
  const badge = [...layer.querySelectorAll(".annot-badge[data-id], .annot-badge[data-draft-part]")].findLast(inBox);
  if (badge) return hitOf(badge);
  const r = layer.getBoundingClientRect();
  if (!r.width || !r.height) return undefined;
  const p: Pt = [(x - r.left) / r.width, (y - r.top) / r.height];
  return [...layer.querySelectorAll(".annot-shape[data-id], .annot-shape[data-draft-part]")].map(hitOf).findLast((hit) => {
    const a = hit.id === undefined ? undefined : find(hit.id);
    const s = hit.id === undefined ? draft?.[hit.part] : a && shapesOf(a)[hit.part];
    return !!s && shapeHit(s, p, r.width, r.height, HIT_WIDTH / 2, hit.id === undefined || hit.id === selectedId);
  });
}

/** Line width in screen px (see the top of the file: multiplied by --inv-zoom to cancel the canvas zoom) */
function screenWidth(px: number) {
  return `calc(${px}px * var(--inv-zoom, 1))`;
}

/** SVG string for the preview while dragging (drawn the same way as ShapeView) */
function shapeMarkup(s: Shape, w: number, h: number, color: string, width: number): string {
  let geo: string;
  switch (s.type) {
    case "rect":
      geo = `<rect x="${s.x * w}" y="${s.y * h}" width="${s.w * w}" height="${s.h * h}"`;
      break;
    case "arrow":
      geo = `<line x1="${s.from[0] * w}" y1="${s.from[1] * h}" x2="${s.to[0] * w}" y2="${s.to[1] * h}"`;
      break;
    case "path":
      geo = `<polyline points="${s.points.map(([x, y]) => `${x * w},${y * h}`).join(" ")}"`;
      break;
    default:
      return "";
  }
  // A rectangle is dashed while dragging; the casing follows the same dashes, so every dash has a 1-wide casing around it
  const dash = s.type === "rect" ? `; stroke-dasharray: ${screenWidth(6)} ${screenWidth(4)}` : "";
  const line = `fill="none" stroke-linecap="round" stroke-linejoin="round"`;
  return (
    `${geo} ${line} style="stroke: var(--casing); stroke-width: ${screenWidth(width + 2)}${dash}"/>` +
    `${geo} ${line} stroke="${color}" style="stroke-width: ${screenWidth(width)}${dash}"/>`
  );
}

/** Where the number goes: top-left of a rectangle, start of an arrow, first point of a freehand stroke, the point itself */
function labelPoint(s?: Shape): Pt | undefined {
  if (!s) return undefined;
  switch (s.type) {
    case "rect":
      return [s.x, s.y];
    case "point":
      return [s.x, s.y];
    case "arrow":
      return s.from;
    case "path":
      return s.points[0];
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const clamp01 = (v: number) => clamp(v, 0, 1);

/** Moved under 4 screen pixels between press and release: it is a single click (same drag distance as ZoomView) */
const isClick = (down: { x: number; y: number }, up: { clientX: number; clientY: number }) =>
  Math.hypot(up.clientX - down.x, up.clientY - down.y) < 4;
