import { useIntl } from "react-intl";
import { keycaps } from "./hotkey";
import { KeepPunctuation } from "./KeepPunctuation";
import { Sheet } from "./Sheet";

// Lists only shortcuts that already work; the full plan (including unimplemented ones) is in docs/shortcuts.md. The Settings window's Shortcuts page uses this list too.
// Descriptions and group names are message ids (sc.*); key names are literal keys, and those starting with key. are messages (translated ones such as "Wheel" and "Double-click")
export type ShortcutLabel = string;
export const shortcutKey = (label: ShortcutLabel) => label;
export const SHORTCUT_GROUPS: { title: string; items: [string[], ShortcutLabel][] }[] = [
  {
    title: "sc.group.global",
    items: [
      [["Ctrl", "O"], "sc.addFiles"],
      [["Ctrl", "Shift", "O"], "sc.addFolder"],
      [["Ctrl", "V"], "sc.paste"],
      [["Ctrl", "P"], "shortcuts.find"],
      [["F5"], "sc.refresh"],
      [["Ctrl", "↑ / ↓"], "sc.stepItem"],
      [["Ctrl", "B"], "sc.toggleLeft"],
      [["Ctrl", "Alt", "B"], "sc.toggleRight"],
      [["Ctrl", "\\"], "sc.toggleBoth"],
      [["Alt", "F / E / V / N / P / W / H"], "sc.menus"],
      [["F11"], "sc.fullscreen"],
      [["Ctrl", ","], "sc.settings"],
      [["? / F1"], "sc.shortcuts"],
    ],
  },
  {
    title: "sc.group.capture",
    items: [
      [["Ctrl", "Alt", "A"], "sc.capture.start"],
      [["key.clickDrag"], "sc.capture.select"],
      [["R / O / A / B"], "sc.capture.draw"],
      [["M / T"], "sc.capture.mosaicText"],
      [["C / N"], "sc.capture.notes"],
      [["1–6"], "sc.capture.color"],
      [["Enter"], "sc.capture.done"],
      [["Esc"], "sc.capture.cancel"],
    ],
  },
  {
    title: "sc.group.list",
    items: [
      [["↑ / ↓"], "sc.list.step"],
      [["Shift", "↑ / ↓"], "sc.list.range"],
      [["Ctrl", "A"], "sc.list.all"],
      [["key.drag"], "sc.list.marquee"],
      [["Esc"], "sc.list.clear"],
      [["→ / ←"], "sc.list.expand"],
      [["key.enterSpace"], "sc.list.open"],
      [["Ctrl", "C"], "sc.list.copy"],
      [["Delete"], "sc.list.remove"],
      [["Shift", "F10"], "sc.list.menu"],
    ],
  },
  {
    title: "sc.group.notes",
    items: [
      [["V"], "tool.select.tip"],
      [["H"], "sc.notes.hand"],
      [["key.holdH"], "sc.notes.holdHand"],
      [["C"], "tool.point"],
      [["R"], "tool.rect"],
      [["B"], "tool.pen"],
      [["A"], "tool.arrow"],
      [["key.holdTools"], "sc.notes.holdTools"],
      [["T"], "sc.notes.timed"],
      [["N"], "sc.notes.whole"],
      [["Shift", "N"], "sc.notes.folder"],
      [["Enter"], "sc.notes.save"],
      [["Alt", "1–4"], "sc.notes.category"],
      [["Alt", "Z"], "sc.notes.undoPlace"],
      [["[ / ]"], "sc.notes.step"],
      [["Ctrl", "F"], "shortcuts.findNotes"],
      [["X"], "sc.notes.check"],
      [["D"], "shortcuts.done"],
      [["Shift", "D"], "shortcuts.wontfix"],
      [["1–6"], "sc.notes.color"],
      [["Ctrl", "Shift", "A"], "sc.notes.copy"],
      [["Ctrl", "Shift", "I"], "sc.notes.copyImages"],
      [["↑ ↓ ← →"], "sc.notes.nudge"],
      [["Enter / Delete"], "sc.notes.editDelete"],
      [["Ctrl", "Z"], "sc.notes.undo"],
      [["Esc"], "sc.notes.cancel"],
    ],
  },
  {
    title: "sc.group.canvas",
    items: [
      [["Ctrl", "key.wheel"], "sc.canvas.wheel"],
      [["Ctrl", "+ / -"], "sc.canvas.zoom"],
      [["Shift", "1"], "sc.canvas.fit"],
      [["Shift", "2"], "sc.canvas.fill"],
      [["Shift", "0"], "sc.canvas.actual"],
      [["key.dblclick"], "sc.canvas.dblclick"],
      [["Shift", "H"], "sc.canvas.marks"],
      [["key.middleDrag"], "sc.canvas.pan"],
      [["← / →"], "sc.canvas.stepItem"],
    ],
  },
  {
    title: "sc.group.video",
    items: [
      [["key.space"], "sc.video.play"],
      [["J / L"], "sc.video.seek5"],
      [["← / →"], "sc.video.frame"],
      [["Shift", "← / →"], "sc.video.seek1"],
      [["Home / End"], "sc.video.ends"],
      [[", / ."], "sc.video.speed"],
      [["M"], "menu.play.mute"],
      [["↑ / ↓"], "sc.video.volume"],
      [["Ctrl", "L"], "sc.video.loop"],
      [["Alt", "I / O"], "sc.video.range"],
    ],
  },
];

/** One shortcut row. A parenthesized addition at the end of the description ("Open menu (or press Alt first, then the letter)") goes on its own line one size smaller, so long descriptions do not leave orphan words */
export function ShortcutRow({ keys, label }: { keys: string[]; label: ShortcutLabel }) {
  const intl = useIntl();
  const text = intl.formatMessage({ id: label });
  // The parenthesized addition is shown in gray (both fullwidth CJK and halfwidth parentheses are recognized)
  const m = /^(.+?)[\uFF08(](.+)[\uFF09)]$/.exec(text);
  return (
    <div className="shortcut-row">
      <span className="shortcut-label">
        <KeepPunctuation>
          {m ? m[1] : text}
          {m && <span className="shortcut-note">{m[2]}</span>}
        </KeepPunctuation>
      </span>
      <span className="shortcut-keys">
        {keys.map((k) => (
          <kbd key={k}>{k.startsWith("key.") ? intl.formatMessage({ id: k }) : keycaps(k, (id) => intl.formatMessage({ id }))}</kbd>
        ))}
      </span>
    </div>
  );
}

export function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const intl = useIntl();
  return (
    <Sheet title={intl.formatMessage({ id: "sc.title" })} closeKeys={["?", "F1"]} onClose={onClose}>
      <div className="sheet-grid">
        {SHORTCUT_GROUPS.map((g) => (
          <section key={g.title}>
            <div className="section-label">{intl.formatMessage({ id: g.title })}</div>
            {g.items.map(([keys, label]) => (
              <ShortcutRow key={shortcutKey(label)} keys={keys} label={label} />
            ))}
          </section>
        ))}
      </div>
    </Sheet>
  );
}
