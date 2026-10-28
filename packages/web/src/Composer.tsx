import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { CATEGORIES, formatTime, type AnnotationCategory } from "@sniptoss/core";
import { useIntl } from "react-intl";
import { afterToolHold } from "./hold";
import { CloseIcon, PlusIcon, UndoIcon } from "./icons";
import { pressesControl, useKeys } from "./keys";

export interface ComposerValue {
  category: AnnotationCategory;
  body: string;
  time?: { start: number; end?: number };
}

/** Where the composer goes inside the canvas area (relative to it). With avoid (the mark's bounding box) it sits next to it without covering it */
export interface ComposerAnchor {
  x: number;
  y: number;
  avoid?: { left: number; top: number; right: number; bottom: number };
}

/** Keep 12 from the canvas area's edge and 12 from the mark */
const EDGE = 12;
const GAP = 12;

/**
 * Right → left → below → above: the first side with enough room is used; only when none fits (the mark nearly fills the canvas)
 * is it clamped into the canvas area. Rounded: on fractional pixels the text and borders blur.
 */
function place(a: ComposerAnchor, w: number, h: number, pw: number, ph: number) {
  const clampX = (x: number) => Math.max(EDGE, Math.min(x, pw - w - EDGE));
  const clampY = (y: number) => Math.max(EDGE, Math.min(y, ph - h - EDGE));
  const m = a.avoid;
  const fits = (p: { x: number; y: number }) => p.x >= EDGE && p.x + w <= pw - EDGE && p.y >= EDGE && p.y + h <= ph - EDGE;
  const ok = m
    ? [
        { x: m.right + GAP, y: clampY(m.top) },
        { x: m.left - GAP - w, y: clampY(m.top) },
        { x: clampX(m.left), y: m.bottom + GAP },
        { x: clampX(m.left), y: m.top - GAP - h },
      ].find(fits)
    : undefined;
  const p = ok ?? { x: clampX(a.x), y: clampY(a.y) };
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

/**
 * The composer for writing a note. It sits next to the mark just drawn (anchor is relative to the canvas area) and switches sides when
 * the right side has no room, never covering the mark. Enter (or Ctrl+Enter) saves, Shift+Enter inserts a newline, Esc cancels, Alt+1~4
 * switch category. While it is open, marks drawn on the canvas all belong to this note (ADR-0009): the title row says "3 marks", Alt+Z
 * (or the button next to it) removes the last place drawn; after each added place focus returns to the input box. Video: a note defaults
 * to the moment when the mark was drawn; if the comment covers a span it can become "from … to …" (I / O set the start and end). Don't
 * call it "end point": it is easily mistaken for the end of the video.
 */
export function Composer(props: {
  anchor: ComposerAnchor;
  initial: ComposerValue;
  /**
   * Title; a new comment without marks changes with the time: with a time it is a "Timestamped Comment", with the time cleared by × it is
   * an "Overall Comment" (timed = there is a time now)
   */
  title: string | ((timed: boolean) => string);
  /** Video: gets the current playback time, used to set the start / end of the span */
  currentTime?: () => number;
  /**
   * The time is optional: a video's overall comment (no marks) targets the whole video by default; "Set time" adds one and × removes
   * it (it used to be tied to the current time and could not be removed). A note with marks always has a time: the frame the marks were drawn on
   */
  timeOptional?: boolean;
  onSave: (v: ComposerValue) => void;
  onCancel: () => void;
  /**
   * What the composer currently holds (undefined once it is closed): before switching items or opening another composer, the outside
   * uses it to tell whether there is unsaved text. It used to write a ref passed in from outside; it is a callback now, since the
   * outside owns its ref (react(immutability))
   */
  onLive?: (v: ComposerValue | undefined) => void;
  /**
   * Saving (the first note on a large video reads its size and computes the fingerprint, which takes a while): the button says "Saving…",
   * the text is locked, and pressing save again does nothing
   */
  saving?: boolean;
  /** How many places this note marks (0 = a comment without marks) */
  places?: number;
  /** Remove the last place drawn (does nothing when only one is left) */
  onUndoPlace?: () => void;
  /** Can keep marking on the canvas: the input's placeholder talks about that instead */
  keepDrawing?: boolean;
}) {
  const intl = useIntl();
  const [category, setCategory] = useState(props.initial.category);
  const [body, setBody] = useState(props.initial.body);
  const [time, setTime] = useState(props.initial.time);
  // The callback is new on every render, so call it through an Effect Event: tell the outside only when the text changes or on close, not
  // whenever the callback changes
  const tellLive = useEffectEvent((v: ComposerValue | undefined) => props.onLive?.(v));
  useEffect(() => {
    tellLive({ category, body, time });
  }, [category, body, time]);
  useEffect(() => () => tellLive(undefined), []);
  const box = useRef<HTMLDivElement>(null);
  const text = useRef<HTMLTextAreaElement>(null);
  const [pos, setPos] = useState({ x: Math.round(props.anchor.x), y: Math.round(props.anchor.y) });

  useLayoutEffect(() => {
    const el = box.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    setPos(place(props.anchor, el.offsetWidth, el.offsetHeight, parent.clientWidth, parent.clientHeight));
  }, [props.anchor]);

  // The box grows with the text: if it grows below the canvas area, the whole box moves up into view (only up, so it doesn't jump
  // sideways while typing)
  useEffect(() => {
    const el = box.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const ro = new ResizeObserver(() => {
      const over = el.offsetTop + el.offsetHeight - (parent.clientHeight - EDGE);
      if (over > 0) setPos((p) => ({ ...p, y: Math.max(EDGE, p.y - over) }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Drawn while holding a tool key (hold mode): give focus on release, see hold.ts
  useEffect(() => afterToolHold(() => text.current?.focus()), []);
  // Another place was marked on the canvas: focus returns to the input box to keep writing (clicking the canvas moved focus out of it)
  const places = props.places ?? 0;
  const lastPlaces = useRef(places);
  useEffect(() => {
    const more = places > lastPlaces.current;
    lastPlaces.current = places;
    return more ? afterToolHold(() => text.current?.focus()) : undefined;
  }, [places]);
  const undoPlace = () => {
    if (places > 1) props.onUndoPlace?.();
  };

  const save = () => {
    if (props.saving) return;
    if (!body.trim()) {
      text.current?.focus();
      return;
    }
    props.onSave({ category, body: body.trim(), time });
  };
  /** Small hint under the time row (e.g. "Set as range" was clicked without moving the video) */
  const [timeHint, setTimeHint] = useState<string>();
  const hintTimer = useRef<number>(undefined);
  const hint = (message: string) => {
    setTimeHint(message);
    clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setTimeHint(undefined), 5000);
  };
  useEffect(() => () => clearTimeout(hintTimer.current), []);

  const setStart = () => {
    if (!props.currentTime) return;
    const now = props.currentTime();
    setTime((t) => (t?.end !== undefined && now >= t.end ? { start: now } : { start: now, end: t?.end }));
  };
  const setEnd = () => {
    if (!props.currentTime) return;
    const now = props.currentTime();
    const start = time?.start ?? now;
    // The video is still at the start time: clicking now would do nothing, so tell the user to move the video first
    if (Math.abs(now - start) < 0.01) return hint(intl.formatMessage({ id: "composer.rangeHint" }));
    setTimeHint(undefined);
    setTime(now > start ? { start, end: now } : { start: now, end: start });
  };

  // I / O alone also work when the caret is not in the input box (typing in the box is unaffected, see keys.ts); inside the box use Alt+I
  // / Alt+O (onKeyDown)
  useKeys(props.currentTime ? { I: setStart, O: setEnd } : {});
  // After clicking the canvas or the video, focus is outside the composer: Ctrl+Enter still saves (keys pressed inside are handled first
  // by onKeyDown below)
  useKeys({ "Ctrl+Enter": save, ...(places > 1 ? { "Alt+Z": undoPlace } : {}) });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      props.onCancel();
    } else if (
      e.key === "Enter" &&
      !e.shiftKey &&
      !e.altKey &&
      !e.nativeEvent.isComposing &&
      (e.ctrlKey || e.metaKey || !pressesControl(e.nativeEvent))
    ) {
      // Enter saves, Shift+Enter inserts a newline, Ctrl+Enter still saves (same as Screen Capture and the AI dialog). Enter while an IME
      // is choosing characters belongs to the IME. Enter on Cancel, a category or a time button reached with Tab presses that button;
      // after clicking a category with the mouse, Enter still saves
      e.preventDefault();
      e.stopPropagation();
      save();
    } else if (e.altKey && /^Digit[1-4]$/.test(e.code)) {
      e.preventDefault();
      e.stopPropagation();
      setCategory(CATEGORIES[Number(e.code.slice(5)) - 1]);
    } else if (e.altKey && e.code === "KeyZ" && places > 1) {
      e.preventDefault();
      e.stopPropagation();
      undoPlace();
    } else if (e.altKey && (e.code === "KeyI" || e.code === "KeyO")) {
      // While typing the caret is in the input box and a bare I / O types a letter, hence Alt
      e.preventDefault();
      e.stopPropagation();
      if (e.code === "KeyI") setStart();
      else setEnd();
    }
  };

  return (
    // The frame is not a control itself: onKeyDown receives the keys bubbling up from the input and buttons inside (Esc, Enter, Alt+digit / I / O);
    // the other two handlers only keep pointer events from leaking onto the canvas
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions
    <div
      ref={box}
      className="composer"
      style={{ left: pos.x, top: pos.y }}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="composer-title">
        <span>{typeof props.title === "function" ? props.title(!!time) : props.title}</span>
        {places > 1 && (
          <span className="composer-places">
            {intl.formatMessage({ id: "composer.places" }, { count: places })}
            <button
              type="button"
              className="icon-btn composer-undo-place"
              onClick={undoPlace}
              title={intl.formatMessage({ id: "composer.undoPlaceTitle" })}
              aria-label={intl.formatMessage({ id: "composer.undoPlace" })}
            >
              <UndoIcon />
            </button>
          </span>
        )}
      </div>
      <div className="segmented" role="radiogroup" aria-label={intl.formatMessage({ id: "composer.category" })}>
        {CATEGORIES.map((c, i) => (
          <button
            key={c}
            className={`seg chip-${c}${c === category ? " is-on" : ""}`}
            onClick={() => setCategory(c)}
            title={intl.formatMessage({ id: "composer.categoryTitle" }, { name: intl.formatMessage({ id: `category.${c}` }), n: i + 1 })}
          >
            {intl.formatMessage({ id: `category.${c}` })}
          </button>
        ))}
      </div>
      {time && (
        <>
          <div className="composer-time">
            <span className="muted">{intl.formatMessage({ id: "composer.time" })}</span>
            <button
              className="time-chip"
              onClick={setStart}
              title={
                time.end === undefined
                  ? intl.formatMessage({ id: "composer.timeTitle" })
                  : intl.formatMessage({ id: "composer.startTitle" })
              }
            >
              {formatTime(time.start)}
            </button>
            {time.end === undefined ? (
              <>
                <button className="link-btn" onClick={setEnd} title={intl.formatMessage({ id: "composer.rangeTitle" })}>
                  <PlusIcon />
                  {intl.formatMessage({ id: "composer.makeRange" })}
                </button>
                {/* × removes one level at a time: range → single time (the one below) → whole video (this one; only overall comments can
                    go that far) */}
                {props.timeOptional && (
                  <button
                    className="time-clear"
                    onClick={() => setTime(undefined)}
                    title={intl.formatMessage({ id: "composer.clearTimeTitle" })}
                    aria-label={intl.formatMessage({ id: "composer.clearTime" })}
                  >
                    <CloseIcon />
                  </button>
                )}
              </>
            ) : (
              <>
                <span className="muted">{intl.formatMessage({ id: "composer.to" })}</span>
                <button className="time-chip" onClick={setEnd} title={intl.formatMessage({ id: "composer.endTitle" })}>
                  {formatTime(time.end)}
                </button>
                <button
                  className="time-clear"
                  onClick={() => setTime({ start: time.start })}
                  title={intl.formatMessage({ id: "composer.clearRangeTitle" })}
                  aria-label={intl.formatMessage({ id: "composer.clearRange" })}
                >
                  <CloseIcon />
                </button>
              </>
            )}
          </div>
          {timeHint && <div className="composer-hint-line">{timeHint}</div>}
        </>
      )}
      {!time && props.timeOptional && props.currentTime && (
        <div className="composer-time">
          <span className="muted">{intl.formatMessage({ id: "composer.time" })}</span>
          <span>{intl.formatMessage({ id: "composer.wholeVideo" })}</span>
          <button className="link-btn" onClick={setStart} title={intl.formatMessage({ id: "composer.addTimeTitle" })}>
            <PlusIcon />
            {intl.formatMessage({ id: "composer.addTime" })}
          </button>
        </div>
      )}
      {/* O (set as range) pressed on the whole video: the hint must be visible too (this row used to be drawn only when there was a time,
          so the key seemed to do nothing) */}
      {!time && timeHint && <div className="composer-hint-line">{timeHint}</div>}
      {/* Every form field has a name: one with neither id nor name makes the browser record an issue each time it appears (even with autofill
          off and no DevTools attached), and this box is a new field every time, so a long session kept up to 1000 such records in memory.
          tests/e2e/form-fields.spec.ts checks every screen */}
      <textarea
        ref={text}
        name="note"
        className="composer-text"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        readOnly={props.saving}
        placeholder={intl.formatMessage({ id: props.keepDrawing ? "composer.placeholderMarks" : "composer.placeholder" })}
        rows={3}
        spellCheck={false}
      />
      <div className="composer-foot">
        <span className="muted composer-hint">{intl.formatMessage({ id: "composer.keys" })}</span>
        <button className="btn btn-ghost btn-small" onClick={props.onCancel}>
          {intl.formatMessage({ id: "dialog.cancel" })}
        </button>
        <button className="btn btn-primary btn-small" onClick={save} disabled={!body.trim() || props.saving}>
          {intl.formatMessage({ id: props.saving ? "composer.saving" : "composer.save" })}
        </button>
      </div>
    </div>
  );
}
