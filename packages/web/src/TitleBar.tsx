import { useContext, useEffect, useState } from "react";
import { IntlContext, useIntl } from "react-intl";
import { call, platform, type WindowAction, type WindowState } from "./host";
import { keycaps, prettyKeys } from "./hotkey";
import { versionLabel } from "./brand";
import { CaptureIcon, ChevronIcon, UpdateIcon } from "./icons";
import { Menu } from "./Menu";
import { MenuBar, type TopMenu } from "./MenuBar";

/** What the title bar's Capture button needs (handed over by Workspace) */
export interface CaptureControls {
  /** Global shortcut, e.g. "Ctrl+Alt+A"; not set / not registered = empty */
  hotkey: string;
  /** The setting "Hide this window while capturing" */
  hide: boolean;
  start: () => void;
  setHide: (hide: boolean) => void;
  openSettings: () => void;
}

/** What a press on the strip is not about: controls and menu names keep their own presses */
const STRIP_CONTROLS = "button, a, input, [role=menuitem], .menubar-item";

/**
 * Mac: the blank part of the strip is the title bar, but a WKWebView page cannot ask the system to drag the window (no app-region), so a
 * press there asks the shell to start moving it, and a double click asks it to zoom (or minimize, as the system setting says)
 */
function stripPress(e: React.MouseEvent<HTMLElement>) {
  if (e.button !== 0 || (e.target as HTMLElement).closest(STRIP_CONTROLS)) return;
  void call(e.detail === 2 ? "windowZoom" : "windowDrag").catch(() => {});
}

/**
 * The strip at the very top of the window: menu bar + drag area on the blank part + minimize / maximize / close (the menu bar sits in the title bar).
 * The system title bar has been removed (MainWindow.DropSystemTitleBar): the blank part acts as the title bar through app-region: drag,
 * and double-click to maximize, the right-click system menu, and snapping when dragged to a screen edge are all the system's own; pulling the top edge up to change the height is handed to the system by StartResize
 */
export function TitleBar(props: {
  menus: TopMenu[];
  win: WindowState;
  onWindow: (action: WindowAction) => void;
  capture: CaptureControls;
  /** The shell found a new version (updates.ts): an "update available" button appears to the left of Capture and opens the download page when clicked */
  update?: { version: string; open: () => void };
}) {
  const intl = useIntl();
  const { win, onWindow, capture } = props;
  const keys = keycaps(prettyKeys(capture.hotkey), (id) => intl.formatMessage({ id }));
  const mac = platform === "mac";
  // On the Mac the system draws the three window buttons (at the left, over this strip) and resizes the window
  const resizable = !mac && !win.maximized && !win.fullscreen;
  const resize = (edge: "top" | "topleft" | "topright") => (e: React.PointerEvent) => {
    if (e.button === 0) void call("windowResize", { edge }).catch(() => {});
  };
  return (
    <div
      className={`titlebar${win.fullscreen ? " is-fullscreen" : ""}${mac ? " is-mac" : ""}`}
      role="presentation"
      onMouseDown={mac ? stripPress : undefined}
    >
      <MenuBar menus={props.menus} />
      {/* Screen Capture does not belong to any one item but to the whole app, so it sits at the right of the title bar (next to the window buttons, present whichever item is open).
          A split button: the left part captures as configured, and the check in the small arrow's menu decides whether to hide this window
          (the arrow menu holds only that one hide / don't-hide check; "don't hide this time" and a duplicate "Screen Capture" entry are dropped) */}
      {props.update && (
        <button
          className="titlebar-action titlebar-update"
          onClick={props.update.open}
          title={intl.formatMessage({ id: "titlebar.updateTitle" }, { version: versionLabel(props.update.version) })}
        >
          <UpdateIcon />
          {intl.formatMessage({ id: "titlebar.update" })}
        </button>
      )}
      <div className="titlebar-split">
        <button
          className="titlebar-action"
          onClick={() => capture.start()}
          title={intl.formatMessage({ id: "titlebar.captureTitle" }, { hide: capture.hide ? "yes" : "no", keys: keys || "none" })}
        >
          <CaptureIcon />
          {intl.formatMessage({ id: "titlebar.capture" })}
        </button>
        <Menu
          buttonClass="titlebar-action titlebar-more"
          title={intl.formatMessage({ id: "titlebar.captureOptions" })}
          align="right"
          trigger={() => <ChevronIcon />}
          items={[
            {
              label: intl.formatMessage({ id: "titlebar.hideWindow" }),
              checked: capture.hide,
              onClick: () => capture.setHide(!capture.hide),
            },
            "-",
            { label: intl.formatMessage({ id: "titlebar.captureSettings" }), onClick: capture.openSettings },
          ]}
        />
      </div>
      {!mac && <WindowButtons win={win} onWindow={onWindow} />}
      {resizable && (
        <>
          <div className="win-resize is-top" onPointerDown={resize("top")} />
          <div className="win-resize is-topleft" onPointerDown={resize("topleft")} />
          <div className="win-resize is-topright" onPointerDown={resize("topright")} />
        </>
      )}
    </div>
  );
}

