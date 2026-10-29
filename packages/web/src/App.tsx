import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IntlProvider, useIntl } from "react-intl";
import { BootError, ErrorBoundary } from "./ErrorBoundary";
import { call, inHost, logError, onHostEvent, platform, type AppInfo } from "./host";
import { loadMessages, resolveLocale, SOURCE_LOCALE } from "./i18n";
import { macifyMessages } from "./macKeys";
import { AlertIcon, CloseIcon } from "./icons";
import { useKeys } from "./keys";
import { mergePrefs, PrefsContext, storedPrefs, type Prefs } from "./prefs";
import { SECTIONS, SettingsDialog, type Section } from "./SettingsDialog";
import { ShortcutHelp } from "./ShortcutHelp";
import { Tooltips } from "./Tooltip";
import { WorkspaceView, type Notify } from "./Workspace";

interface ToastState {
  /** text is ready-made text; textId is a message (like labelId, translated by Toast) */
  text?: string;
  textId?: string;
  /**
   * label is ready-made text; labelId is a message (App sits outside IntlProvider and cannot translate, so Toast does it).
   * keep: the toast stays after a click (Open Folder, Open Log: the user keeps looking at the toast after opening)
   */
  action?: { label?: string; labelId?: string; run: () => void; keep?: boolean };
  /** Stays until its button is clicked (notices about data; a flash is easy to miss) */
  sticky?: boolean;
  /** An error: stays, red exclamation mark, a × on the right to close it; screen readers announce it immediately */
  error?: boolean;
  nonce: number;
}

/** Startup notices (settings file was damaged, first launch after the rename): the shell gives them only once (Bridge.TakeStartupNotice),
 * so if the page reloads (a new drive was plugged in, the UI process crashed) before the user clicks OK they would be lost for good;
 * they are kept in session storage first and removed only after the click */
type Notice = { text?: string; textId?: string };
const NOTICES = "sniptoss.startupNotices";
const sameNotice = (a: Notice, b: Notice) => a.text === b.text && a.textId === b.textId;
function pendingNotices(): Notice[] {
  try {
    const v: unknown = JSON.parse(sessionStorage.getItem(NOTICES) ?? "[]");
    return Array.isArray(v) ? (v as Notice[]) : [];
  } catch {
    return [];
  }
}
function savePendingNotices(list: Notice[]) {
  try {
    sessionStorage.setItem(NOTICES, JSON.stringify(list));
  } catch {
    // Cannot be stored (storage full or disabled): shown as usual this time, just gone after a reload
  }
}

/** Whether two toasts say the same thing (the same error arriving repeatedly shows only once) */
const sameText = (a: ToastState, b: ToastState) => a.text === b.text && a.textId === b.textId;

