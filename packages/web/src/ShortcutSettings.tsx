import { useEffectEvent, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useIntl } from "react-intl";
import {
  COMMAND_GROUPS,
  clashOf,
  commandName,
  commandsFor,
  isChanged,
  keyCaps,
  keyParts,
  keysOf,
  keySearchText,
  type Bindings,
  type Command,
} from "./commands";
import { fixedCaps } from "./commandKeys";
import { KeepPunctuation } from "./KeepPunctuation";
import { CloseIcon, KeyboardIcon, LockIcon, PlusIcon, ResetIcon, SearchIcon, TrashIcon } from "./icons";
import { keyName } from "./keys";
import { usePrefs } from "./prefs";

// Settings → Keyboard Shortcuts: every command with its keys, grouped as in the Keyboard Shortcuts sheet, with a search box on top.
// Click a key to record a new one, + adds another, × on a key removes it, the circular arrow restores a changed command's defaults.
// A key already used where the command acts is not taken silently: the row says which command has it and offers to move it over.

/** Keys that only modify: while held during recording the row shows them and waits for the main key */
const MODIFIERS = new Set(["Control", "Shift", "Alt", "Meta", "AltGraph", "CapsLock", "Fn"]);

/** Which key of which command is being recorded: index = the key replaced, keys.length = a new one */
interface Recording {
  id: string;
  index: number;
  /** Modifiers held right now (shown while waiting for the main key) */
  held?: string;
  /** A key that another command uses: waiting for "Replace" or "Cancel" */
  clash?: { key: string; other: Command };
  /** A key that cannot be used here (fixed by another command, or Tab): the row says so and keeps waiting */
  refused?: string;
}

/** Where in Settings' fixed title area the page puts its parts: "Reset All" beside the title, the search box below it */
export interface HeadSlots {
  actions: HTMLElement | null;
  below: HTMLElement | null;
}

/** onRecording: a key is being recorded (Esc then cancels the recording instead of closing Settings) */
/** The Screen Capture shortcut's row: its pill records through Settings → Screen Capture's box (a global shortcut the shell registers) */
export interface CaptureKey {
  pill: ReactNode;
  hasKey: boolean;
  clear: () => void;
}

