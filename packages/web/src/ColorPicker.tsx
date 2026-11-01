import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useIntl } from "react-intl";
import { isMarkColor } from "@sniptoss/core";
import { cssZoom } from "./cssZoom";
import { useKeys } from "./keys";
import { addRecentColor } from "./recentColors";

/** Gap to what opened it and to the window edge, 8 each (scales with the interface size) */
const GAP = 8;

type Hsv = { h: number; s: number; v: number };

const hex2 = (n: number) =>
  Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, "0");

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return `#${hex2(f(5) * 255)}${hex2(f(3) * 255)}${hex2(f(1) * 255)}`;
}

export function hexToHsv(color: string): Hsv {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return { h: h < 0 ? h + 360 : h, s: max === 0 ? 0 : d / max, v: max };
}

/** What is typed into the digits box: six hex digits, with or without # (pasted values often have it); undefined until it is complete */
const typedColor = (text: string) => {
  const t = `#${text.trim().replace(/^#/, "")}`;
  return isMarkColor(t) ? t.toLowerCase() : undefined;
};

/**
 * The color picker opened by the hue disc at the end of a color row (the color bar on the canvas, the menus, Settings): a saturation /
 * brightness field, a hue strip, the color's hex digits and OK. Laid out like the capture overlay's (app/Capture/CaptureOverlay.ColorPicker.cs).
 * Enter / OK uses the color and adds it to the recent colors; Esc or a press outside closes it without changing anything. Sits above what
 * opened it (below when there is no room), kept inside the window. The field and strip also follow the arrow keys (Shift = 10 steps)
 */
