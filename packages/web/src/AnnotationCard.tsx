import { useEffect, useEffectEvent, useRef } from "react";
import { useIntl } from "react-intl";
import { formatTime, shapesOf, type Annotation, type NoteSection } from "@sniptoss/core";
import { CheckBox } from "./Checkbox";
import { Highlight } from "./Highlight";
import { EyeIcon, EyeOffIcon, MoreIcon, SparkIcon } from "./icons";
import { placeStyle } from "./markColors";
import { Menu, type MenuItem } from "./Menu";
import { shortWhen } from "./shortWhen";

// One note (card) in the notes panel: checkbox, number, category, tags, time, body, replies, plus the copy button and "⋯" menu on hover;
// reachable by keyboard, ↑ ↓ move between cards

const CARD_NAV = new Set(["ArrowUp", "ArrowDown", "Home", "End"]);
/**
 * ↑ ↓ Home End on a note card: moves focus to another card (focusing by keyboard selects it, see the card's onFocus); ↑ on the first card
 * goes back to the notes panel search box, and it stops at the end
 */
function stepCard(from: HTMLElement, key: string) {
  const cards = [...(from.closest(".panel-body")?.querySelectorAll<HTMLElement>(".card") ?? [])];
  const i = cards.indexOf(from);
  if (key === "ArrowUp" && i === 0) {
    document.querySelector<HTMLInputElement>(".panel-search input")?.focus();
    return;
  }
  const to =
    key === "Home" ? 0 : key === "End" ? cards.length - 1 : Math.max(0, Math.min(cards.length - 1, i + (key === "ArrowDown" ? 1 : -1)));
  cards[to]?.focus();
}

