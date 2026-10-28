import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useIntl } from "react-intl";
import { CloseIcon } from "./icons";
import { useKeys } from "./keys";
import { useDialogFocus } from "./Menu";

/**
 * A read-only info dialog (shortcut list, Help → Getting Started): a title row with × at the top right, and a content area below that scrolls on its own.
 * Esc, ×, and a press on the backdrop all close it (same as Settings and the confirm dialog: pressing inside the dialog and releasing outside does not close);
 * closeKeys are extra keys that also close it (? and F1 for the list).
 * On open, focus goes into the content area: ↑↓, PageDown, End scroll directly, inputs behind it receive no typing, and Esc does not leak through to what is behind
 */
export function Sheet(props: { title: string; className?: string; closeKeys?: string[]; onClose: () => void; children: ReactNode }) {
  const intl = useIntl();
  const { onClose } = props;
  const box = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const tab = useDialogFocus(box, () => scroller.current);
  useKeys(
    { Escape: onClose, ...Object.fromEntries((props.closeKeys ?? []).map((k) => [k, onClose])), Tab: tab, "Shift+Tab": tab },
    { modal: true },
  );
  const more = useMoreBelow(scroller);
  const titleId = useId();
  return (
    <div className="overlay fade-in" onPointerDown={onClose}>
      <div
        ref={box}
        className={`sheet${props.className ? ` ${props.className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* The title row works like the confirm dialog's: × at the top right, on the same center line as the title */}
        <div className="sheet-head">
          <div className="sheet-title" id={titleId}>
            {props.title}
          </div>
          <button className="dialog-close confirm-close" onClick={onClose} aria-label={intl.formatMessage({ id: "dialog.close" })}>
            <CloseIcon />
          </button>
        </div>
        {/* A scrollable content area must be reachable and scrollable by keyboard too (WCAG 2.1.1) */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
        <div ref={scroller} className={`sheet-scroll${more.on ? " has-more" : ""}`} tabIndex={0} onScroll={more.check}>
          {props.children}
        </div>
      </div>
    </div>
  );
}

/** There is more below: fade the bottom edge to show it can still scroll (the scrollbar is hidden normally, and a hard cut-off would not hint at it); re-evaluated when the window resizes */
function useMoreBelow(scroller: React.RefObject<HTMLDivElement | null>) {
  const [on, setOn] = useState(false);
  const check = () => {
    const el = scroller.current;
    if (el) setOn(el.scrollTop + el.clientHeight < el.scrollHeight - 1);
  };
  useLayoutEffect(() => {
    check();
    const ro = new ResizeObserver(check);
    ro.observe(scroller.current!);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return { on, check };
}
