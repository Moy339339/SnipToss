import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useIntl } from "react-intl";
import { cssZoom } from "./cssZoom";
import { keycaps } from "./hotkey";
import { onHostEvent } from "./host";
import { CheckIcon } from "./icons";

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  /** Gray text on the right: shortcuts only (explanatory text goes in title, shown on hover) */
  hint?: string;
  /** Hover tooltip: extra explanation of what this item does */
  title?: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  /** Toggle item: a check means on (no check is shown when there is an icon) */
  checked?: boolean;
  /** One-of-several choice (interface language): screen readers announce a radio (menuitemradio); the check marks the selected one */
  radio?: boolean;
  /**
   * A row of swatches (mark color, markColors.ts): this row is not a button (onClick is not called); the swatches inside are what get clicked.
   * Keyboard: ↑↓ landing on this row focuses the lit swatch (the first if none is lit), ← → move between swatches
   */
  swatches?: MenuSwatch[];
  /** The key name this item presses (pressKey), like "Ctrl+=": the Mac's native menu shows it as the item's shortcut (menuModel.ts) */
  keys?: string;
  /** Undo / redo: the Mac's native menu hands these to the text box instead when the caret is in one (menuModel.ts) */
  role?: "undo" | "redo";
  /** Only in the menu of this platform (Exit, Settings… and About are in the Mac's app menu); the Windows menu bar never reads it */
  only?: "windows" | "mac";
}

export interface MenuSwatch {
  color: string;
  /** Name: read by screen readers, also the hover tooltip */
  label: string;
  /** Shortcut, shown in the hover tooltip (as a keycap) */
  key?: string;
  checked: boolean;
  onClick: () => void;
}

/** Minimum distance between the menu and the window edge */
const EDGE = 8;
const GAP = 6;

/**
 * Place the menu next to its anchor: move it in when it hits a window edge, flip it up when there is no room below (up = prefer above).
 * stayBelow: below the anchor only (menu bar: there is no room above, and moving up would cover the menu names).
 * When the whole menu does not fit in the window its height is capped and it scrolls
 * (in a short window at 125% interface size the View menu covered the menu bar and its first items ended up outside the window, unreachable).
 * With the interface zoomed as a whole (Settings → Interface size): measured positions are screen pixels, while the element's own size
 * and the left/top written back are pre-zoom, so convert;
 * gap and the 8 from the window edge are interface distances and scale up (otherwise at 125% everything else grew but the menu stayed 4 from its button)
 */
export function place(
  m: HTMLElement,
  anchor: { left: number; right: number; top: number; bottom: number },
  align: "left" | "right",
  up: boolean,
  gap = GAP,
  stayBelow = false,
) {
  const zoom = cssZoom();
  const edge = EDGE * zoom;
  const space = gap * zoom;
  m.style.maxHeight = "";
  const mw = m.offsetWidth * zoom;
  const mh = m.offsetHeight * zoom;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = align === "left" ? anchor.left : anchor.right - mw;
  left = Math.min(Math.max(edge, left), vw - mw - edge);
  const below = anchor.bottom + space;
  const above = anchor.top - space - mh;
  const fitsBelow = below + mh <= vh - edge;
  const fitsAbove = above >= edge;
  let top: number;
  let room: number;
  if (stayBelow) {
    top = below;
    room = vh - edge - below;
  } else {
    top = up ? (fitsAbove || !fitsBelow ? above : below) : fitsBelow || !fitsAbove ? below : above;
    top = Math.max(edge, Math.min(top, vh - mh - edge));
    room = vh - 2 * edge;
  }
  if (mh > room) m.style.maxHeight = `${Math.max(0, room) / zoom}px`;
  m.style.left = `${left / zoom}px`;
  m.style.top = `${top / zoom}px`;
  m.style.visibility = "visible";
}

/**
 * Menu for buttons on the title bar (menu names, the small arrow next to Capture): measured from the title bar's lower edge plus 4, always placed below.
 * Placing it against the button's bottom edge would cover the title bar's line and look like two lines; the two kinds of buttons each computing their own was off by 1px
 */