export function ShortcutSettings(props: { capture?: CaptureKey; onRecording: (on: boolean) => void; head: HeadSlots }) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const { prefs, setPrefs } = usePrefs();
  const bindings = prefs.keybindings;
  const commands = useMemo(() => commandsFor(), []);
  const [query, setQuery] = useState("");
  /** Search by pressing the keys: the key name pressed in the search box, matched exactly */
  const [byKey, setByKey] = useState(false);
  const [keyQuery, setKeyQuery] = useState<string>();
  /**
   * The buttons inside the search box (clear, search by keys) take focus when clicked: they give it back to the box, or the keys pressed
   * next go to the button and the search by keys hears nothing
   */
  const searchBox = useRef<HTMLInputElement>(null);
  const [rec, setRec] = useState<Recording>();
  const recording = rec !== undefined;
  const emitRecording = useEffectEvent((on: boolean) => props.onRecording(on));
  // A layout effect, so Settings knows before the next key arrives
  useLayoutEffect(() => emitRecording(recording), [recording]);

  const setKeys = (cmd: Command, keys: string[], extra: Bindings = {}) => {
    const next: Bindings = { ...bindings, ...extra };
    // The same keys as the default (in the same order) are not stored: a later version's new default then reaches whoever never changed it
    if (keys.length === cmd.keys.length && keys.every((k, i) => k === cmd.keys[i])) delete next[cmd.id];
    else next[cmd.id] = keys;
    setPrefs({ keybindings: next });
  };
  const reset = (cmd: Command) => {
    const next = { ...bindings };
    delete next[cmd.id];
    setPrefs({ keybindings: next });
  };

  const label = (cmd: Command) => commandName(cmd, t);
  const matches = (cmd: Command) => {
    if (keyQuery) return keysOf(cmd, bindings).includes(keyQuery);
    const q = query.trim().toLowerCase();
    if (!q) return true;
    if (label(cmd).toLowerCase().includes(q)) return true;
    // "ctrl b", "ctrl+b": every word is one of the keycaps of the same key
    const words = q.split(/[\s+]+/).filter(Boolean);
    const shown = cmd.fixed ? [cmd.fixed.shown.join(" ")] : keysOf(cmd, bindings);
    return shown.some((k) => {
      const text = keySearchText(k, t).split(" ");
      return words.every((w) => text.includes(w));
    });
  };
  const groups = COMMAND_GROUPS.map((g) => ({ g, items: commands.filter((x) => x.group === g && matches(x)) })).filter(
    (x) => x.items.length > 0,
  );
  const anyChanged = commands.some((x) => isChanged(x, bindings));

  return (
    <>
      {props.head.below &&
        createPortal(
          <div className="keys-bar">
            <label className={`search keys-search${byKey ? " is-recording" : ""}`}>
              {byKey ? <KeyboardIcon /> : <SearchIcon />}
              <input
                ref={searchBox}
                name="shortcut-search"
                value={byKey ? (keyQuery ? keyCaps(keyQuery, t).join(" ") : "") : query}
                readOnly={byKey}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (!byKey) return;
                  if (e.key === "Tab") return;
                  e.preventDefault();
                  if (e.key === "Escape") return setByKey(false);
                  if (e.key === "Backspace" && !e.ctrlKey && !e.altKey) return setKeyQuery(undefined);
                  if (MODIFIERS.has(e.key) || e.nativeEvent.isComposing) return;
                  setKeyQuery(keyName(e.nativeEvent));
                }}
                placeholder={t(byKey ? "settings.keys.pressToSearch" : "settings.keys.search")}
                spellCheck={false}
              />
              {(byKey ? keyQuery : query) && (
                <button
                  className="search-clear"
                  onClick={() => {
                    if (byKey) setKeyQuery(undefined);
                    else setQuery("");
                    searchBox.current?.focus();
                  }}
                  title={t("panel.search.clear")}
                >
                  <CloseIcon />
                </button>
              )}
              <button
                className={`search-filter${byKey ? " is-on" : ""}`}
                aria-pressed={byKey}
                onClick={() => {
                  setByKey(!byKey);
                  setKeyQuery(undefined);
                  searchBox.current?.focus();
                }}
                title={t("settings.keys.byKey")}
              >
                <KeyboardIcon />
              </button>
            </label>
          </div>,
          props.head.below,
        )}
      {props.head.actions &&
        anyChanged &&
        createPortal(
          <button className="btn btn-secondary btn-small" onClick={() => setPrefs({ keybindings: {} })}>
            {t("settings.keys.resetAll")}
          </button>,
          props.head.actions,
        )}
      {groups.map(({ g, items }) => (
        <section key={g} className="set-section">
          <h3 className="set-section-title">{t(`sc.group.${g}`)}</h3>
          <div className="set-card">
            {items.map((cmd) => (
              <KeyRow
                key={cmd.id}
                cmd={cmd}
                name={label(cmd)}
                bindings={bindings}
                rec={rec?.id === cmd.id ? rec : undefined}
                onRecord={(index) => setRec({ id: cmd.id, index })}
                onRec={setRec}
                onKeys={setKeys}
                onReset={() => reset(cmd)}
                capture={cmd.global ? props.capture : undefined}
              />
            ))}
          </div>
        </section>
      ))}
      {groups.length === 0 && <div className="keys-empty">{t("settings.keys.none")}</div>}
    </>
  );
}

