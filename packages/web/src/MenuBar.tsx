import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { onHostEvent } from "./host";
import { letterOf, useKeys } from "./keys";
import { MenuBody, placeBelowTitlebar, useDismiss, type MenuItem } from "./Menu";

/**
 * One menu on the menu bar. key is the mnemonic letter: Alt+letter opens it. Shown in one of two ways (depends on how the message is written, ADR-0001 item 10):
 * CJK and Russian "文件(&F)" → "(F)" is appended after the label; Latin-script languages "&Datei" → that letter is underlined (at = its position in the label)
 */
export interface TopMenu {
  label: string;
  key: string;
  at?: number;
  /** Built only when opened, so checked states and enabled states are current */
  items: () => (MenuItem | "-")[];
}

/**
 * The menu bar at the top of the window (a standard desktop menu bar: File, View, Window, About, ...).
 * Windows conventions: once one menu is open, moving the mouse over another switches to it; Alt+letter opens the matching menu;
 * a lone Alt (or F10) enters the menu bar and highlights File, ← → move the highlight, ↓ / Enter / Space open it, or press its letter directly;
 * inside a menu ↑↓ select, ← → switch menus, Enter clicks, Esc closes.
 * Menu names are not in the Tab order (like Windows apps, the keyboard uses Alt / F10): otherwise Tab would first pass through seven menu names,
 * and pressing Enter on one could not open it
 */