/**
 * The three window buttons: minimize, maximize / restore (exit full screen when in full screen), close.
 * The error page (ErrorPage in ErrorBoundary.tsx) uses them too: the messages may not be loaded by then, and without them it falls back to English
 */
function WindowButtons({ win, onWindow }: { win: WindowState; onWindow: (action: WindowAction) => void }) {
  const intl = useContext(IntlContext);
  const t = (id: string, fallback: string) => intl?.formatMessage({ id, defaultMessage: fallback }) ?? fallback;
  const max = win.fullscreen
    ? t("titlebar.exitFullscreen", "Exit full screen")
    : win.maximized
      ? t("menu.window.restore", "Restore")
      : t("menu.window.maximize", "Maximize");
  return (
    <div className="win-btns">
      <button
        className="win-btn"
        onClick={() => onWindow("minimize")}
        title={t("menu.window.minimize", "Minimize")}
        aria-label={t("menu.window.minimize", "Minimize")}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" shapeRendering="crispEdges">
          <path d="M0 5.5h10" stroke="currentColor" />
        </svg>
      </button>
      <button
        className="win-btn"
        onClick={() => onWindow(win.fullscreen ? "fullscreen" : "maximize")}
        title={win.fullscreen ? t("titlebar.exitFullscreenTitle", "Exit full screen (F11)") : max}
        aria-label={max}
      >
        {win.maximized || win.fullscreen ? (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" shapeRendering="crispEdges">
            <rect x="0.5" y="2.5" width="7" height="7" />
            <path d="M2.5 2.5v-2h7v7h-2" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" shapeRendering="crispEdges">
            <rect x="0.5" y="0.5" width="9" height="9" />
          </svg>
        )}
      </button>
      <button
        className="win-btn win-close"
        onClick={() => onWindow("close")}
        title={t("titlebar.closeTitle", "Close (Alt F4)")}
        aria-label={t("app.toast.close", "Close")}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.1">
          <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
        </svg>
      </button>
    </div>
  );
}

/**
 * A title bar with only the drag area and the three window buttons: used when the whole window level fails (error page, startup failure page).
 * The system title bar has been removed, so without this strip the window could not be moved, minimized or closed (the error page used to be just one line of text and two buttons)
 */
export function BareTitleBar() {
  const [win, setWin] = useState<WindowState>({ maximized: false, fullscreen: false, topmost: false });
  useEffect(() => {
    const refresh = () =>
      void call("windowState")
        .then(setWin)
        .catch(() => {});
    refresh();
    window.addEventListener("resize", refresh);
    return () => window.removeEventListener("resize", refresh);
  }, []);
  const onWindow = (action: WindowAction) =>
    void call("window", { action })
      .then(setWin)
      .catch(() => {});
  const mac = platform === "mac";
  return (
    <div
      className={`titlebar${win.fullscreen ? " is-fullscreen" : ""}${mac ? " is-mac" : ""}`}
      role="presentation"
      onMouseDown={mac ? stripPress : undefined}
    >
      <div className="titlebar-fill" />
      {!mac && <WindowButtons win={win} onWindow={onWindow} />}
    </div>
  );
}
