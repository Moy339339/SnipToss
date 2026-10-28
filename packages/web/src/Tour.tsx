import { useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useIntl } from "react-intl";
import { cssZoom } from "./cssZoom";
import { useKeys } from "./keys";
import { useDialogFocus } from "./Menu";
import { placeNear, TOUR_STEPS, visibleBox, type TourStep } from "./onboarding";

/** The highlight box is 4 larger than the target on every side; the card is 12 from the highlight and 8 from the window edge (all scale with the interface size) */
const PAD = 4;
const GAP = 12;
const EDGE = 8;

/**
 * The onboarding tour (onboarding.ts): the rest of the UI is dimmed, one spot is highlighted with a card beside it, and "Next" walks through it. Only 3 steps (a first-run flow must be short).
 * The steps to take are fixed on open: targets that are not visible (notes panel collapsed) are skipped. The position is measured against the target every frame,
 * so window resizing and panels collapsing or expanding need no extra notification.
 * Keyboard is the same as in dialogs (design-rules: dialog keyboard handling is the same everywhere): focus is on "Next", Tab cycles only within the card, Esc skips; → / ← change steps.
 * A click on the dimmed area does not close it (a hasty click on the canvas should not lose the tour); it closes only through "Skip", "Done" and Esc
 */
export function Tour(props: { captureKeys: string; onClose: () => void }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const [steps] = useState<TourStep[]>(() => TOUR_STEPS.filter((s) => visibleBox(s.target)));
  const [i, setI] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const hole = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const bodyId = useId();
  const step = steps[i];
  const last = i === steps.length - 1;

  const close = useEffectEvent(() => props.onClose());
  const next = () => (last ? props.onClose() : setI(i + 1));
  const back = () => i > 0 && setI(i - 1);
  const tab = useDialogFocus(box, () => primary.current);
  useKeys({ Escape: props.onClose, ArrowRight: next, ArrowLeft: back, Tab: tab, "Shift+Tab": tab }, { modal: true });

  /** The highlight box wraps the target and the card goes beside it (target gone: no highlight, the card goes in the window center) */
  const place = useEffectEvent(() => {
    const card = box.current;
    const ring = hole.current;
    if (!card || !ring || !step) return;
    const z = cssZoom();
    const r = visibleBox(step.target);
    const area = { left: EDGE * z, top: EDGE * z, right: innerWidth - EDGE * z, bottom: innerHeight - EDGE * z };
    const size = { w: card.offsetWidth * z, h: card.offsetHeight * z };
    let at: { x: number; y: number };
    if (r) {
      const pad = PAD * z;
      const target = { left: r.left - pad, top: r.top - pad, right: r.right + pad, bottom: r.bottom + pad };
      ring.style.left = `${Math.round(target.left / z)}px`;
      ring.style.top = `${Math.round(target.top / z)}px`;
      ring.style.width = `${Math.round((target.right - target.left) / z)}px`;
      ring.style.height = `${Math.round((target.bottom - target.top) / z)}px`;
      ring.style.visibility = "";
      at = placeNear(target, size, area, GAP * z, ["below", "above", "left", "right"]);
    } else {
      ring.style.visibility = "hidden";
      at = { x: Math.round((innerWidth - size.w) / 2), y: Math.round((innerHeight - size.h) / 2) };
    }
    card.style.left = `${Math.round(at.x / z)}px`;
    card.style.top = `${Math.round(at.y / z)}px`;
    card.style.visibility = "";
  });
  // Place it before the first paint (no flash in the top-left corner); after a step change the per-frame placement below takes over
  useLayoutEffect(() => {
    if (steps.length === 0) close();
    else place();
  }, [steps.length]);
  useEffect(() => {
    let frame = 0;
    let count = 0;
    const tick = () => {
      place();
      // Add the step-change transition only after placing (the first time it does not slide in from the top-left)
      if (++count === 2) for (const el of [hole.current, box.current]) el?.setAttribute("data-ready", "");
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!step) return null;
  // Do not break the shortcut in the middle ("Ctrl Alt" / "A"): use non-breaking spaces between key names
  const keys = props.captureKeys.replaceAll(" ", "\u00a0");
  const body = step.id === "capture" ? (keys ? t("tour.capture.body", { keys }) : t("tour.capture.bodyNoKey")) : t(`tour.${step.id}.body`);
  return createPortal(
    // One layer over the whole window: blocks the mouse from reaching what is behind (the dimming comes from the highlight box's outer shadow)
    <div className="tour" data-step={step.id} onPointerDown={(e) => e.preventDefault()} onContextMenu={(e) => e.preventDefault()}>
      <div ref={hole} className="tour-hole" style={{ visibility: "hidden" }} />
      <div
        ref={box}
        className="tour-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        style={{ visibility: "hidden" }}
      >
        <div className="tour-head">
          <div className="tour-title" id={titleId}>
            {t(`tour.${step.id}.title`)}
          </div>
          <div className="tour-count">{t("tour.count", { n: i + 1, total: steps.length })}</div>
        </div>
        <div className="tour-body" id={bodyId}>
          {body}
        </div>
        <div className="tour-actions">
          {!last && (
            <button className="btn btn-ghost tour-skip" onClick={props.onClose} title={t("tour.skipTitle")}>
              {t("tour.skip")}
            </button>
          )}
          {i > 0 && (
            <button className="btn btn-secondary" onClick={back}>
              {t("tour.back")}
            </button>
          )}
          {/* A fresh button per step that takes focus itself: "Back" disappears on returning to the first step, and focus does not fall to body */}
          <button key={i} ref={primary} className="btn btn-primary" onClick={next} autoFocus>
            {t(last ? "tour.done" : "tour.next")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