export function placeBelowTitlebar(m: HTMLElement, button: HTMLElement, align: "left" | "right") {
  const r = button.getBoundingClientRect();
  const bar = button.closest(".titlebar")?.getBoundingClientRect() ?? r;
  place(m, { left: r.left, right: r.right, top: r.top, bottom: bar.bottom }, align, false, 4, true);
}

/** How many menus are open: above 0 the root element carries menu-open and the title bar stops being a drag region (see .menu-open .titlebar in styles.css) */
let openMenus = 0;

/**
 * Close on a click outside, Esc, a window resize, or switching to another app. inside: clicks in these elements do not count as outside
 * (the menu itself, the button that opens it).
 * Blank areas of the title bar are drag regions: the system takes the press to drag the window and the page never sees it,
 * so while a menu is open they temporarily stop being drag regions (otherwise clicking outside would not close the menu)
 */
export function useDismiss(open: boolean, close: () => void, inside: () => (HTMLElement | null | undefined)[]) {
  const closeRef = useRef(close);
  closeRef.current = close;
  const insideRef = useRef(inside);
  insideRef.current = inside;
  useEffect(() => {
    if (!open) return;
    document.documentElement.classList.toggle("menu-open", ++openMenus > 0);
    const onDown = (e: PointerEvent) => {
      if (!insideRef.current().some((el) => el?.contains(e.target as Node))) closeRef.current();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        closeRef.current();
      }
    };
    const onLeave = () => closeRef.current();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onLeave);
    window.addEventListener("blur", onLeave);
    // The system window menu popped up (Alt+Space, right-click on blank title bar): two menus are never open at once
    const offSystemMenu = onHostEvent("systemMenu", onLeave);
    return () => {
      document.documentElement.classList.toggle("menu-open", --openMenus > 0);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onLeave);
      window.removeEventListener("blur", onLeave);
      offSystemMenu();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}

/**
 * The menu itself. Keyboard: ↑↓ move between clickable items (wrapping), Home / End, Enter / Space click the current item, Esc closes;
 * while a menu is open the other single keys are neither passed on nor typed into inputs behind it, so the canvas behind does not switch tools or play.
 * onKey: offered to the caller first (the menu bar uses it to switch menus with ← →); returning true means handled
 */
