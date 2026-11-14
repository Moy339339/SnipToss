import { MARK_COLORS } from "@sniptoss/core";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { useIntl } from "react-intl";
import { cssZoom } from "./cssZoom";
import { Demo } from "./Demo";
import { KeepPunctuation } from "./KeepPunctuation";
import { GUIDE_STEPS, SAMPLE_BOX, placeNear, visibleBox, type GuideState, type Side } from "./onboarding";

/** The lit area is this much larger than the control it holds on every side; the card is this far from the window's edges and from what it explains; its caret stays this far from its corners (all scale with the interface size) */
const PAD = 4;
const EDGE = 16;
const GAP = 12;
const CARET_INSET = 20;
/** The zoom bar sits in the corner of the canvas area: its height and the gap above it */
const ZOOM_BAR = 32 + 8;
/**
 * What the toolbar step labels, in the toolbar's order: the marking tools, then Overall Comment. All of them are labeled at once: a line drops from each button to its label ("Name what it
 * does"), the labels in rows this far apart, the first this far under the toolbar. The labels go to the right of their lines and the
 * rightmost tool has the top row, so no line crosses a label
 */
const TOOLBAR = ["select", "hand", "point", "rect", "pen", "arrow", "whole"];
/** The button of each (Overall Comment is not a tool button) and its name */
const buttonOf = (item: string) => (item === "whole" ? ".hdr-tools .tool-whole" : `.hdr-tools .tool-btn[data-tool="${item}"]`);
const nameOf = (item: string) => (item === "whole" ? "header.whole" : `tool.${item}`);
const LEGEND_GAP = 8;
const LEGEND_ROW = 28;
/** What a step is done on (the picture of "mark" is found in areaOf) */
const TARGETS: Partial<Record<GuideState, string>> = {
  tool: '.hdr-tools .tool-btn[data-tool="rect"]',
  write: ".composer",
  copy: ".panel-dock .dock-buttons",
  tools: ".hdr-tools",
};
/** Which side of what it explains the card goes on, in order of preference */
const SIDES: Record<GuideState, Side[]> = {
  tool: ["below"],
  mark: ["below", "right", "above", "left"],
  write: ["right", "left", "below", "above"],
  copy: ["above", "left"],
  done: [],
  tools: ["below"],
};
/** The confetti at the end: how many pieces, in the mark colors (not black and white) */
const CONFETTI = 28;
const CONFETTI_COLORS = MARK_COLORS.slice(0, 6);

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** What a step is done on, in screen pixels (not there or not visible: undefined) */
function areaOf(step: GuideState): { rect: Rect; pad: number; media?: DOMRect } | undefined {
  if (step === "mark") {
    const stage = document.querySelector(".stage")?.getBoundingClientRect();
    const media = (
      document.querySelector(".stage .zoom-content img, .stage .zoom-content video") ?? document.querySelector(".stage .zoom-view")
    )?.getBoundingClientRect();
    if (!stage || !media) return undefined;
    // The part of the picture that is in view (zoomed in, it is larger than the canvas area)
    const rect = {
      left: Math.max(media.left, stage.left),
      top: Math.max(media.top, stage.top),
      right: Math.min(media.right, stage.right),
      bottom: Math.min(media.bottom, stage.bottom),
    };
    return rect.right - rect.left >= 1 && rect.bottom - rect.top >= 1 ? { rect, pad: 0, media } : undefined;
  }
  // The end is about nothing on the screen: its card is in the middle
  const target = TARGETS[step];
  const r = target ? visibleBox(target) : undefined;
  return r && { rect: r, pad: PAD };
}