export function AnnotationCard(props: {
  /** Identifier in the notes panel (item + note id), used to find the card when scrolling it into view */
  id: string;
  a: Annotation;
  /** Number within this section */
  index: number;
  /**
   * Which section it belongs to (ADR-0008): numbers on the canvas are orange circles (like the marks on the canvas); overall comments and
   * notes on earlier versions are gray squares (no matching mark on the canvas)
   */
  section: NoteSection;
  selected: boolean;
  /** A folder comment: the group title already says "Whole folder", so the card does not add an "Overall" label */
  folder?: boolean;
  /** Checked = this note is handed over when copying for AI */
  checked: boolean;
  /**
   * For the canvas-marks section: hide / show this mark on the canvas (the eye at the far left of the action bar; while hidden, the title
   * row always shows a crossed-out eye)
   */
  mark?: { hidden: boolean; toggle: () => void };
  /** Pointer enters / leaves: the note's mark lights up on the canvas */
  onHover?: (on: boolean) => void;
  /** Terms being searched in the notes panel: matches in the body and replies are highlighted */
  terms: readonly string[];
  /** range: Shift-click checks a continuous run */
  onCheck: (range: boolean) => void;
  onPick: () => void;
  onEdit: () => void;
  onCopy: () => void;
  /** The "⋯" menu: the same menu as the right-click on the card and on this mark on the canvas */
  menu: (MenuItem | "-")[];
  /** Right-click: the same menu as right-clicking this mark on the canvas */
  onMenu: (e: React.MouseEvent) => void;
}) {
  const { a } = props;
  const time = a.anchor.time;
  const intl = useIntl();
  // If the card disappears while hovered (searched out, filtered out, status changed) it never gets the leave event:
  // send one on unmount so the mark on the canvas does not stay lit
  const hovering = useRef(false);
  const unhover = useEffectEvent(() => props.onHover?.(false));
  useEffect(
    () => () => {
      if (hovering.current) unhover();
    },
    [],
  );
  const hover = (on: boolean) => {
    hovering.current = on;
    props.onHover?.(on);
  };
  return (
    // Reachable with Tab: focusing selects it (same as a click); Enter on it edits (same as double-click), Space selects,
    // ↑ ↓ go to the previous / next card (↑ on the first card returns to the search box), Home / End jump to the ends;
    // Delete and X (check) stay the usual shortcuts that act on the selected note
    <div
      className={`card status-${a.status}${props.selected ? " is-selected" : ""}`}
      // A mark with its own color: the number and the selection outline follow it, matching the canvas
      style={placeStyle(a, 0)}
      data-annot={props.id}
      role="button"
      aria-current={props.selected || undefined}
      tabIndex={0}
      onFocus={(e) => {
        if (e.target === e.currentTarget && e.currentTarget.matches(":focus-visible") && !props.selected) props.onPick();
      }}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter") props.onEdit();
        else if (e.key === " ") props.onPick();
        else if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && CARD_NAV.has(e.key)) {
          // Don't let it propagate: ↑ ↓ on a card used to reach the canvas, where an open video took them as volume
          e.stopPropagation();
          stepCard(e.currentTarget, e.key);
        } else return;
        e.preventDefault();
      }}
      onClick={props.onPick}
      onDoubleClick={props.onEdit}
      onPointerEnter={() => hover(true)}
      onPointerLeave={() => hover(false)}
      onContextMenu={(e) => {
        e.preventDefault();
        props.onMenu(e);
      }}
    >
      <div className="card-head">
        <button
          type="button"
          role="checkbox"
          aria-checked={props.checked}
          className="card-check"
          title={intl.formatMessage({ id: props.checked ? "card.uncheck" : "card.check" })}
          onClick={(e) => {
            e.stopPropagation();
            props.onCheck(e.shiftKey);
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          <CheckBox checked={props.checked} />
        </button>
        {/* The 6-character id is for notes files, REVIEW.md and the command line; users don't need it (shown directly, the letters mean
            nothing), so it only appears on hovering the number */}
        <span
          className={`card-num${props.section === "marked" ? "" : " is-plain"}`}
          title={intl.formatMessage({ id: "card.numTitle" }, { id: a.id })}
        >
          {props.index}
        </span>
        <span className={`chip chip-${a.category}`}>{intl.formatMessage({ id: `category.${a.category}` })}</span>
        {props.mark?.hidden && (
          <span className="card-mark-hidden" title={intl.formatMessage({ id: "card.mark.hiddenTitle" })}>
            <EyeOffIcon />
          </span>
        )}
        {/* Several marks (ADR-0009): they share one number on the canvas, so say how many here */}
        {shapesOf(a).length > 1 && <span className="tag">{intl.formatMessage({ id: "card.places" }, { count: shapesOf(a).length })}</span>}
        {/* A small gray tag, kept apart from the category so the two don't read as one phrase. The titles of the timestamped / overall
            sections already say it, so only the earlier-versions section shows it */}
        {!shapesOf(a).length && !props.folder && props.section === "earlier" && (
          <span className="tag">{intl.formatMessage({ id: a.anchor.time ? "card.timed" : "card.whole" })}</span>
        )}
        {/* Already copied out: a line of faint text on the right that yields to the action bar on hover, like the date on the right of a
            Gmail list */}
        {a.handed_off_at && (
          <span
            className="card-handed"
            title={intl.formatMessage({ id: "card.handedTitle" }, { when: shortWhen(intl, a.handed_off_at, true) })}
          >
            {intl.formatMessage({ id: "card.handed" }, { when: shortWhen(intl, a.handed_off_at) })}
          </span>
        )}
        {a.status !== "open" && <span className="status-tag">{intl.formatMessage({ id: "card.status" }, { status: a.status })}</span>}
      </div>
      {/* The video time goes at the start of the body (as in Frame.io): the right end of the title row belongs to the action bar on hover
          and would be covered */}
      <div className="card-body">
        {time && (
          <span className="card-time">
            {formatTime(time.start)}
            {time.end !== undefined && `–${formatTime(time.end)}`}
          </span>
        )}
        <Highlight text={a.body} terms={props.terms} />
      </div>
      {a.replies.map((r, i) => (
        <div key={i} className="reply">
          <span className="reply-author">{r.author}</span>
          <Highlight text={r.body} terms={props.terms} />
        </div>
      ))}
      {/* Floats at the right of the title row on hover without growing the row (see .card-actions in styles.css). It holds only Copy for
          AI and the "⋯" button = the context menu; the canvas-marks section adds an eye (its cards have no "Overall" tag, so the right of
          the title row has room). There used to be five buttons (edit, copy, done, won't fix, delete), about 150 wide, which covered the
          category when the notes panel was narrow; they are folded into "⋯" as in the comment panes of Figma and Frame.io */}
      {/* This layer only stops bubbling (a click on a button inside must not count as a click on the card) and is not a control itself;
          the buttons inside are reachable with Tab and activated with Enter / Space; the card's own keyboard handling is in onKeyDown above */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
      <div className="card-actions" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        {props.mark && (
          <button
            className="act act-mark"
            onClick={props.mark.toggle}
            title={intl.formatMessage({ id: props.mark.hidden ? "card.mark.show" : "card.mark.hide" })}
          >
            {props.mark.hidden ? <EyeIcon /> : <EyeOffIcon />}
          </button>
        )}
        <button className="act" onClick={props.onCopy} title={intl.formatMessage({ id: "card.copyTitle" })}>
          <SparkIcon />
        </button>
        <Menu
          trigger={() => <MoreIcon />}
          items={props.menu}
          align="right"
          buttonClass="act"
          title={intl.formatMessage({ id: "card.moreTitle" })}
        />
      </div>
    </div>
  );
}