export function ColorPicker(props: {
  /** Where what opened it is (screen pixels) */
  at: DOMRect;
  /** The color in use: the picker starts from it */
  initial: string;
  onPick: (color: string) => void;
  onClose: () => void;
  /** The button that opened it: a press on it is left to that button (it closes the picker itself) instead of closing and reopening */
  owner?: Element | null;
}) {
  const intl = useIntl();
  const t = (id: string) => intl.formatMessage({ id });
  const box = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const strip = useRef<HTMLDivElement>(null);
  const digitsRef = useRef<HTMLInputElement>(null);
  const start = isMarkColor(props.initial) ? props.initial.toLowerCase() : "#ff6a3d";
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(start));
  /** The exact color: typed digits are kept as typed rather than rounded through HSV */
  const [color, setColor] = useState(start);
  const [digits, setDigits] = useState(start.slice(1).toUpperCase());

  const fromHsv = (next: Hsv) => {
    setHsv(next);
    const c = hsvToHex(next);
    setColor(c);
    setDigits(c.slice(1).toUpperCase());
  };
  const onDigits = (text: string) => {
    setDigits(text);
    const c = typedColor(text);
    if (!c) return;
    setColor(c);
    const next = hexToHsv(c);
    // Gray, black and white have no hue of their own: the strip stays where it was instead of jumping to red
    setHsv((was) => (next.s > 0 && next.v > 0 ? next : { ...next, h: was.h }));
  };
  const apply = () => {
    const c = typedColor(digits) ?? color;
    addRecentColor(c);
    props.onPick(c);
    props.onClose();
  };

  // Placed before the first paint (no flash in the corner); the digits get the keyboard, all selected so typing replaces them
  const place = useEffectEvent(() => {
    const el = box.current;
    if (!el) return;
    const z = cssZoom();
    const gap = GAP * z;
    // Layout size, not getBoundingClientRect: the opening animation scales the box down a little, which would place it too close
    const [w, h] = [el.offsetWidth * z, el.offsetHeight * z];
    const a = props.at;
    const x = Math.max(gap, Math.min(a.right - w, innerWidth * z - gap - w));
    const above = a.top - gap - h;
    const y = above >= gap ? above : Math.max(gap, Math.min(a.bottom + gap, innerHeight * z - gap - h));
    el.style.left = `${Math.round(x / z)}px`;
    el.style.top = `${Math.round(y / z)}px`;
    el.style.visibility = "";
    digitsRef.current?.focus();
    digitsRef.current?.select();
  });
  useLayoutEffect(() => place(), []);

  // A press elsewhere closes it (one on the button that opened it is left to that button)
  const close = useEffectEvent(() => props.onClose());
  const owner = useEffectEvent(() => props.owner);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!box.current?.contains(target) && !owner()?.contains(target)) close();
    };
    window.addEventListener("pointerdown", down, true);
    return () => window.removeEventListener("pointerdown", down, true);
  }, []);

  /** Arrow keys on the focused field / strip; returning false leaves the key to the digits box (moving the caret) */
  const nudge = (dx: number, dy: number) => {
    const at = document.activeElement;
    if (at === field.current) fromHsv({ ...hsv, s: clamp01(hsv.s + dx / 100), v: clamp01(hsv.v - dy / 100) });
    else if (at === strip.current) fromHsv({ ...hsv, h: Math.min(359.9, Math.max(0, hsv.h + dx * 3.6)) });
    else return false;
  };
  // Modal: Enter and Esc belong to the picker (they must not save the composer or close the color bar), other shortcuts are off while it is open
  useKeys(
    {
      Enter: apply,
      Escape: () => props.onClose(),
      ArrowLeft: () => nudge(-1, 0),
      ArrowRight: () => nudge(1, 0),
      ArrowUp: () => nudge(0, -1),
      ArrowDown: () => nudge(0, 1),
      "Shift+ArrowLeft": () => nudge(-10, 0),
      "Shift+ArrowRight": () => nudge(10, 0),
      "Shift+ArrowUp": () => nudge(0, -10),
      "Shift+ArrowDown": () => nudge(0, 10),
    },
    { modal: true },
  );

  /** Press and drag on the field / strip: every position on the way picks (pointer capture keeps it going outside the area) */
  const drag = (set: (x: number, y: number) => void) => ({
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      e.currentTarget.focus();
      const r = e.currentTarget.getBoundingClientRect();
      set(clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height));
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
      const r = e.currentTarget.getBoundingClientRect();
      set(clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height));
    },
  });

  const pure = hsvToHex({ h: hsv.h, s: 1, v: 1 });
  return createPortal(
    // The frame only keeps pointer events from leaking onto the canvas and window; the controls inside are the field, the strip, the digits and OK
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      ref={box}
      className="color-picker"
      role="dialog"
      aria-label={t("markColor.custom")}
      style={{ visibility: "hidden" }}
      // Keep presses, right-clicks and double-clicks from reaching the canvas and window (same as the composer)
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div
        ref={field}
        className="color-field"
        style={{ "--hue": pure } as React.CSSProperties}
        role="slider"
        tabIndex={0}
        aria-label={t("markColor.field")}
        aria-valuetext={`${Math.round(hsv.s * 100)}%, ${Math.round(hsv.v * 100)}%`}
        aria-valuenow={Math.round(hsv.s * 100)}
        {...drag((x, y) => fromHsv({ ...hsv, s: x, v: 1 - y }))}
      >
        <span className="color-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: color }} />
      </div>
      <div
        ref={strip}
        className="color-hue"
        role="slider"
        tabIndex={0}
        aria-label={t("markColor.hue")}
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(hsv.h)}
        {...drag((x) => fromHsv({ ...hsv, h: Math.min(359.9, x * 360) }))}
      >
        <span className="color-thumb" style={{ left: `${(hsv.h / 360) * 100}%`, background: pure }} />
      </div>
      <div className="color-row">
        <span className="color-preview" style={{ background: color }} />
        <label className="color-digits">
          <span aria-hidden="true">#</span>
          <input
            ref={digitsRef}
            name="color"
            value={digits}
            maxLength={7}
            spellCheck={false}
            autoComplete="off"
            aria-label={t("markColor.hex")}
            onChange={(e) => onDigits(e.target.value.toUpperCase())}
          />
        </label>
        <button type="button" className="btn btn-primary btn-small" onClick={apply}>
          {t("markColor.apply")}
        </button>
      </div>
    </div>,
    document.body,
  );
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

// ---------- One picker for the whole window: opened from any color row (a menu closes as soon as its swatch is clicked, so the picker
// cannot live inside it), shown by ColorPickerHost in App ----------

interface PickRequest {
  /** Where what opened it is; undefined (a native menu on the Mac) = the middle of the window */
  at?: DOMRect;
  initial: string;
  onPick: (color: string) => void;
  owner?: Element | null;
}

let open: (PickRequest & { n: number }) | undefined;
let opened = 0;
const watchers = new Set<() => void>();
const changed = () => watchers.forEach((w) => w());
const subscribe = (w: () => void) => {
  watchers.add(w);
  return () => watchers.delete(w);
};

export function openColorPicker(request: PickRequest) {
  open = { ...request, n: ++opened };
  changed();
}

export function closeColorPicker() {
  if (!open) return;
  open = undefined;
  changed();
}

/** A picker is open: dialogs underneath stop taking keys meanwhile (Settings → the mark color) */
export const useColorPickerOpen = () => useSyncExternalStore(subscribe, () => !!open);

export function ColorPickerHost() {
  const r = useSyncExternalStore(subscribe, () => open);
  if (!r) return null;
  const at = r.at ?? new DOMRect((innerWidth * cssZoom()) / 2, (innerHeight * cssZoom()) / 2, 0, 0);
  return <ColorPicker key={r.n} at={at} initial={r.initial} owner={r.owner} onPick={r.onPick} onClose={closeColorPicker} />;
}