/**
 * The onboarding guide (onboarding.ts): a small window that plays an animation of the step to take (Demo.tsx) with one line under it.
 * It follows the steps around: it sits beside what the step is about, with a caret pointing at it (under the tool button, beside the
 * place to drag, beside the composer, over the copy buttons), and slides there when the step changes; with nothing to sit beside, it
 * goes in the corner of the canvas area.
 * The numbered steps are done by doing: picking the rectangle tool, marking a place, writing the note and copying each move it on
 * (onboarding.ts decides); "Next" on them does the step for the user (Workspace: picks the tool, boxes the sample's headline, saves a
 * sample sentence or what was typed, copies as text), so the rest of the guide still has its mark, note and copy ("Skip" closes the guide).
 * Between writing and copying it shows the toolbar with everything on it labeled at once (what it does, on a line from its button):
 * the marking tools and Overall Comment. That card has no words of its own; the labels say it.
 * Copying ends it, all within the app (nobody is sent elsewhere to paste): the last card, in the middle of the dimmed window, says it
 * is done with a small burst of confetti, and its one button starts the real work (on the sample, Workspace then takes the sample off
 * the list).
 * A first-time user is kept on the path: only what the step is done on stays lit and usable (one tool button, the picture, the composer,
 * the copy buttons); the rest is dimmed and takes no presses, and the menus in the title bar are off
 * (html[data-guided]). The title bar itself is left alone (the window can still be moved and closed), and so is the keyboard.
 * On the sample picture the marking step shows where to drag (a dashed box). The card sits right beside what to press, with its caret
 * on it and the animation showing the press, so nothing else points at it, and a step's card holds just its title: only copying adds a
 * sentence (which copy suits which AI).
 * The step that only explains (the toolbar) must not look like something to press: the ring holds still, and what it lights
 * takes no presses either ("Done" is the one thing to press).
 * While the guide is on, hover tooltips are off (html[data-guide]): the guide is what explains, and a tooltip on the lit control
 * would cover its card.
 * With nothing to light (notes panel collapsed), nothing is dimmed.
 * Everything is placed against the real controls every frame, so resizing and dragging panels need no notification
 */
