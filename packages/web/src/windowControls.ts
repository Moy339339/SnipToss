import { useEffect, useEffectEvent, useState } from "react";
import { useIntl } from "react-intl";
import { call, logError, type WindowAction, type WindowState } from "./host";
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
  /** Hide this window first when capturing from within it (Settings → Screen Capture; also switchable in the small arrow next to the title bar button) */
  const [captureHide, setCaptureHide] = useState(true);
  // The shortcut could not be registered at startup (taken by another app): say so and offer "Go to Settings". Otherwise it would show only on the Settings page, and a press that does nothing would leave people wondering why
  // The default combination would type a character on the current keyboard layout and the shell replaced it (AltGr): say so as well
  const tellProblem = useEffectEvent((text: string) =>
    opts.onNotify(text, { label: intl.formatMessage({ id: "app.capture.openSettings" }), run: opts.onSettings }),
  );
  const problemText = useEffectEvent(
    (c: { hotkeyError: string | null; hotkeyMoved: { from: string; to: string; typed: string } | null }) => {
      const moved = c.hotkeyMoved;
      if (moved)
        return intl.formatMessage(
          { id: moved.to ? "app.capture.hotkeyMoved" : "app.capture.hotkeyOff" },
          { from: keycaps(prettyKeys(moved.from), tk), to: keycaps(prettyKeys(moved.to), tk), typed: moved.typed },
        );
      return c.hotkeyError ? intl.formatMessage({ id: "app.capture.hotkeyFailed" }, { reason: c.hotkeyError }) : undefined;
    },
  );
  useEffect(() => {
    let first = true;
    const load = () =>
      void call("captureSettings")
        .then((c) => {
          setCaptureHotkey(c.hotkeyError ? "" : c.hotkey);
          setCaptureHide(c.hideWindow);
          const text = problemText(c);
          if (first && text) tellProblem(text);
          first = false;
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
  return { captureHotkey, captureHide, startCapture, setCaptureHideAlways };
}