export function App() {
  // Outside the app window (opened in an ordinary browser) there is nothing to read, so it counts as booted from the start with reason
  // null (it used to be set synchronously in an effect, which trips react(set-state-in-effect))
  const [booted, setBooted] = useState(!inHost);
  /** Why the UI cannot start; null = not inside the app window (opened in an ordinary browser) */
  const [error, setError] = useState<string | null | undefined>(inHost ? undefined : null);
  const [help, setHelp] = useState(false);
  /**
   * The page to open while the Settings window is open; at: differs on every request, so an already open Settings also switches (the
   * toast's "Open Settings")
   */
  const [settings, setSettings] = useState<{ section: Section; at: number } | false>(false);
  const openSettings = useCallback((section: Section) => setSettings({ section, at: Date.now() + Math.random() }), []);
  // The shell asks to open a page of Settings (e.g. a click on the tray balloon "capture shortcut could not be enabled");
  // an unknown section opens General
  useEffect(
    () =>
      onHostEvent("openSettings", ({ section }) =>
        openSettings((SECTIONS as readonly string[]).includes(section) ? (section as Section) : "general"),
      ),
    [openSettings],
  );
  const [prefs, setPrefsState] = useState<Prefs>(mergePrefs(null));
  const [appInfo, setAppInfo] = useState<AppInfo>();
  const [toast, setToast] = useState<ToastState>();
  /**
   * Queued "sticky" toasts (about data, needing the user to click OK): other toasts must not push them out.
   * Otherwise, when the settings file was damaged on the first launch after the rename, the rename notice was swallowed;
   * a save-failed toast could also be replaced by a following "undone" toast
   */
  const waiting = useRef<ToastState[]>([]);
  /**
   * The toast being shown (queueing needs it; not computed inside a setState callback: dev StrictMode calls the callback twice and would
   * queue twice)
   */
  const current = useRef<ToastState>(undefined);
  const show = useCallback((next: ToastState) => {
    const cur = current.current;
    // The same toast again (every settings change failed to save): replace the content, don't queue
    if (cur && cur.nonce !== next.nonce && cur.sticky) {
      if (next.sticky) {
        // Sticky toasts: the same sentence (the same error repeating, "settings could not be saved" again) already shown or queued is not
        // queued again; the queued one is replaced by the new one
        if (sameText(cur, next)) return;
        const i = waiting.current.findIndex((w) => w.nonce === next.nonce || sameText(w, next));
        if (i >= 0) waiting.current[i] = next;
        else waiting.current.push(next);
        return;
      }
      waiting.current.unshift(cur); // let this fleeting toast show first, then come back
    }
    if (next.sticky) waiting.current = waiting.current.filter((w) => !sameText(w, next));
    current.current = next;
    setToast(next);
  }, []);
  /** Messages of the current language; nothing is drawn before they load (so Chinese doesn't flash before another language replaces it) */
  const [messages, setMessages] = useState<{ locale: string; messages: Record<string, string> }>();
  /** Notes folder of the current item: used by "Notes location" in the Settings window */
  const [home, setHome] = useState<string>();
  const notify: Notify = useCallback(
    (text, action, opts) =>
      show({
        text,
        // An error has a × to close it, so it gets no OK button
        action: action ?? (opts?.sticky && !opts.error ? { labelId: "app.toast.gotIt", run: () => {} } : undefined),
        sticky: opts?.sticky || opts?.error,
        error: opts?.error,
        nonce: Date.now() + Math.random(),
      }),
    [show],
  );
  const clearToast = useCallback(() => {
    current.current = waiting.current.shift();
    setToast(current.current);
  }, []);

  // Settings: a change takes effect immediately and is written back to the shell's settings.json (only changed items, see storedPrefs).
  // latest: two changes in the same frame don't lose the first; the message is not sent inside a setState callback (dev StrictMode calls it twice)
  const latest = useRef(prefs);
  const setPrefs = useCallback(
    (patch: Partial<Prefs>) => {
      const next = { ...latest.current, ...patch };
      latest.current = next;
      setPrefsState(next);
      // Cannot write the settings file (locked, disk full): say so; otherwise the UI showed the change as saved and the loss surfaced
      // only after a restart
      call("setPrefs", { prefs: storedPrefs(next) }).catch(() =>
        show({ textId: "app.prefs.saveFailed", error: true, sticky: true, nonce: -1 }),
      );
    },
    [show],
  );
  const prefsApi = useMemo(() => ({ prefs, setPrefs }), [prefs, setPrefs]);

  useEffect(() => {
    // Interface size: scales everything; the item itself is handled by ZoomView and unaffected
    (document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom = String(prefs.uiScale);
    // Used by overlays sized to the window in the styles (--vw / --vh in styles.css)
    document.documentElement.style.setProperty("--ui-scale", String(prefs.uiScale));
    document.documentElement.style.setProperty("--mark", prefs.markColor);
  }, [prefs.uiScale, prefs.markColor]);

  useEffect(() => {
    if (!inHost) return;
    Promise.all([call("getPrefs"), call("appInfo")])
      .then(([saved, info]) => {
        latest.current = mergePrefs(saved as Partial<Prefs> | null);
        setPrefsState(latest.current);
        setAppInfo(info);
        // The settings file was damaged and restored from backup: keep the notice until the user sees it (the shell has logged it and kept
        // the bad file); first launch after the rename: say that the notes folder will be renamed automatically (docs/adr/0007-rename.md).
        // When both apply they are queued and shown one by one
        const fresh: Notice[] = [];
        if (info.startupNotice) fresh.push({ text: info.startupNotice });
        if (info.renamedFromPizhu) fresh.push({ textId: "app.toast.renamed" });
        const notices = [...pendingNotices(), ...fresh.filter((n) => !pendingNotices().some((p) => sameNotice(p, n)))];
        savePendingNotices(notices);
        notices.forEach((n, i) =>
          show({
            ...n,
            action: { labelId: "app.toast.gotIt", run: () => savePendingNotices(pendingNotices().filter((p) => !sameNotice(p, n))) },
            sticky: true,
            nonce: 1 + i,
          }),
        );
      })
      .catch((e: Error) => {
        logError("startup", e);
        setError(e.message);
      })
      .finally(() => setBooted(true));
  }, [show]);

  // Interface language: chosen in Settings, or following the Windows display language (docs/adr/0001-i18n.md). A change applies
  // immediately, no restart
  const locale = resolveLocale(prefs.language, appInfo?.systemLanguage ?? navigator.language);
  useEffect(() => {
    if (!booted) return;
    let alive = true;
    loadMessages(locale)
      .then((m) => {
        if (!alive) return;
        document.documentElement.lang = locale;
        // On the Mac the shortcuts written inside the messages are shown with the Mac's symbols (macKeys.ts)
        setMessages({ locale, messages: platform === "mac" ? macifyMessages(m) : m });
      })
      .catch((e) => {
        logError("loading messages", e);
        if (alive) setMessages({ locale: SOURCE_LOCALE, messages: {} });
      });
    return () => {
      alive = false;
    };
  }, [booted, locale]);

  // Tell the shell the UI is usable: after the messages are loaded and the UI is drawn (the shell records the startup time for
  // SNIPTOSS_PERF_LOG and starts on queued work)
  const readySent = useRef(false);
  useEffect(() => {
    if (!messages || readySent.current || !inHost) return;
    readySent.current = true;
    void call("ready").catch((e) => logError("startup", e));
  }, [messages]);

  useKeys(
    {
      "Ctrl+,": () => openSettings("general"),
      "?": () => setHelp(true),
      F1: () => setHelp(true),
    },
    { enabled: error === undefined },
  );

  // When startup fails it still waits for the messages (the error page speaks the current language)
  if (!booted || !messages) return null;
  if (error !== undefined)
    return (
      <IntlProvider locale={messages.locale} messages={messages.messages} defaultLocale={SOURCE_LOCALE}>
        <BootError message={error ?? undefined} />
      </IntlProvider>
    );
  return (
    <IntlProvider
      locale={messages.locale}
      messages={messages.messages}
      defaultLocale={SOURCE_LOCALE}
      onError={(e) => logError("i18n message", e, "warn")}
    >
      <PrefsContext.Provider value={prefsApi}>
        <ErrorBoundary area="workspace" page>
          <WorkspaceView
            appInfo={appInfo}
            onHelp={() => setHelp(true)}
            onSettings={(section) => openSettings((section as Section | undefined) ?? "general")}
            onNotify={notify}
            onHome={setHome}
          />
        </ErrorBoundary>
        {help && (
          <ErrorBoundary area="shortcuts" onClose={() => setHelp(false)}>
            <ShortcutHelp onClose={() => setHelp(false)} />
          </ErrorBoundary>
        )}
        {settings && (
          <ErrorBoundary area="settings" onClose={() => setSettings(false)}>
            <SettingsDialog
              home={home}
              initial={settings.section}
              request={settings.at}
              onClose={() => setSettings(false)}
              onNotify={notify}
            />
          </ErrorBoundary>
        )}
        {toast && <Toast key={toast.nonce} toast={toast} onDone={clearToast} />}
        <Tooltips />
      </PrefsContext.Provider>
    </IntlProvider>
  );
}

function Toast({ toast, onDone }: { toast: ToastState; onDone: () => void }) {
  const intl = useIntl();
  // The timer pauses while the mouse is over the toast or focus is inside it, and restarts after it leaves; it used to vanish on
  // schedule, just as the user went to click its action (easy to hit on a busy machine)
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (toast.sticky || held) return;
    const t = window.setTimeout(onDone, toast.action ? 6000 : 3200);
    return () => clearTimeout(t);
  }, [onDone, toast.action, toast.sticky, held]);
  return (
    <div
      className={`toast${toast.error ? " is-error" : ""}`}
      role={toast.error ? "alert" : "status"}
      aria-live={toast.error ? "assertive" : "polite"}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      {toast.error && (
        <span className="toast-icon">
          <AlertIcon />
        </span>
      )}
      <span>{toast.textId ? intl.formatMessage({ id: toast.textId }) : toast.text}</span>
      {toast.action && (
        <button
          className="toast-action"
          onClick={() => {
            toast.action!.run();
            if (!toast.action!.keep) onDone();
          }}
        >
          {toast.action.labelId ? intl.formatMessage({ id: toast.action.labelId }) : toast.action.label}
        </button>
      )}
      {toast.error && (
        <button className="toast-close" onClick={onDone} title={intl.formatMessage({ id: "app.toast.close" })}>
          <CloseIcon />
        </button>
      )}
    </div>
  );
}