export function MenuBody(props: {
  items: (MenuItem | "-")[];
  menuRef: RefObject<HTMLDivElement | null>;
  onPick: () => void;
  onKey?: (e: KeyboardEvent) => boolean;
  /** Focus the first item as soon as it opens (when opened with the keyboard) */
  focusFirst?: boolean;
  className?: string;
}) {
  const intl = useIntl();
  const onKeyRef = useRef(props.onKey);
  onKeyRef.current = props.onKey;
  const onPickRef = useRef(props.onPick);
  onPickRef.current = props.onPick;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const m = props.menuRef.current;
      // Keys the app simulates itself when a menu item is clicked (pressKey) are not intercepted: the menu has not closed yet at that moment
      if (!m || e.key === "Escape" || !e.isTrusted) return;
      // A lone Alt: close the menu without entering the menu bar (like Windows apps). Otherwise this press would be swallowed below and the menu bar
      // only recognizes an Alt it saw both pressed and released, so Alt would do nothing while a menu is open.
      // Alt+F4 and Alt+letter work as usual: close first, then the combo takes effect
      if (e.key === "Alt") {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (!e.repeat) onPickRef.current();
        return;
      }
      // The swatch row: ← → move between swatches and stop at the ends. Runs before the caller (in the menu bar ← → switch menus)
      const active = document.activeElement as HTMLElement | null;
      const row = active?.closest(".menu-swatches");
      if (row && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
        const dots = [...row.querySelectorAll<HTMLButtonElement>(".menu-swatch")];
        const k = dots.indexOf(active as HTMLButtonElement) + (e.key === "ArrowRight" ? 1 : -1);
        dots[Math.max(0, Math.min(dots.length - 1, k))]?.focus();
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (onKeyRef.current?.(e)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      // Each stop for ↑↓: one stop per item; a swatch row also counts as a single stop (landing on the lit swatch)
      const items = [...m.querySelectorAll<HTMLElement>(".menu-item:not(:disabled), .menu-swatches:not(.is-disabled)")].map(
        (el) =>
          (el.classList.contains("menu-swatches")
            ? (el.querySelector(".menu-swatch.is-on") ?? el.querySelector(".menu-swatch"))
            : el) as HTMLButtonElement,
      );
      const i = row ? items.findIndex((el) => el.closest(".menu-swatches") === row) : items.indexOf(active as HTMLButtonElement);
      const go = (k: number) => {
        items[(k + items.length) % items.length]?.focus();
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      if (e.key === "ArrowDown") return go(i + 1);
      if (e.key === "ArrowUp") return go(i < 0 ? -1 : i - 1);
      if (e.key === "Home") return go(0);
      if (e.key === "End") return go(-1);
      if (e.key === "Enter" || e.key === " ") {
        if (i < 0) return go(0);
        // Click on press instead of waiting for the browser: Space's default action fires on release, and the UI swallows it on release
        // so that a button clicked with the mouse is not pressed again by Space (Workspace);
        // otherwise opening a menu with Alt+letter, or hovering and then pressing Space, could not click
        e.preventDefault();
        e.stopImmediatePropagation();
        // The swatch row: click the swatch that has focus (moved with ← →), not the one this stop landed on
        (row ? (active as HTMLButtonElement) : items[i]).click();
        return;
      }
      // Tab does not move focus out of the menu (like Windows menus, where Tab does nothing); otherwise focus would land in the UI behind the open menu
      if (e.key === "Tab") return go(Math.max(0, i));
      if (e.ctrlKey || e.metaKey) return;
      e.stopImmediatePropagation();
      // A menu opened with the mouse does not take focus and the caret may still be in an input: typing and Backspace must not go in
      // (like an open Windows menu). System keys such as Alt+F4 work as usual
      if (!e.altKey) e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [props.menuRef]);
  useEffect(() => {
    if (!props.focusFirst) return;
    // The menu is hidden until positioned (hidden elements cannot take focus), so wait until it is placed
    const raf = requestAnimationFrame(() => props.menuRef.current?.querySelector<HTMLButtonElement>(".menu-item:not(:disabled)")?.focus());
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focusFirst, props.menuRef]);

  // Keep separators only between two sections: drop leading and trailing ones and merge consecutive ones
  // (they appear back to back when a conditional middle section has no items)
  const items = props.items.filter(
    (item, i, all) => item !== "-" || (i > 0 && all[i - 1] !== "-" && all.slice(i + 1).some((x) => x !== "-")),
  );
  // With no icon or check on any item, drop the left column (like WinUI menus); otherwise every item would start with an empty gap
  const gutter = items.some((item) => item !== "-" && (item.icon !== undefined || item.checked !== undefined));
  return createPortal(
    // Focus stays on the menu items (onKey above handles ↑↓ Home End Enter Esc; items are buttons and focus follows them, as in the APG menu pattern),
    // so the container itself takes no focus; giving it a tabIndex would make focus land on the container when the mouse clicks a gap at the edge
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus
    <div
      className={`menu${gutter ? "" : " no-gutter"}${props.className ? ` ${props.className}` : ""}`}
      role="menu"
      ref={props.menuRef}
      style={{ visibility: "hidden" }}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) =>
        item === "-" ? (
          <div key={i} className="menu-sep" />
        ) : item.swatches ? (
          <div
            key={`${i}-${item.label}`}
            className={`menu-swatches${item.disabled ? " is-disabled" : ""}`}
            role="group"
            aria-label={item.label}
            title={item.title}
          >
            {gutter && <span className="menu-icon">{item.icon}</span>}
            <span className="menu-label">{item.label}</span>
            <span className="menu-swatch-set">
              {item.swatches.map((s) => (
                <button
                  key={s.color}
                  className={`menu-swatch${s.checked ? " is-on" : ""}`}
                  role="menuitemradio"
                  aria-checked={s.checked}
                  aria-label={s.label}
                  // Name + fullwidth space + shortcut: Tooltip draws the part after the space as a keycap (same as the toolbar)
                  data-tip={s.key ? `${s.label}\u3000${s.key}` : s.label}
                  disabled={item.disabled}
                  style={{ "--swatch": s.color } as React.CSSProperties}
                  onPointerMove={(e) => document.activeElement !== e.currentTarget && e.currentTarget.focus({ preventScroll: true })}
                  onClick={() => {
                    props.onPick();
                    s.onClick();
                  }}
                />
              ))}
            </span>
          </div>
        ) : (
          <button
            key={`${i}-${item.label}`}
            className={`menu-item${item.danger ? " is-danger" : ""}`}
            role={item.checked === undefined ? "menuitem" : item.radio ? "menuitemradio" : "menuitemcheckbox"}
            aria-checked={item.checked}
            disabled={item.disabled}
            title={item.title}
            // Keyboard focus follows the mouse to whichever item it moves over; ↑↓ continue from there
            // Only take focus when the mouse really moves onto the item (same as the menu bar: the "enter" the browser re-sends
            // for a stationary mouse does not count, otherwise after switching menus by keyboard the item under the mouse would steal focus)
            onPointerMove={(e) => document.activeElement !== e.currentTarget && e.currentTarget.focus({ preventScroll: true })}
            onClick={() => {
              props.onPick();
              item.onClick();
            }}
          >
            {gutter && <span className="menu-icon">{item.icon ?? (item.checked ? <CheckIcon /> : null)}</span>}
            <span className="menu-label">{item.label}</span>
            {item.hint && <span className="menu-hint">{keycaps(item.hint, (id) => intl.formatMessage({ id }))}</span>}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

/**
 * Dropdown menu: click the button to open, click outside or press Esc to close.
 * The menu is attached to body and placed by the button's position (overflow:hidden containers such as the side panel cannot clip it);
 * for a button on the title bar it behaves like the menu bar's menus (placeBelowTitlebar).
 * Keyboard: Tab to the button and press Enter / Space to open, focus goes to the first item; after closing, focus returns to where it was
 * before opening (focus followed the mouse over menu items, and without restoring it would fall to body; same as the menu bar's menus)
 */
export function Menu(props: {
  trigger: (open: boolean) => ReactNode;
  items: (MenuItem | "-")[];
  align?: "left" | "right";
  /** Buttons near the bottom of the window prefer to open upward */
  up?: boolean;
  title?: string;
  buttonClass?: string;
  /** Which outer frame the menu aligns to (the nearest ancestor of the button matching this selector): for a button inside a visible frame, align to the frame's edge, e.g. the zoom bar */
  anchorClosest?: string;
}) {
  /** Open or not; viaKey = opened with the keyboard (focus goes to the first item) */
  const [open, setOpen] = useState<{ viaKey: boolean } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  useDismiss(
    !!open,
    () => setOpen(null),
    () => [menu.current, button.current],
  );

  // Measure the menu first, then decide where to put it (placed before it is painted, so no flash)
  const isOpen = !!open;
  useLayoutEffect(() => {
    if (!isOpen || !menu.current || !button.current) return;
    const align = props.align ?? "right";
    if (button.current.closest(".titlebar")) return placeBelowTitlebar(menu.current, button.current, align);
    const anchor = (props.anchorClosest && button.current.closest(props.anchorClosest)) || button.current;
    place(menu.current, anchor.getBoundingClientRect(), align, !!props.up);
  }, [isOpen, props.align, props.up, props.anchorClosest]);

  // After closing, focus returns to where it was before opening; if the clicked item moved focus elsewhere itself (opening Settings), do not take it back
  useLayoutEffect(() => {
    if (!isOpen) return;
    const back = document.activeElement;
    return () => {
      const now = document.activeElement;
      if (
        back instanceof HTMLElement &&
        back !== document.body &&
        back.isConnected &&
        (!now || now === document.body || now.closest(".menu"))
      )
        back.focus({ preventScroll: true });
    };
  }, [isOpen]);

  return (
    <div className="menu-root">
      <button
        ref={button}
        className={`${props.buttonClass ?? "hdr-btn"}${open ? " is-on" : ""}`}
        // A click produced by the keyboard (Enter, Space) has no pointer type; mouse and touch clicks do
        onClick={(e) => setOpen((o) => (o ? null : { viaKey: !(e.nativeEvent as PointerEvent).pointerType }))}
        title={props.title}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        {props.trigger(isOpen)}
      </button>
      {open && <MenuBody items={props.items} menuRef={menu} onPick={() => setOpen(null)} focusFirst={open.viaKey} />}
    </div>
  );
}

/**
 * When a popup (context menu, confirm dialog) closes, return keyboard focus to the element that had it before: otherwise focus sits on a deleted button
 * and falls to body, and ↑↓ / Delete in the library do nothing until the list is clicked again. If something else has already taken focus, leave it
 */
export function useRestoreFocus(container: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const back = document.activeElement;
    const el = container.current;
    return () => {
      const now = document.activeElement;
      if (back instanceof HTMLElement && back !== document.body && back.isConnected && (!now || now === document.body || el?.contains(now)))
        back.focus({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

const FOCUSABLE =
  "button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])";

/**
 * Tab / Shift+Tab in a dialog: focus cycles inside it and never reaches the UI behind
 * (otherwise Tab could walk into the library and toolbar behind it, and screen readers would not know the dialog is modal).
 * Put it in the dialog's useKeys for Tab and Shift+Tab (popups get keys before everything else, see keys.ts); returns false = no dialog, the key works as usual
 */
export function trapTab(container: HTMLElement | null, e: KeyboardEvent) {
  if (!container) return false;
  const items = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.getClientRects().length > 0);
  if (items.length === 0) return;
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next = e.shiftKey ? items[i <= 0 ? items.length - 1 : i - 1] : items[i === -1 || i === items.length - 1 ? 0 : i + 1];
  next.focus();
}

/**
 * Keyboard focus for dialogs (shortcut list, onboarding, error box; Settings and the confirm dialog each wrote the same three steps):
 * on open, focus goes inside (the element initial returns, else the dialog itself), Tab / Shift+Tab cycle inside, and closing returns to where it was.
 * Put the returned handler in the dialog's useKeys for Tab and Shift+Tab.
 * Otherwise, with the shortcut list open, focus would still be in the note composer behind it: Esc would cancel the composer too,
 * losing unsaved text, and typing while the list was open would go into the composer
 */
export function useDialogFocus(box: RefObject<HTMLElement | null>, initial?: () => HTMLElement | null | undefined) {
  useRestoreFocus(box);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => (initial?.() ?? box.current)?.focus({ preventScroll: true }), []);
  return (e: KeyboardEvent) => trapTab(box.current, e);
}

/**
 * Context menu: top-left corner at the mouse position, bottom edge at it when there is no room below (like Windows).
 * focusFirst: opened by keyboard (Shift+F10, the menu key), focus goes to the first item
 */
export function ContextMenu(props: { x: number; y: number; items: (MenuItem | "-")[]; onClose: () => void; focusFirst?: boolean }) {
  const menu = useRef<HTMLDivElement>(null);
  useDismiss(true, props.onClose, () => [menu.current]);
  useRestoreFocus(menu);
  useLayoutEffect(() => {
    if (menu.current) place(menu.current, { left: props.x, right: props.x, top: props.y, bottom: props.y }, "left", false, 0);
  }, [props.x, props.y]);
  return <MenuBody items={props.items} menuRef={menu} onPick={props.onClose} focusFirst={props.focusFirst} />;
}
