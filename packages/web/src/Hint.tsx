import { useEffect, useEffectEvent, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useIntl } from "react-intl";
import { cssZoom } from "./cssZoom";
import { call, logError } from "./host";
import { useKeys } from "./keys";
import { HINT_TARGETS, placeNear, visibleBox, type HintId } from "./onboarding";

/** 8 from the control and 8 from the window edge (scaled with the interface size) */
const GAP = 8;
const EDGE = 8;
/** The little caret stays at least this far from the left and right edges of the hint (so it doesn't hit the rounded corners) */
const CARET_INSET = 16;

/**
 * Which side of the control the hint goes on: the copy button is at the very bottom of the notes panel, so above; timestamped comment is
 * in the toolbar, and Capture in the title bar, so below
 */
const SIDES: Record<HintId, ("below" | "above")[]> = {
  copy: ["above", "below"],
  video: ["below", "above"],
  screenAccess: ["below", "above"],
};

/**
 * A hint shown once next to a feature the first time it is used (onboarding.ts). No dimming, no focus stealing, no blocking:
 * a press elsewhere (which goes through as usual), Esc and "OK" all dismiss it; it also goes away when the control disappears
 * (notes panel collapsed, item switched). The little caret points at the middle of the control. Screen readers announce it (role="status")
 */
export function Hint(props: { id: HintId; onClose: () => void }) {
  const intl = useIntl();
  const el = useRef<HTMLDivElement>(null);
  const close = useEffectEvent(() => props.onClose());

  /** Position it; returns false when the control is gone */
  const place = useEffectEvent(() => {
    const box = el.current;
    const r = visibleBox(HINT_TARGETS[props.id]);
    if (!box) return true;
    if (!r) return false;
    const z = cssZoom();
    const area = { left: EDGE * z, top: EDGE * z, right: innerWidth - EDGE * z, bottom: innerHeight - EDGE * z };
    const size = { w: box.offsetWidth * z, h: box.offsetHeight * z };
    const at = placeNear(r, size, area, GAP * z, SIDES[props.id]);
    const caret = Math.max(CARET_INSET * z, Math.min((r.left + r.right) / 2 - at.x, size.w - CARET_INSET * z));
    box.style.left = `${Math.round(at.x / z)}px`;
    box.style.top = `${Math.round(at.y / z)}px`;
    box.style.setProperty("--caret-x", `${Math.round(caret / z)}px`);
    box.dataset.side = at.side;
    box.style.visibility = "";
    return true;
  });
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

  // A press elsewhere dismisses it, and the press still reaches its target as usual (same as the color row after hitting a mark)
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!el.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
  }, []);
  useKeys({ Escape: () => props.onClose() }, { first: true });

  return createPortal(
    <div ref={el} className="hint" role="status" data-hint={props.id} style={{ visibility: "hidden" }}>
      <div className="hint-text">{intl.formatMessage({ id: `hint.${props.id}` }, { app: intl.formatMessage({ id: "brand.name" }) })}</div>
      <div className="hint-actions">
        <button className="btn btn-secondary btn-small" onClick={props.onClose}>
          {intl.formatMessage({ id: "app.toast.gotIt" })}
        </button>
        {props.id === "screenAccess" && (
          // To where macOS lets the app record the screen (the shell lets the system ask the first time, see host-api.md)
          <button
            className="btn btn-primary btn-small"
            onClick={() => {
              void call("openScreenAccessSettings").catch((e) => logError("openScreenAccessSettings", e));
              props.onClose();
            }}
          >
            {intl.formatMessage({ id: "settings.capture.openAccess" })}
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
