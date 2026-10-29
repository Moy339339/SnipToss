import { useEffect, useEffectEvent, useRef } from "react";
import { call, logError, nativeMenus, onHostEvent } from "./host";
import type { TopMenu } from "./MenuBar";
import { NativeMenuSync } from "./menuModel";

/** The menus change with the state of the page in bursts (every arrow key moves the selection): they are looked at once things are quiet */
const QUIET_MS = 50;
/** A dialog (settings, confirm, shortcut list, tour) covers the whole window, the menu bar included: the menus are greyed out while one is open */
const DIALOG = ".overlay, .tour";

/** The caret is in something you can type into: undo and redo are then the text's, not the notes' */
function inTextBox(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLElement && (el.isContentEditable || el.tagName === "INPUT" || el.tagName === "TEXTAREA");
}

/**
 * The Mac shell draws the menus itself. This sends it the menus whenever they change (setMenus) and runs what it reports (menuCommand).
 * Without a shell that draws them (Windows, tests) it does nothing
 */
export function useNativeMenus(menus: TopMenu[]) {
  const sync = useRef<NativeMenuSync | null>(null);
  const push = useEffectEvent(() => {
    sync.current?.update(menus, document.querySelector(DIALOG) !== null);
  });

  useEffect(() => {
    if (!nativeMenus) return;
    const s = new NativeMenuSync({
      send: (model) => void call("setMenus", model).catch((e: unknown) => logError("setMenus", e)),
      log: (line) => logError("native menus", new Error(line), "warn"),
      platform: "mac",
    });
    sync.current = s;
    const off = onHostEvent("menuCommand", (command) => {
      s.run(command, inTextBox(), (what) => document.execCommand(what));
    });
    return () => {
      off();
      sync.current = null;
    };
  }, []);

  // After every render: send the menus if they differ from what the shell has, once the page has been quiet for a moment
  useEffect(() => {
    if (!nativeMenus) return;
    const timer = window.setTimeout(push, QUIET_MS);
    return () => window.clearTimeout(timer);
  });

  // A dialog opening or closing is a change of the page, not of anything React hands to this hook: watch for it
  useEffect(() => {
    if (!nativeMenus) return;
    let open = document.querySelector(DIALOG) !== null;
    let timer = 0;
    const watcher = new MutationObserver(() => {
      const now = document.querySelector(DIALOG) !== null;
      if (now === open) return;
      open = now;
      window.clearTimeout(timer);
      timer = window.setTimeout(push, QUIET_MS);
    });
    watcher.observe(document.body, { childList: true, subtree: true });
    return () => {
      watcher.disconnect();
      window.clearTimeout(timer);
    };
  }, []);
}
