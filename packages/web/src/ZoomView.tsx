import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useIntl } from "react-intl";
import { CheckIcon, ChevronIcon, MinusIcon, PlusIcon } from "./icons";
import { useKeys } from "./keys";
import { Menu } from "./Menu";
import { handHold } from "./pan";
import { usePrefs } from "./prefs";

const MIN_SCALE = 0.05;
const MAX_SCALE = 32;

/** fit shows everything; fill covers the viewport and crops the excess (draggable); free means the user zoomed it. The first two follow the window size */
type Mode = "fit" | "fill" | "free";

/**
 * A layer that covers the whole canvas area and does not zoom with it. The note layer puts its drawing-input layer here,
 * so a stroke can start in the blank area outside the picture too (rectangles and arrows dragged in from outside)
 */
export const ZoomOverlay = createContext<HTMLDivElement | null>(null);

/**
 * The moment the note layer last started a stroke on the canvas: a click right after placing a pin or drawing a rectangle that forms a double-click is not a zoom (by the second click the drawing layer has yielded to the composer).
 * Never drawn = -Infinity: 0 would be wrong because performance.now() counts from page load, so double-clicks in the first 0.6 seconds after load would never zoom
 */
export const drawGuard = { at: -Infinity };

/**
 * With the Select tool, a left-button drag on blank canvas (not pressed on a mark): hand it to the note layer to draw a rectangle instead of panning (Select is the default tool, and a beginner dragging on the image would otherwise see nothing happen).
 * The note layer attaches its handler here while it can draw; when not attached (Hand tool, a note being written, read-only) or while H is held, it pans as usual
 */
export interface BlankDrag {
  /** The start point is where the press happened (screen coordinates) */
  start: (x: number, y: number) => void;
  move: (x: number, y: number) => void;
  end: (x: number, y: number) => void;
  /** Not dragged, just a click (screen coordinates): returns true when the note layer took it (it hit a mark of the note being written), so the canvas no longer treats it as a click on blank space */
  click?: (x: number, y: number) => boolean;
  /** Moving over the canvas with no button held: the note layer checks whether the pointer is on a clickable mark and adds / removes is-over-mark (hand cursor) on el (the canvas area) */
  hover?: (el: Element, x: number, y: number) => void;
}
export const ZoomBlankDrag = createContext<{ current?: BlankDrag }>({});

/** Extra content at the far left of the zoom bar (given by Workspace: the switch that shows / hides canvas marks). Images and videos both go through ZoomView, so it need not be passed down level by level */
export const ZoomExtras = createContext<ReactNode>(null);

/**
 * The zoomable, pannable canvas area, shared by images and videos.
 * Defaults to "fit to window" (follows the window size); zooming and panning set transform directly, not through React state, so dragging does not drop frames.
 */