export function Guide(props: { step: GuideState; sample: boolean; onNext: () => void; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const card = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const drag = useRef<HTMLDivElement>(null);
  const legend = useRef<(HTMLDivElement | null)[]>([]);
  const cover = useRef<HTMLDivElement>(null);
  const shades = useRef<(HTMLDivElement | null)[]>([]);
  const titleId = useId();
  const { step, sample } = props;
  const i = GUIDE_STEPS.indexOf(step as (typeof GUIDE_STEPS)[number]);
  /** A numbered step: done by doing (or by "Next", which does it) */
  const doing = i >= 0;
  const last = step === "done";

  useEffect(() => {
    let frame = 0;
    let placed = 0;
    const px = (n: number) => `${Math.round(n)}px`;
    const explains = step === "tools";
    const around = ring.current;
    const box = (el: HTMLElement | null, r: Rect | undefined, z: number) => {
      if (!el) return;
      el.style.visibility = r && r.right > r.left && r.bottom > r.top ? "" : "hidden";
      if (!r) return;
      Object.assign(el.style, {
        left: px(r.left / z),
        top: px(r.top / z),
        width: px((r.right - r.left) / z),
        height: px((r.bottom - r.top) / z),
      });
    };
    const grown = (r: Rect, by: number): Rect => ({ left: r.left - by, top: r.top - by, right: r.right + by, bottom: r.bottom + by });
    const tick = () => {
      const z = cssZoom();
      // What stays lit, and the four shades that cover the rest below the title bar (at the end, one covers it all)
      const area = areaOf(step);
      const end = step === "done";
      const lit = area ? grown(area.rect, area.pad * z) : undefined;
      document.documentElement.toggleAttribute("data-guided", !!lit || end);
      const top = document.querySelector(".titlebar")?.getBoundingClientRect().bottom ?? 0;
      const [above, below, before, behind] = shades.current;
      box(
        above,
        end
          ? { left: 0, top, right: innerWidth, bottom: innerHeight }
          : lit && { left: 0, top, right: innerWidth, bottom: Math.max(top, lit.top) },
        z,
      );
      box(below, lit && { left: 0, top: lit.bottom, right: innerWidth, bottom: innerHeight }, z);
      box(before, lit && { left: 0, top: Math.max(top, lit.top), right: lit.left, bottom: lit.bottom }, z);
      box(behind, lit && { left: lit.right, top: Math.max(top, lit.top), right: innerWidth, bottom: lit.bottom }, z);

      // A step that only explains: what it lights takes no presses
      box(cover.current, explains ? lit : undefined, z);

      // The toolbar: every tool that is in view gets its label (those folded away in a narrow window get none), and the ring goes
      // around all of them
      let spot: Rect | undefined;
      let rows = 0;
      if (step === "tools") {
        const boxes = TOOLBAR.map((item) => (lit ? visibleBox(buttonOf(item)) : undefined));
        rows = boxes.filter(Boolean).length;
        let row = rows;
        for (let k = 0; k < TOOLBAR.length; k++) {
          const b = boxes[k];
          const el = legend.current[k];
          if (el) el.style.visibility = b && lit ? "" : "hidden";
          if (!b || !lit) continue;
          row--;
          spot = spot
            ? {
                left: Math.min(spot.left, b.left),
                top: Math.min(spot.top, b.top),
                right: Math.max(spot.right, b.right),
                bottom: Math.max(spot.bottom, b.bottom),
              }
            : { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
          if (!el) continue;
          el.style.left = px((b.left + b.right) / 2 / z);
          el.style.top = px(lit.bottom / z);
          el.style.setProperty("--drop", `${LEGEND_GAP + row * LEGEND_ROW + LEGEND_ROW / 2}px`);
          el.style.setProperty("--n", String(row));
        }
      }
      box(around, step === "tools" ? spot && grown(spot, 2 * z) : lit, z);

      // Where to drag on the sample picture
      const m = step === "mark" && sample ? area?.media : undefined;
      const where = m && {
        left: m.left + m.width * SAMPLE_BOX.x,
        top: m.top + m.height * SAMPLE_BOX.y,
        right: m.left + m.width * (SAMPLE_BOX.x + SAMPLE_BOX.w),
        bottom: m.top + m.height * (SAMPLE_BOX.y + SAMPLE_BOX.h),
      };
      box(drag.current, where, z);

      // The card: beside what the step is about (clear of the labels that belong to it), its caret pointing there.
      // On a picture with no place shown to drag, and with nothing to sit beside: the bottom right corner of the canvas area, above
      // the zoom bar (and a video's playback bar)
      const el = card.current;
      const stage = document.querySelector(".stage")?.getBoundingClientRect();
      if (el && stage) {
        const beside: Rect | undefined =
          step === "mark"
            ? where
            : area &&
              (step === "tools"
                ? { ...grown(area.rect, area.pad * z), bottom: area.rect.bottom + (area.pad + LEGEND_GAP + rows * LEGEND_ROW) * z }
                : grown(area.rect, area.pad * z));
        const size = { w: el.offsetWidth * z, h: el.offsetHeight * z };
        let x: number;
        let y: number;
        if (beside) {
          const bounds = { left: EDGE * z, top: top + EDGE * z, right: innerWidth - EDGE * z, bottom: innerHeight - EDGE * z };
          const at = placeNear(beside, size, bounds, GAP * z, SIDES[step]);
          ({ x, y } = at);
          el.dataset.side = at.side;
          const along = (center: number, from: number, length: number) =>
            px(Math.max(CARET_INSET * z, Math.min(center - from, length - CARET_INSET * z)) / z);
          el.style.setProperty("--caret-x", along((beside.left + beside.right) / 2, x, size.w));
          el.style.setProperty("--caret-y", along((beside.top + beside.bottom) / 2, y, size.h));
        } else if (end) {
          // The end: in the middle of the window below the title bar
          x = (innerWidth - size.w) / 2;
          y = Math.max(top + EDGE * z, top + (innerHeight - top - size.h) / 2);
          delete el.dataset.side;
        } else {
          const bar = document.querySelector(".stage .transport")?.getBoundingClientRect().height ?? 0;
          x = Math.max(stage.left + EDGE * z, stage.right - EDGE * z - size.w);
          y = Math.max(stage.top + EDGE * z, stage.bottom - bar - (EDGE + ZOOM_BAR) * z - size.h);
          delete el.dataset.side;
        }
        el.style.left = px(x / z);
        el.style.top = px(y / z);
        el.style.visibility = "";
        // It slides to the next place when the step changes, but appears in place the first time
        if (++placed === 2) el.dataset.ready = "";
      }
      frame = requestAnimationFrame(tick);
    };
    document.documentElement.setAttribute("data-guide", "");
    tick();
    return () => {
      cancelAnimationFrame(frame);
      document.documentElement.removeAttribute("data-guide");
      document.documentElement.removeAttribute("data-guided");
    };
  }, [step, sample]);

  const hidden = { visibility: "hidden" } as const;
  return createPortal(
    // React events from a portal still bubble up the component tree: the guide sits inside the canvas area, whose right-click menu would
    // open from a right-click on a shade or the card. Nothing of the guide passes a right-click on (display: contents, so no box of its own)
    <div
      className="guide-layer"
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      {[0, 1, 2, 3].map((n) => (
        <div
          key={n}
          ref={(el) => {
            shades.current[n] = el;
          }}
          className="guide-shade"
          style={hidden}
          onPointerDown={(e) => e.preventDefault()}
          onContextMenu={(e) => e.preventDefault()}
        />
      ))}
      <div
        ref={cover}
        className="guide-shade guide-cover"
        style={hidden}
        onPointerDown={(e) => e.preventDefault()}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div ref={ring} className="guide-ring" data-step={step} style={hidden} />
      <div ref={drag} className="guide-drag" style={hidden} />
      {step === "tools" &&
        TOOLBAR.map((tool, k) => (
          <div
            key={tool}
            ref={(el) => {
              legend.current[k] = el;
            }}
            className="guide-callout"
            style={hidden}
          >
            <i />
            <span>
              <b>{t(nameOf(tool))}</b>
              {t(`guide.tools.${tool}`)}
            </span>
          </div>
        ))}
      <div ref={card} className="guide" role="dialog" data-step={step} aria-labelledby={titleId} style={hidden}>
        {/* Copying shows both ways (text to an AI in a terminal, images to one on the web): the Copy hint, which says the same, does not come after the guide */}
        {last ? <Finish /> : step !== "tools" && <Demo scene={step === "copy" ? "kinds" : step} />}
        <div className="guide-text" role="status">
          <div className="guide-head">
            <div className="guide-title" id={titleId}>
              {t(`guide.${step}.title`)}
            </div>
            {doing && <div className="guide-count">{t("tour.count", { n: i + 1, total: GUIDE_STEPS.length })}</div>}
          </div>
          {/* Only copying has a sentence: which of the two copies suits which AI is the one thing nothing on the screen says. The other
              steps are said by the animation, the lit control and the caret pointing at it (on the sample, the dashed box shows where to
              drag; the composer's Save carries its Enter key); the toolbar step by its labels; the end by its check */}
          {step === "copy" && (
            <div className="guide-body">
              <KeepPunctuation>{t("guide.copy.body")}</KeepPunctuation>
            </div>
          )}
        </div>
        <div className="guide-actions">
          {doing ? (
            <button className="btn btn-ghost btn-small" onClick={props.onClose}>
              {t("tour.skip")}
            </button>
          ) : (
            !last && <span />
          )}
          {/* On a numbered step this does the step for the user (Workspace), who watches it done; doing it oneself is what is lit */}
          <button className={`btn btn-small ${doing ? "btn-secondary" : "btn-primary"}`} onClick={props.onNext}>
            {t(last ? (sample ? "guide.done.start" : "tour.done") : "tour.next")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** The end of the guide: a check, and a small burst of confetti from it (just the check with "reduce motion") */
function Finish() {
  const burst = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = burst.current;
    if (!root || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const pieces = Array.from(root.children) as HTMLElement[];
    // Out in a fan upward, slowing down; then falling, turning and fading. After the card has slid into the middle
    const flying = pieces.map((piece, n) => {
      // A fan of 130° around straight up, so that falling back they stay above the words
      const angle = ((-90 + (n / (pieces.length - 1) - 0.5) * 130 + (Math.random() - 0.5) * 14) * Math.PI) / 180;
      const speed = 55 + Math.random() * 65;
      const dx = Math.cos(angle) * speed;
      const dy = Math.sin(angle) * speed;
      const spin = (Math.random() - 0.5) * 900;
      return piece.animate(
        [
          { transform: "translate(0, 0) rotate(0deg) scale(0.5)", opacity: 1, easing: "cubic-bezier(.1,.75,.35,1)" },
          {
            transform: `translate(${dx}px, ${dy}px) rotate(${spin / 3}deg) scale(1)`,
            opacity: 1,
            offset: 0.3,
            easing: "cubic-bezier(.45,0,.85,.55)",
          },
          { transform: `translate(${dx * 1.35}px, ${dy + 60}px) rotate(${spin}deg) scale(0.9)`, opacity: 0 },
        ],
        { duration: 1400 + Math.random() * 500, delay: 280, fill: "forwards" },
      );
    });
    return () => {
      for (const a of flying) a.cancel();
    };
  }, []);
  return (
    <div className="guide-finish" aria-hidden="true">
      <div ref={burst} className="guide-confetti">
        {Array.from({ length: CONFETTI }, (_, n) => (
          <i key={n} className={n % 3 === 0 ? "is-dot" : undefined} style={{ background: CONFETTI_COLORS[n % CONFETTI_COLORS.length] }} />
        ))}
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 12.5l4 4 8-9" />
      </svg>
    </div>
  );
}
