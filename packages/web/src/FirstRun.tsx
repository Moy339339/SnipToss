import { useEffect, useId, useRef } from "react";
import { useIntl } from "react-intl";
import { Demo } from "./Demo";
import { KeepPunctuation } from "./KeepPunctuation";
import { useKeys } from "./keys";
import { useDialogFocus } from "./Menu";

/**
 * The dialog on the very first launch (onboarding.ts): the animation of the whole loop, one prominent button that starts the tutorial
 * (the sample picture is added and the guide walks through it) and a quiet "Skip". A first-time user is led into the tutorial rather than
 * left to find it: a press on the backdrop does not close it, only the two buttons and Esc (= Skip) do.
 * It leaves the title bar uncovered: the window can be moved (to another display, say), minimized and closed while it is open.
 * Keyboard is the same as in every dialog: focus starts on the primary button and Tab stays inside
 */
export function FirstRun(props: { onStart: () => void; onSkip: () => void }) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const box = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const tab = useDialogFocus(box, () => primary.current);
  useKeys({ Escape: props.onSkip, Tab: tab, "Shift+Tab": tab }, { modal: true });
  const titleId = useId();
  const bodyId = useId();
  // The menus in the title bar are off while this is open (html[data-guided]), as during the guide
  useEffect(() => {
    document.documentElement.setAttribute("data-guided", "");
    return () => document.documentElement.removeAttribute("data-guided");
  }, []);
  return (
    <div className="overlay overlay-under-bar fade-in">
      <div ref={box} className="firstrun" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={bodyId}>
        <div className="firstrun-demo">
          <Demo scene="loop" />
        </div>
        <div className="firstrun-title" id={titleId}>
          {t("welcome.title")}
        </div>
        <div className="firstrun-body" id={bodyId}>
          <KeepPunctuation>{t("firstRun.body")}</KeepPunctuation>
        </div>
        <div className="firstrun-actions">
          <button className="btn btn-ghost" onClick={props.onSkip}>
            {t("tour.skip")}
          </button>
          <button ref={primary} className="btn btn-primary" onClick={props.onStart} autoFocus>
            {t("firstRun.start")}
          </button>
        </div>
      </div>
    </div>
  );
}
