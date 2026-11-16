import { useContext, useEffect, useRef, useState } from "react";
import { IntlContext, useIntl } from "react-intl";
import { call, nativeMenus, platform, type WindowAction, type WindowState } from "./host";
import { keycaps, prettyKeys } from "./hotkey";
import { shortcutText, withShortcut } from "./commandKeys";
import { usePrefs } from "./prefs";
import { versionLabel } from "./brand";
import { CaptureIcon, ChevronIcon, UpdateIcon } from "./icons";
import { Menu } from "./Menu";
import { MenuBar, type TopMenu } from "./MenuBar";

/** What the title bar's Capture button needs (handed over by Workspace) */
export interface CaptureControls {
  /** Global shortcut, e.g. "Ctrl+Alt+A"; not set / not registered = empty */
  hotkey: string;
  /** Why the shortcut does not work (another program holds it): the button carries a quiet mark and says why on hover */
  problem?: string;
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
 * Whether "Update available" shows only its icon: when the menu names would not fit beside it with its text (a narrow window, a long
 * language, a large interface text size), the text goes and the tooltip still says it; the menus come first. The hidden text keeps its
 * layout (styles.css .is-tight), so its width is known for when the room comes back. All in layout pixels (offset / client sizes, before
 * the interface zoom)
 */
function useTightUpdate(bar: React.RefObject<HTMLDivElement | null>, on: boolean): boolean {
  const [tight, setTight] = useState(false);
  // Watches the strip and every menu name: a narrower window, another language or text size all change one of them
  useEffect(() => {
    const root = bar.current;
    const menubar = root?.querySelector<HTMLElement>(".menubar");
    if (!on || !root || !menubar) return; // the Mac's menus are the system's: nothing to make room for
    const items = [...menubar.querySelectorAll<HTMLElement>(".menubar-item")];
    const check = () => {
      const button = root.querySelector<HTMLElement>(".titlebar-update");
      const label = root.querySelector<HTMLElement>(".titlebar-update-label");
      const last = items.at(-1);
      if (!last || !button || !label) return;
      const needed = last.offsetLeft + last.offsetWidth - menubar.offsetLeft + parseFloat(getComputedStyle(menubar).paddingRight);
      // The room the menus would have with the text shown: now, less the text and its gap while it is hidden
      const hidden = button.classList.contains("is-tight");
      const room = menubar.clientWidth - (hidden ? label.offsetWidth + parseFloat(getComputedStyle(button).columnGap) : 0);
      setTight(needed > room + 0.5);
    };
    const watch = new ResizeObserver(check);
    for (const el of [root, menubar, ...items]) watch.observe(el);
    return () => watch.disconnect();
  }, [bar, on]);
  return on && tight;
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
  const bar = useRef<HTMLDivElement>(null);
  const tight = useTightUpdate(bar, !!props.update);
  return (
    <div
      ref={bar}
      className={`titlebar${win.fullscreen ? " is-fullscreen" : ""}${mac ? " is-mac" : ""}`}
      role="presentation"
      onMouseDown={mac ? stripPress : undefined}
    >
      {/* The Mac shell draws the menus at the top of the screen (nativeMenus): nothing to show here, and the blank part fills the strip */}
      {nativeMenus ? <div className="titlebar-fill" /> : <MenuBar menus={props.menus} />}
      {/* Screen Capture does not belong to any one item but to the whole app, so it sits at the right of the title bar (next to the window buttons, present whichever item is open).
          A split button: the left part captures as configured, and the check in the small arrow's menu decides whether to hide this window
          (the arrow menu holds only that one hide / don't-hide check; "don't hide this time" and a duplicate "Screen Capture" entry are dropped) */}
      {props.update && (
        <button
          className={`titlebar-action titlebar-update${tight ? " is-tight" : ""}`}
          onClick={props.update.open}
          title={intl.formatMessage({ id: "titlebar.updateTitle" }, { version: versionLabel(props.update.version) })}
          aria-label={intl.formatMessage({ id: "titlebar.update" })}
        >
          <UpdateIcon />
          <span className="titlebar-update-label">{intl.formatMessage({ id: "titlebar.update" })}</span>
        </button>
      )}
      <div className="titlebar-split">
        {/* The shortcut does not work: a small dot on the icon, and the tooltip says why (instead of the shortcut), whenever one looks; nothing pops up */}
        <button
          className={`titlebar-action${capture.problem ? " has-problem" : ""}`}
          onClick={() => capture.start()}
          title={capture.problem ?? intl.formatMessage({ id: "titlebar.captureTitle" }, { keys: keys || "none" })}
        >
          <span className="titlebar-capture-icon">
            <CaptureIcon />
          </span>
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
  // The full screen key as it is now (the error page may have no messages: then no key)
  const { prefs } = usePrefs();
  const fullscreenKey = intl ? shortcutText("window.fullscreen", prefs.keybindings, (id) => intl.formatMessage({ id })) : "";
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
        title={win.fullscreen ? withShortcut(t("titlebar.exitFullscreenTitle", "Exit full screen"), [fullscreenKey]) : max}
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
