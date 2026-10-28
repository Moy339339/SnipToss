import { Component, useContext, useId, useRef, type ErrorInfo, type ReactNode, type RefObject } from "react";
import { IntlContext } from "react-intl";
import { APP_NAME_EN } from "./brand";
import { call, inHost, logError } from "./host";
import { useKeys } from "./keys";
import { useDialogFocus } from "./Menu";
import { BareTitleBar } from "./TitleBar";

/**
 * Which part (used in the log, and the key of the message app.area.<area>). app = the outermost layer (toasts, tooltips, a problem with
 * the messages themselves)
 */
export type Area = "app" | "workspace" | "library" | "stage" | "composer" | "panel" | "settings" | "shortcuts" | "intro" | "guide";

interface Props {
  area: Area;
  children: ReactNode;
  /** Try again when the item or scope changes (switching items often fixes it) */
  resetKey?: unknown;
  /**
   * For dialogs (Settings, Keyboard Shortcuts, intro): the error box is placed in the overlay with an extra "Close". Otherwise the
   * error box was laid out behind the main UI, outside the window, while the dialog's state was still open, so pressing Ctrl+, did
   * not mount it again and only a full page reload helped
   */
  onClose?: () => void;
  /** The whole-window level (main UI, outermost): the error page brings its own title bar (see ErrorPage) */
  page?: boolean;
}

interface State {
  error: Error | null;
  key: unknown;
}

/**
 * When one part of the UI fails to render only that part breaks and the rest keeps working, and the error goes to the shell log
 * (a render error anywhere used to blank the whole window). Notes are saved as soon as they are written, so "Reload" loses nothing
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, key: this.props.resetKey };

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey !== state.key ? { key: props.resetKey, error: null } : null;
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    logError(
      `UI error (${this.props.area})`,
      Object.assign(error, { stack: `${error.stack ?? ""}\nComponent stack: ${info.componentStack ?? ""}` }),
    );
  }

  render() {
    if (!this.state.error) return this.props.children;
    const { area, onClose } = this.props;
    const retry = () => this.setState({ error: null });
    if (onClose) return <ErrorDialog area={area} onRetry={retry} onClose={onClose} />;
    if (this.props.page)
      return (
        <ErrorPage>
          <ErrorBox area={area} onRetry={retry} extra={<LogsButton />} />
        </ErrorPage>
      );
    return <ErrorBox area={area} onRetry={retry} />;
  }
}

/**
 * Messages; when IntlProvider itself has a problem (the outermost error page) fall back to English: the user's language is unknown and
 * English is the most widely understood
 */
function useT() {
  const intl = useContext(IntlContext);
  return (id: string, fallback: string, values?: Record<string, string>) =>
    intl
      ? intl.formatMessage({ id, defaultMessage: fallback }, values)
      : fallback.replace(/\{(\w+)\}/g, (_, k: string) => values?.[k] ?? "");
}

/** Error box: which part failed, that all notes are saved, and the "Reload" and "Retry" buttons; extra comes after them (Close, Open Log Folder) */
function ErrorBox(props: {
  area: Area;
  onRetry: () => void;
  dialog?: boolean;
  boxRef?: RefObject<HTMLDivElement | null>;
  extra?: ReactNode;
}) {
  const t = useT();
  const titleId = useId();
  const bodyId = useId();
  // Destructure props first: props carries a ref (boxRef), so the whole props object is treated as a value containing a ref, and reading
  // props.dialog is reported as reading a ref during render
  const { area, dialog, boxRef } = props;
  return (
    <div
      ref={boxRef}
      className={`error-boundary${dialog ? " is-dialog" : ""}`}
      role={dialog ? "alertdialog" : "alert"}
      aria-modal={dialog ? "true" : undefined}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
    >
      <div className="error-boundary-title" id={titleId}>
        {t("app.errorBoundary.title", "An error occurred in the {area}", { area: t(`app.area.${area}`, area) })}
      </div>
      <p id={bodyId}>{t("app.errorBoundary.body", "The error has been logged. All notes are saved, so reloading won't lose anything.")}</p>
      <div className="error-boundary-actions">
        <button className="btn btn-primary" onClick={() => location.reload()}>
          {t("app.errorBoundary.reload", "Reload")}
        </button>
        <button className="btn btn-secondary" onClick={props.onRetry}>
          {t("app.errorBoundary.retry", "Retry")}
        </button>
        {props.extra}
      </div>
    </div>
  );
}

/**
 * An error inside a dialog: the error box acts as a dialog itself, like the confirm dialog: focus moves in (onto "Close"), Tab does not
 * escape behind it, shortcuts behind it do not respond, Esc closes it, and focus returns to where it was.
 * The dialog's own key handling used to disappear together with the part that failed, so Esc did not close it and Delete or N still acted
 * on the UI behind
 */
function ErrorDialog(props: { area: Area; onRetry: () => void; onClose: () => void }) {
  const t = useT();
  const box = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const tab = useDialogFocus(box, () => close.current);
  useKeys({ Escape: props.onClose, Tab: tab, "Shift+Tab": tab }, { modal: true });
  return (
    <div className="overlay fade-in" onPointerDown={props.onClose}>
      <div onPointerDown={(e) => e.stopPropagation()}>
        <ErrorBox
          area={props.area}
          onRetry={props.onRetry}
          dialog
          boxRef={box}
          extra={
            <button ref={close} className="btn btn-secondary" onClick={props.onClose}>
              {t("app.errorBoundary.close", "Close")}
            </button>
          }
        />
      </div>
    </div>
  );
}

/**
 * An error at the whole-window level (main UI, outermost layer, startup failure): the system title bar has been removed, so the error
 * page brings its own title bar (drag, minimize / maximize / close); otherwise the window could not be moved or closed
 * (only a line of text and the "Reload" and "Retry" buttons used to be left)
 */
function ErrorPage(props: { children: ReactNode }) {
  return (
    <div className="error-page">
      {inHost && <BareTitleBar />}
      {props.children}
    </div>
  );
}

function LogsButton() {
  const t = useT();
  return (
    <button className="btn btn-secondary" onClick={() => void call("reveal", { path: "@logs" }).catch(() => {})}>
      {t("menu.help.logs", "Open Log Folder")}
    </button>
  );
}

/** The UI could not start (settings or app info unreadable); no message = not inside the app window (the UI was opened in an ordinary browser) */
export function BootError(props: { message?: string }) {
  const t = useT();
  if (props.message === undefined)
    return (
      <div className="boot-error" role="alert">
        {t("app.boot.notInHost", "Open this page in the {app} window.", { app: t("brand.name", APP_NAME_EN) })}
      </div>
    );
  return (
    <ErrorPage>
      <div className="error-boundary" role="alert">
        <div className="error-boundary-title">{t("app.boot.title", "The interface could not start")}</div>
        <p>{props.message}</p>
        <div className="error-boundary-actions">
          <button className="btn btn-primary" onClick={() => location.reload()}>
            {t("app.errorBoundary.reload", "Reload")}
          </button>
          <LogsButton />
        </div>
      </div>
    </ErrorPage>
  );
}