export function MenuBar(props: { menus: TopMenu[] }) {
  const { menus } = props;
  const [open, setOpen] = useState<{ index: number; viaKey: boolean } | null>(null);
  /** A lone Alt was pressed: the menu bar shows the mnemonic letters and highlights one menu name, waiting for the next key; null = not in the menu bar. Highlight only, keyboard focus does not move (like Windows) */
  const [armed, setArmed] = useState<number | null>(null);
  const menu = useRef<HTMLDivElement>(null);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  // Only the menu names count as inside: the menu bar stretches to the left of the Capture button, and clicking that blank part must close the menu too
  useDismiss(
    !!open,
    () => setOpen(null),
    () => [menu.current, ...buttons.current],
  );

  useLayoutEffect(() => {
    const b = open && buttons.current[open.index];
    if (b && menu.current) placeBelowTitlebar(menu.current, b, "left");
  }, [open]);

  // After the menu closes, keyboard focus returns to where it was before opening (like useRestoreFocus for the context menu and confirm dialog):
  // focus followed the mouse over menu items, so without this it would fall to body when the menu closes, ↑↓ in the library would do nothing,
  // and Delete would delete the selected note on the canvas.
  // Switching between menus does not count as closing; if the clicked item moved focus elsewhere itself (search into the filter box, the note composer), do not take it back
  const isOpen = !!open;
  useLayoutEffect(() => {
    if (!isOpen) return;
    const back = document.activeElement;
    return () => {
      const now = document.activeElement;
      if (
        back instanceof HTMLElement &&
        back !== document.body &&
        back.isConnected &&
        (!now || now === document.body || now.closest(".menubar-menu"))
      )
        back.focus({ preventScroll: true });
    };
  }, [isOpen]);

  const show = (index: number, viaKey: boolean) => {
    setArmed(null);
    setOpen({ index: (index + menus.length) % menus.length, viaKey });
  };

  useKeys({
    ...Object.fromEntries(menus.flatMap((m, i) => (m.key ? [[`Alt+${m.key}`, () => show(i, true)]] : []))),
    // F10 works like a lone Alt (Windows convention): enter the menu bar and show the mnemonic letters without opening File; press again to leave.
    // While a menu is open, F10 is handled by the menu's onKey below (an open menu intercepts single keys in the capture phase, so they never reach here)
    F10: () => (open ? setOpen(null) : setArmed((a) => (a === null ? 0 : null))),
  });

  // A lone Alt: counts only if no other key was pressed between press and release
  useEffect(() => {
    let altAlone = false;
    const down = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        altAlone = !e.repeat;
        return;
      }
      altAlone = false;
      if (armed === null) return;
      // Combos with Alt / Ctrl (Alt+F4 closes the window, Alt+Space the system menu, Ctrl+B, ...) leave the menu bar and take effect as usual, not swallowed (like Windows apps);
      // Alt+letter opens its menu through useKeys above
      if (e.altKey || e.ctrlKey || e.metaKey) {
        setArmed(null);
        return;
      }
      const i = menus.findIndex((m) => m.key && m.key === letterOf(e));
      if (i >= 0) show(i, true);
      else if (e.key === "ArrowLeft" || e.key === "ArrowRight")
        setArmed((armed + (e.key === "ArrowLeft" ? -1 : 1) + menus.length) % menus.length);
      else if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") show(armed, true);
      else setArmed(null);
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== "Alt" || !altAlone) return;
      altAlone = false;
      e.preventDefault();
      // A dialog (Settings, confirm, shortcut list) is open: the menu bar is behind it, so do not enter it
      if (document.querySelector(".overlay")) return;
      if (open) setOpen(null);
      else setArmed((a) => (a === null ? 0 : null));
    };
    // Switched to another app: the Alt of Alt+Tab went down while we were here and comes up after we are back;
    // if not cleared, that Alt release on returning would count as a lone Alt
    const off = () => {
      altAlone = false;
      setArmed(null);
    };
    // Holding Alt while clicking the mouse (Alt+click) and then releasing is not a lone Alt (like Windows apps), so do not enter the menu bar
    const click = () => {
      altAlone = false;
      setArmed(null);
    };
    // The system window menu popped up (Alt+Space): it takes the Space, so here only an Alt press and release is seen, which must not count as a lone Alt;
    // also leave the menu bar and close any open menu
    const systemMenu = () => {
      off();
      setOpen(null);
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("pointerdown", click, true);
    window.addEventListener("blur", off);
    const offSystemMenu = onHostEvent("systemMenu", systemMenu);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("pointerdown", click, true);
      window.removeEventListener("blur", off);
      offSystemMenu();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armed, open, menus]);

  const current = open ? menus[open.index] : undefined;
  return (
    // The mnemonic letter (F) is hidden normally (clean look); it shows after a lone Alt or while a menu opened by keyboard is up
    <div className={`menubar${armed !== null ? " is-armed" : ""}${armed !== null || open?.viaKey ? " show-keys" : ""}`} role="menubar">
      {menus.map((m, i) => (
        <button
          key={m.label}
          ref={(el) => {
            buttons.current[i] = el;
          }}
          className={`menubar-item${open?.index === i ? " is-open" : ""}${armed === i ? " is-hot" : ""}`}
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={open?.index === i}
          tabIndex={-1}
          onPointerDown={(e) => {
            e.preventDefault(); // Do not take focus: after the menu closes, keyboard focus stays where it was (right-click too; otherwise a right-click moved focus onto the menu name)
            if (e.button !== 0) return;
            setArmed(null);
            setOpen((o) => (o?.index === i ? null : { index: i, viaKey: false }));
          }}
          // Mouse and touch open it on press; a click without a pointer press (a screen reader "clicking" it) opens it here, with focus on the first item
          onClick={(e) => {
            if ((e.nativeEvent as PointerEvent).pointerType) return;
            setArmed(null);
            setOpen((o) => (o?.index === i ? null : { index: i, viaKey: true }));
          }}
          // Switch only when the mouse really moves over (pointermove), not pointerenter: after a keyboard menu switch the browser re-sends an "enter"
          // for a stationary mouse, so with the mouse resting on the open View menu, pressing → or Alt+N switched away and was immediately switched back to View
          onPointerMove={() => {
            if (open && open.index !== i) setOpen({ index: i, viaKey: false });
          }}
        >
          {m.at === undefined ? (
            <>
              {m.label}
              {m.key && <span className="menubar-key">({m.key})</span>}
            </>
          ) : (
            <>
              {m.label.slice(0, m.at)}
              <span className="menubar-mnemonic">{m.label[m.at]}</span>
              {m.label.slice(m.at + 1)}
            </>
          )}
        </button>
      ))}
      {current && (
        <MenuBody
          key={open!.index}
          className="menubar-menu"
          items={current.items()}
          menuRef={menu}
          focusFirst={open!.viaKey}
          onPick={() => setOpen(null)}
          onKey={(e) => {
            if (e.key === "F10") {
              setOpen(null);
              return true;
            }
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              show(open!.index + (e.key === "ArrowLeft" ? -1 : 1), true);
              return true;
            }
            // While a menu is open, Alt+letter switches straight to that menu
            const i = e.altKey ? menus.findIndex((m) => m.key && m.key === letterOf(e)) : -1;
            if (i >= 0) {
              show(i, true);
              return true;
            }
            return false;
          }}
        />
      )}
    </div>
  );
}
