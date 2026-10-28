import { useEffect, useId, useRef, type ReactNode } from "react";
import { useIntl } from "react-intl";
import { CloseIcon } from "./icons";
import { useKeys } from "./keys";
import { trapTab, useRestoreFocus } from "./Menu";

/** Confirm dialog: Enter confirms; Esc, the × at the top right and a click outside all cancel */
export function ConfirmDialog(props: {
  title: string;
  body: ReactNode;
  confirm: string;
  /** Text on the cancel button (default: "Cancel") */
  cancel?: string;
  /** Make the confirm button red (remove, clear, delete and the like) */
  danger?: boolean;
  /** Cancel is the default button (it has focus and Enter presses it): for discarding unsaved text, so a hasty Enter loses nothing */
  safeDefault?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const intl = useIntl();
  const ok = useRef<HTMLButtonElement>(null);
  const no = useRef<HTMLButtonElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const tab = (e: KeyboardEvent) => trapTab(box.current, e);
  useKeys(
    { Escape: props.onCancel, Enter: props.safeDefault ? props.onCancel : props.onConfirm, Tab: tab, "Shift+Tab": tab },
    { modal: true },
  );
  useRestoreFocus(overlay);
  useEffect(() => (props.safeDefault ? no : ok).current?.focus(), [props.safeDefault]);
  // Screen readers read the body along with the title (which item is affected, whether it can be undone), not just the title
  const bodyId = useId();
  return (
    <div className="overlay fade-in" ref={overlay} onPointerDown={props.onCancel}>
      <div
        className="confirm"
        ref={box}
        role="alertdialog"
        aria-modal="true"
        aria-label={props.title}
        aria-describedby={bodyId}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="confirm-head">
          <div className="confirm-title">{props.title}</div>
          {/* No tooltip (everyone knows ×, same as Settings); the name is for screen readers */}
          <button className="dialog-close confirm-close" onClick={props.onCancel} aria-label={intl.formatMessage({ id: "dialog.cancel" })}>
            <CloseIcon />
          </button>
        </div>
        <div className="confirm-body" id={bodyId}>
          {props.body}
        </div>
        <div className="confirm-actions">
          <button ref={no} className="btn btn-secondary" onClick={props.onCancel}>
            {props.cancel ?? intl.formatMessage({ id: "dialog.cancel" })}
          </button>
          <button ref={ok} className={`btn ${props.danger ? "btn-danger-soft" : "btn-primary"}`} onClick={props.onConfirm}>
            {props.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