export function ZoomView(props: {
  /** The item's original pixel size; not shown until it is known */
  size?: { w: number; h: number };
  children: ReactNode;
  /** Called on a click (no drag); video uses it to play / pause */
  onClick?: () => void;
  /** Called before a double-click zoom: video uses it to undo the play / pause toggled by the two single clicks within the double-click */
  onDoubleClick?: () => void;
  /** The space left around the picture in "fit to window". 16 = the canvas column's content line (toolbar icons and the zoom bar's frame edge are all at 16); video already has 16 of padding outside, so pass 0 */
  margin?: number;
  /**
   * How many pixels of size make one pixel of the original (mediaSize.ts): an SVG is drawn enlarged, and a large shell-converted image is scaled down. Zoom ratios are stated in terms of the original ("100%" is the original 1:1),
   * 1 when not given
   */
  unit?: number;
  /** Vector image: enlarging does not break it into visible pixels; once zooming stops it is redrawn at the current ratio, so it stays sharp */
  vector?: boolean;
}) {
  const intl = useIntl();
  const { size, margin = 16 } = props;
  const unit = useRef(1);
  unit.current = props.unit ?? 1;
  const vector = useRef(false);
  vector.current = !!props.vector;
  const settle = useRef(0);
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const view = useRef({ scale: 1, x: 0, y: 0, mode: "fit" as Mode });
  const [overlay, setOverlay] = useState<HTMLDivElement | null>(null);
  const [label, setLabel] = useState<string>("fit");
  const { prefs, setPrefs } = usePrefs();
  const extras = useContext(ZoomExtras);

  // Interface size (the CSS zoom on html): this layer cancels it, so the item is shown in screen pixels and "100%" is 1:1;
  // positions and sizes here are all computed in screen pixels (getBoundingClientRect, clientX). Without the cancellation, at 125% interface size the right side of a "fit to window" picture was cropped
  const ui = useRef(prefs.uiScale);
  ui.current = prefs.uiScale;
  const apply = useCallback(() => {
    const v = view.current;
    if (content.current) {
      content.current.style.zoom = String(1 / ui.current);
      content.current.style.transform = `translate(${v.x}px, ${v.y}px) scale(${v.scale})`;
      // Badges, pins, arrowheads and line widths in the note layer do not scale with the picture; this inverse scale keeps them constant. Multiplied by the interface size: they are part of the interface and follow it
      content.current.style.setProperty("--inv-zoom", String(ui.current / v.scale));
      // Once one item pixel covers 3 or more screen pixels, do not interpolate: smooth interpolation blurs the edges between pixels, while below that smoothing looks better. Vector images have no pixel grid
      content.current.classList.toggle("is-pixelated", !vector.current && v.scale * window.devicePixelRatio >= 3);
      // Vector image: while zooming or dragging, the whole layer moves as a picture (will-change, follows the hand); 200 ms after stopping it is removed and redrawn at the current ratio, so enlarging stays sharp
      if (vector.current) {
        content.current.style.willChange = "transform";
        clearTimeout(settle.current);
        settle.current = window.setTimeout(() => {
          if (content.current) content.current.style.willChange = "auto";
        }, 200);
      } else content.current.style.willChange = "";
    }
  }, []);
  useEffect(() => () => clearTimeout(settle.current), []);
  /** The zoom-in limit (as a ratio of size): MAX_SCALE times the original; images drawn enlarged (unit > 1) are not pushed down */
  const maxScale = () => MAX_SCALE / Math.min(1, unit.current);

  const showLabel = useCallback(() => {
    const v = view.current;
    setLabel(v.mode === "fit" || v.mode === "fill" ? v.mode : `${Math.round(v.scale * unit.current * 100)}%`);
  }, []);

  const box = () => {
    const r = viewport.current!.getBoundingClientRect();
    return { w: r.width, h: r.height, left: r.left, top: r.top };
  };

  /** The fit-to-window ratio. Not bound by the 5% lower limit: a very wide or very long image (20,000 × 500) needs less than 5% to fit, and otherwise its right side was cropped while still labeled "fit" */
  const fitScale = useCallback(() => {
    if (!size || !viewport.current) return 1;
    const b = viewport.current.getBoundingClientRect();
    return Math.min((b.width - margin * 2) / size.w, (b.height - margin * 2) / size.h);
  }, [size, margin]);

  /** The ratio that covers the viewport (no margin) */
  const fillScale = useCallback(() => {
    if (!size || !viewport.current) return 1;
    const b = viewport.current.getBoundingClientRect();
    return Math.min(maxScale(), Math.max(MIN_SCALE / unit.current, b.width / size.w, b.height / size.h));
  }, [size]);

  /** In a direction where the picture is smaller than the viewport, center it (rounded: the top-left edge lands on whole pixels so the picture's thin edge is not blurry); in a direction where it is larger, do not allow dragging out blank space */
  const clamp = useCallback(() => {
    if (!size || !viewport.current) return;
    const v = view.current;
    const b = viewport.current.getBoundingClientRect();
    const w = size.w * v.scale;
    const h = size.h * v.scale;
    v.x = w <= b.width ? Math.round((b.width - w) / 2) : Math.min(0, Math.max(b.width - w, v.x));
    v.y = h <= b.height ? Math.round((b.height - h) / 2) : Math.min(0, Math.max(b.height - h, v.y));
  }, [size]);

  const fit = useCallback(() => {
    const v = view.current;
    v.scale = fitScale();
    v.mode = "fit";
    clamp();
    apply();
    showLabel();
  }, [fitScale, clamp, apply, showLabel]);

  /** Fill the window, starting with the center of the picture */
  const fill = useCallback(() => {
    if (!size || !viewport.current) return;
    const v = view.current;
    const b = viewport.current.getBoundingClientRect();
    v.scale = fillScale();
    v.mode = "fill";
    v.x = (b.width - size.w * v.scale) / 2;
    v.y = (b.height - size.h * v.scale) / 2;
    clamp();
    apply();
    showLabel();
  }, [size, fillScale, clamp, apply, showLabel]);

  /** Zoom to scale; (cx, cy) is the point inside the viewport that stays fixed */
  const zoomTo = useCallback(
    (scale: number, cx?: number, cy?: number) => {
      if (!size || !viewport.current) return;
      const v = view.current;
      const b = viewport.current.getBoundingClientRect();
      // The lower limit is normally 5%; for an image whose fit-to-window ratio is even smaller, the minimum is the fit-to-window ratio (otherwise zooming out at fit would actually enlarge it). Both limits are in terms of the original (unit);
      // the upper limit of a vector image drawn enlarged is not pushed down (it is already sharp, and you enlarge it to see detail)
      const ns = Math.min(maxScale(), Math.max(Math.min(MIN_SCALE / unit.current, fitScale()), scale));
      const px = cx ?? b.width / 2;
      const py = cy ?? b.height / 2;
      v.x = px - ((px - v.x) * ns) / v.scale;
      v.y = py - ((py - v.y) * ns) / v.scale;
      v.scale = ns;
      v.mode = "free";
      clamp();
      apply();
      showLabel();
    },
    [size, fitScale, clamp, apply, showLabel],
  );

  const zoomBy = (factor: number) => zoomTo(view.current.scale * factor);
  /** A ratio stated in terms of the original (1 = original 1:1) */
  const zoomToActual = (s: number, cx?: number, cy?: number) => zoomTo(s / unit.current, cx, cy);

  // Fit to window as soon as the size is known. When the window changes: fit mode refits; fill mode refills, keeping the point at the center of the picture fixed;
  // a picture the user zoomed only has its position corrected
  useLayoutEffect(() => {
    if (size) fit();
  }, [size, fit]);
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    let last = el.getBoundingClientRect();
    const ro = new ResizeObserver(() => {
      const b = el.getBoundingClientRect();
      const v = view.current;
      if (v.mode === "fit") fit();
      else {
        if (v.mode === "fill") {
          const cx = (last.width / 2 - v.x) / v.scale;
          const cy = (last.height / 2 - v.y) / v.scale;
          v.scale = fillScale();
          v.x = b.width / 2 - cx * v.scale;
          v.y = b.height / 2 - cy * v.scale;
        }
        clamp();
        apply();
      }
      last = b;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit, fillScale, clamp, apply]);
  // The interface size changed: this layer cancels it again; fit mode refits
  useEffect(() => {
    if (!size) return;
    if (view.current.mode === "fit") fit();
    else {
      clamp();
      apply();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefs.uiScale]);

  // Ctrl+wheel (including trackpad pinch) zooms; after zooming in or filling, the plain wheel pans
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const b = box();
      if (e.ctrlKey) {
        zoomTo(view.current.scale * Math.exp(-e.deltaY * 0.0025), e.clientX - b.left, e.clientY - b.top);
      } else if (view.current.mode !== "fit") {
        const v = view.current;
        // Shift+wheel pans sideways: on Windows the browser has usually already turned it into a horizontal scroll amount (deltaX); deltaY is used only when it has not.
        // When nothing overflows vertically (a wide picture filling the area) the plain wheel also pans sideways, otherwise scrolling would do nothing; trackpads that send a horizontal amount work as usual
        const sideways = e.shiftKey || (!e.deltaX && !!size && size.h * v.scale <= b.h);
        v.x -= sideways ? e.deltaX || e.deltaY : e.deltaX;
        v.y -= sideways ? 0 : e.deltaY;
        clamp();
        apply();
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomTo, clamp, apply, size]);

  // Drag to pan (with the Select tool a left-button drag draws a rectangle, see BlankDrag); no drag counts as a click
  const blank = useRef<BlankDrag | undefined>(undefined);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; left: boolean; moved: boolean; drawing: boolean }>(undefined);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.classList.remove("is-over-mark");
    drag.current = {
      x: e.clientX,
      y: e.clientY,
      vx: view.current.x,
      vy: view.current.y,
      left: e.button === 0,
      moved: false,
      drawing: false,
    };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) {
      if (blank.current?.hover && !handHold.held) blank.current.hover(e.currentTarget, e.clientX, e.clientY);
      else e.currentTarget.classList.remove("is-over-mark");
      return;
    }
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    if (!d.moved && d.left && !handHold.held && blank.current) {
      d.drawing = true;
      blank.current.start(d.x, d.y);
    }
    d.moved = true;
    if (d.drawing) return blank.current?.move(e.clientX, e.clientY);
    if (handHold.held) handHold.panned = true;
    viewport.current!.classList.add("is-panning");
    const v = view.current;
    v.x = d.vx + dx;
    v.y = d.vy + dy;
    clamp();
    apply();
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = undefined;
    viewport.current!.classList.remove("is-panning");
    if (d?.drawing) return blank.current?.end(e.clientX, e.clientY);
    if (d && !d.moved && e.button === 0 && !handHold.held && blank.current?.click?.(e.clientX, e.clientY)) return;
    if (d && !d.moved && e.button === 0) props.onClick?.();
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    // With a drawing tool, a double-click on a mark is not a zoom: placing pins quickly would first drop a pin and then zoom to 100%; double-clicking a mark edits it.
    // The two single clicks of those double-clicks never went through the canvas (the marks and the drawing layer took them), so there is nothing to undo: decide first, then notify the video,
    // otherwise after pausing with a click on blank space and immediately double-clicking a mark, the video would resume as it was before that click
    if ((e.target as Element).closest(".annot-input, .annot-badge, .annot-shape, .annot-handle")) return;
    if (performance.now() - drawGuard.at < 600) return;
    props.onDoubleClick?.();
    const b = box();
    if (view.current.mode === "free") fit();
    else zoomToActual(1, e.clientX - b.left, e.clientY - b.top);
  };

  useKeys({
    "Shift+1": fit,
    "Ctrl+0": fit,
    "Shift+2": fill,
    "Shift+0": () => zoomToActual(1),
    "Ctrl+=": () => zoomBy(1.25),
    "Ctrl++": () => zoomBy(1.25),
    "Ctrl+-": () => zoomBy(0.8),
  });

  return (
    <div
      className="zoom-view"
      ref={viewport}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
    >
      <div className={`zoom-content${size ? " is-ready" : ""}`} ref={content} style={size ? { width: size.w, height: size.h } : undefined}>
        <ZoomOverlay.Provider value={overlay}>
          <ZoomBlankDrag.Provider value={blank}>{props.children}</ZoomBlankDrag.Provider>
        </ZoomOverlay.Provider>
      </div>
      <div className="zoom-overlay" ref={setOverlay} />
      <div className="zoom-control" onPointerDown={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        {extras && (
          <>
            {extras}
            <span className="zoom-sep" />
          </>
        )}
        <button className="zoom-btn" onClick={() => zoomBy(0.8)} title={intl.formatMessage({ id: "zoom.out" })}>
          <MinusIcon />
        </button>
        <Menu
          up
          anchorClosest=".zoom-control"
          buttonClass="zoom-label"
          title={intl.formatMessage({ id: "zoom.title" })}
          trigger={() => (
            <>
              {label === "fit" || label === "fill" ? intl.formatMessage({ id: `zoom.${label}` }) : label}
              <ChevronIcon />
            </>
          )}
          items={[
            { label: intl.formatMessage({ id: "menu.view.fit" }), hint: "Shift 1", icon: label === "fit" && <CheckIcon />, onClick: fit },
            {
              label: intl.formatMessage({ id: "menu.view.fill" }),
              hint: "Shift 2",
              icon: label === "fill" && <CheckIcon />,
              onClick: fill,
            },
            "-",
            ...[0.5, 1, 2].map((s) => ({
              label: `${s * 100}%`,
              hint: s === 1 ? "Shift 0" : undefined,
              icon: label === `${s * 100}%` && <CheckIcon />,
              onClick: () => zoomToActual(s),
            })),
            "-",
            {
              label: intl.formatMessage({ id: "menu.view.blur" }),
              icon: prefs.backdrop === "blur" && <CheckIcon />,
              onClick: () => setPrefs({ backdrop: prefs.backdrop === "blur" ? "plain" : "blur" }),
            },
          ]}
        />
        <button className="zoom-btn" onClick={() => zoomBy(1.25)} title={intl.formatMessage({ id: "zoom.in" })}>
          <PlusIcon />
        </button>
      </div>
    </div>
  );
}
