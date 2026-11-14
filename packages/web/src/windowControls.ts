import { useEffect, useEffectEvent, useState } from "react";
import { useIntl } from "react-intl";
import { call, logError, type CaptureSettings, type WindowAction, type WindowState } from "./host";
import { keycaps, prettyKeys } from "./hotkey";
import { dismissTooltip } from "./Tooltip";

// Window and Screen Capture switches (menu Window, the title bar's three buttons and the capture button): the state all lives in the shell, and here it is only read back and forwarded

type Notify = (text: string, action?: { label: string; run: () => void }) => void;

/** Menu Window: the maximized / restored, full screen and always-on-top states, and running those commands */
export function useWindowState(onNotify: Notify) {
  const intl = useIntl();
  const [win, setWin] = useState<WindowState>({ maximized: false, fullscreen: false, topmost: false });
  useEffect(() => {
    const refresh = () =>
      void call("windowState")
        .then(setWin)
        .catch(() => {});
    refresh();
    // Changes that bypass the menu, such as double-clicking the title bar to maximize: the menu's "Maximize / Restore" must follow them too
    window.addEventListener("resize", refresh);
    return () => window.removeEventListener("resize", refresh);
  }, []);
  const windowCmd = (action: WindowAction) =>
    void call("window", { action })
      .then((s) => {
        setWin(s);
        if (action === "topmost") onNotify(intl.formatMessage({ id: s.topmost ? "app.window.topmostOn" : "app.window.topmostOff" }));
      })
      .catch((e: Error) => onNotify(e.message));
  return { win, windowCmd };
}

/**
 * Screen Capture (the shell's app/Capture): the shortcut (shown in menus and button tooltips), whether to hide this window first when capturing from within it, and starting a capture.
 * The shortcut is changed in Settings, which sends sniptoss:capture-settings when done, and it is re-read here
 */
export function useCaptureControls(opts: {
  onNotify: Notify;
  notifyError: (text: string, e: unknown) => void;
  /** Open the Screen Capture page of Settings */
  onSettings: () => void;
}) {
  const intl = useIntl();
  const tk = (id: string) => intl.formatMessage({ id });
  const [captureHotkey, setCaptureHotkey] = useState("");
  /** Why the shortcut does not work (another program holds it): the Capture button keeps a quiet mark and says why on hover, at every launch */
  const [captureProblem, setCaptureProblem] = useState<string>();
  /** Hide this window first when capturing from within it (Settings → Screen Capture; also switchable in the small arrow next to the title bar button) */
  const [captureHide, setCaptureHide] = useState(true);
  // Said out loud only when something changed since the last launch (the shell decides, CaptureSettings.HotkeyWorked): the shortcut stopped working (another program took it),
  // or the shell replaced the default one the user had been using (it would type a character). Not at every launch, and never on the first one (it would land on the tutorial;
  // the Capture button's mark says why)
  const tellProblem = useEffectEvent((text: string) =>
    opts.onNotify(text, { label: intl.formatMessage({ id: "app.capture.openSettings" }), run: opts.onSettings }),
  );
  const changeText = useEffectEvent((c: CaptureSettings) => {
    const moved = c.hotkeyMoved;
    if (moved)
      return intl.formatMessage(
        { id: moved.to ? "app.capture.hotkeyMoved" : "app.capture.hotkeyOff" },
        { from: keycaps(prettyKeys(moved.from), tk), to: keycaps(prettyKeys(moved.to), tk), typed: moved.typed },
      );
    return c.hotkeyLost && c.hotkeyError ? intl.formatMessage({ id: "app.capture.hotkeyFailed" }, { reason: c.hotkeyError }) : undefined;
  });
  useEffect(() => {
    const load = () =>
      void call("captureSettings")
        .then((c) => {
          setCaptureHotkey(c.hotkeyError ? "" : c.hotkey);
          setCaptureProblem(c.hotkeyError ?? undefined);
          setCaptureHide(c.hideWindow);
          // The shell hands a change out only once, so this fires once even when the page reloads
          const text = changeText(c);
          if (text) tellProblem(text);
        })
        .catch(() => {});
    load();
    window.addEventListener("sniptoss:capture-settings", load);
    return () => window.removeEventListener("sniptoss:capture-settings", load);
  }, []);
  const startCapture = () =>
    void dismissTooltip()
      .then(() => call("captureStart"))
      .catch((e: Error) => {
        logError("Screen Capture", e);
        opts.notifyError(intl.formatMessage({ id: "app.capture.failed" }, { reason: e.message }), e);
      });
  const setCaptureHideAlways = (hide: boolean) =>
    void call("setCaptureSettings", { hideWindow: hide })
      .then((c) => {
        setCaptureHide(c.hideWindow);
        opts.onNotify(intl.formatMessage({ id: c.hideWindow ? "app.capture.hideOn" : "app.capture.hideOff" }));
      })
      .catch((e: Error) => opts.onNotify(e.message));
  return { captureHotkey, captureProblem, captureHide, startCapture, setCaptureHideAlways };
}