function KeyRow(props: {
  cmd: Command;
  name: string;
  bindings: Bindings;
  rec?: Recording;
  onRecord: (index: number) => void;
  onRec: (rec: Recording | undefined) => void;
  onKeys: (cmd: Command, keys: string[], extra?: Bindings) => void;
  onReset: () => void;
  capture?: CaptureKey;
}) {
  const intl = useIntl();
  const t = (id: string, values?: Record<string, string>) => intl.formatMessage({ id }, values);
  const { cmd, rec } = props;
  const keys = keysOf(cmd, props.bindings);
  const changed = isChanged(cmd, props.bindings);
  const row = useRef<HTMLDivElement>(null);

  /** Take the recorded key: free → set; used by another changeable command → ask; fixed elsewhere → refuse and keep waiting */
  const take = useEffectEvent((key: string) => {
    if (!rec) return;
    if (keys.includes(key) && keys.indexOf(key) !== rec.index) return props.onRec(undefined);
    const other = clashOf(cmd, key, props.bindings);
    if (other?.fixed || other?.global)
      return props.onRec({ ...rec, held: undefined, refused: t("settings.keys.taken", { name: commandName(other, t) }) });
    if (other) return props.onRec({ ...rec, held: undefined, clash: { key, other } });
    props.onKeys(cmd, put(keys, rec.index, key));
    props.onRec(undefined);
  });
  const stop = () => props.onRec(undefined);
  /** Move the key over: the other command loses it, this one takes it */
  const moveOver = () => {
    if (!rec?.clash) return;
    const { key, other } = rec.clash;
    const theirs = keysOf(other, props.bindings).filter((k) => k !== key);
    props.onKeys(cmd, put(keys, rec.index, key), { [other.id]: theirs });
    props.onRec(undefined);
  };
  const cancel = useEffectEvent(stop);
  const replace = useEffectEvent(moveOver);
  const remove = useEffectEvent(() => {
    if (!rec) return;
    if (rec.index < keys.length)
      props.onKeys(
        cmd,
        keys.filter((_, i) => i !== rec.index),
      );
    props.onRec(undefined);
  });
  /** Modifiers pressed: shown in the pill as the start of the next try, which drops the reason the last key was refused */
  const hold = useEffectEvent((held: string | undefined) => rec && props.onRec({ ...rec, held, refused: undefined }));
  /** Modifiers let go: the pill waits again, and a refusal stays readable (it came with the key, before the modifiers were released) */
  const release = useEffectEvent(() => rec && props.onRec({ ...rec, held: undefined }));

  const recording = !!rec;
  const asking = !!rec?.clash;
  // Listen on window in the capture phase while recording: the key must not reach any shortcut (pressing Ctrl+B here must not hide the library)
  useLayoutEffect(() => {
    if (!recording) return;
    const down = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      // Tab still moves focus: it ends recording without a change
      if (e.key === "Tab") return cancel();
      e.preventDefault();
      e.stopImmediatePropagation();
      if (asking) {
        if (e.key === "Enter") replace();
        else if (e.key === "Escape") cancel();
        return;
      }
      if (e.key === "Escape") return cancel();
      if ((e.key === "Backspace" || e.key === "Delete") && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) return remove();
      if (MODIFIERS.has(e.key)) {
        const held = keyName(e).split("+").slice(0, -1);
        return hold(held.length ? held.join("+") : undefined);
      }
      take(keyName(e));
    };
    const up = (e: KeyboardEvent) => {
      if (!asking && MODIFIERS.has(e.key)) release();
    };
    const outside = (e: PointerEvent) => {
      if (!row.current?.contains(e.target as Node)) cancel();
    };
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", cancel);
    };
  }, [recording, asking]);

  /** One key as the parts drawn in its pill (Ctrl, Shift, O; on the Mac ⇧ ⌘ O) */
  const parts = (k: string) => keyCaps(k, t).map((c, i) => <span key={i}>{c}</span>);
  /** The pill waiting for keys, in place of the key being changed (or on a new line when adding) */
  const waiting = (
    <span className={`key-pill is-recording${rec?.clash ? " is-clash" : ""}`}>
      {rec?.clash ? (
        parts(rec.clash.key)
      ) : rec?.held ? (
        <>
          {parts(rec.held)}
          <span className="muted">…</span>
        </>
      ) : (
        <span className="muted">{t("settings.hotkey.recording")}</span>
      )}
    </span>
  );
  const add = (
    <button
      className="icon-btn key-add"
      onClick={() => props.onRecord(keys.length)}
      title={t("settings.keys.add")}
      aria-label={t("settings.keys.add")}
    >
      <PlusIcon />
    </button>
  );
  const trash = (onClick: () => void) => (
    <button className="icon-btn key-trash" onClick={onClick} title={t("settings.keys.remove")} aria-label={t("settings.keys.remove")}>
      <TrashIcon />
    </button>
  );
  const spacer = <span className="key-spacer" />;

  /** One line per key: the pill, its trash can, and on the first line the + (shown on hover) */
  let lines: ReactNode[];
  if (props.capture) {
    lines = [
      <div className="key-line" key="capture">
        {props.capture.pill}
        {props.capture.hasKey ? trash(props.capture.clear) : spacer}
        {spacer}
      </div>,
    ];
  } else if (cmd.fixed) {
    lines = [
      <div className="key-line" key="fixed">
        <span className="key-pill is-fixed">
          {(fixedCaps(cmd, props.bindings, intl) ?? [t("settings.hotkey.none")]).map((k, i) => (
            <span key={i}>{k}</span>
          ))}
        </span>
        <span className="key-lock" data-tip={t("settings.keys.fixed")} aria-label={t("settings.keys.fixed")}>
          <LockIcon />
        </span>
        {spacer}
      </div>,
    ];
  } else {
    lines = keys.map((k, i) => (
      <div className="key-line" key={k}>
        {rec && rec.index === i ? (
          waiting
        ) : (
          <button
            className="key-pill"
            onClick={() => props.onRecord(i)}
            // data-tip, not title: a pill just recorded appears under a mouse that hasn't moved, and the browser would show a title as
            // its own tooltip next to the app's bubble
            data-tip={t("settings.hotkey.title")}
            aria-label={`${props.name}: ${keyParts(k).join(" ")}`}
          >
            {parts(k)}
          </button>
        )}
        {trash(() =>
          props.onKeys(
            cmd,
            keys.filter((_, j) => j !== i),
          ),
        )}
        {i === 0 ? add : spacer}
      </div>
    ));
    if (rec && rec.index >= keys.length)
      lines.push(
        <div className="key-line" key="new">
          {waiting}
          {spacer}
          {keys.length === 0 ? add : spacer}
        </div>,
      );
    else if (keys.length === 0)
      lines.push(
        <div className="key-line" key="none">
          <button className="key-pill is-empty" onClick={() => props.onRecord(0)}>
            {t("settings.hotkey.none")}
          </button>
          {spacer}
          {add}
        </div>,
      );
  }

  return (
    <div className={`set-row key-row${cmd.fixed ? " is-fixed" : ""}${recording ? " is-recording" : ""}`} ref={row} data-command={cmd.id}>
      <div className="set-text">
        <div className="set-label">{props.name}</div>
        {rec?.clash && (
          <div className="set-desc key-clash">
            <span className="text-warn">
              <KeepPunctuation>{t("settings.keys.usedBy", { name: commandName(rec.clash.other, t) })}</KeepPunctuation>
            </span>
            <button className="link-btn" onClick={moveOver}>
              {t("settings.keys.replace")}
            </button>
            <button className="link-btn" onClick={stop}>
              {t("dialog.cancel")}
            </button>
          </div>
        )}
        {rec?.refused && (
          <div className="set-desc text-warn">
            <KeepPunctuation>{rec.refused}</KeepPunctuation>
          </div>
        )}
      </div>
      {/* A changed command: the circular arrow before its keys puts the defaults back */}
      {changed && (
        <button
          className="icon-btn key-reset"
          onClick={props.onReset}
          title={t("settings.keys.reset")}
          aria-label={t("settings.keys.reset")}
        >
          <ResetIcon />
        </button>
      )}
      <div className="key-lines">{lines}</div>
    </div>
  );
}

/** keys with the one at index replaced (index = length: added at the end) */
function put(keys: string[], index: number, key: string): string[] {
  const next = [...keys];
  next[index] = key;
  return next;
}
