import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useIntl } from "react-intl";
import { CATEGORIES, DATA_DIR, type MaterialKind } from "@sniptoss/core";
import { APP_VERSION, AUTHOR, HOMEPAGE, IS_BETA, LICENSE_NAME, LICENSE_URL, shortTime, UI_BUILT, versionLabel } from "./brand";
import { call, homeJoin, platform, type AppInfo, type CaptureSettings, type HostError } from "./host";
import { ConfirmDialog } from "./Confirm";
import { copyDiagnostics, reportIssue } from "./diagnostics";
import { AVAILABLE_LOCALES, LOCALE_NAMES, NEEDS_REVIEW, resolveLocale } from "./i18n";
import { ChevronIcon, CloseIcon } from "./icons";
import { useKeys } from "./keys";
import { Menu, trapTab, useRestoreFocus } from "./Menu";
import { hotkeyFrom, hotkeyParts, keycaps, prettyKeys } from "./hotkey";
import { colorName } from "./markColors";
import { parseNotices, type Notice } from "./notices";
import { DEFAULT_PREFS, MARK_COLORS, NOT_SETTINGS, usePrefs, type Prefs } from "./prefs";
import { Sheet } from "./Sheet";
import { SHORTCUT_GROUPS, ShortcutRow, shortcutKey } from "./ShortcutHelp";
import { Wordmark } from "./Wordmark";

// The Settings window: what ordinary users need goes on the first pages, and anything that can be decided automatically is not listed (a snapshot is generated for every note),
// while expert options are tucked into "Advanced"; tray and launch at startup live under "General". Copy follows docs/design-rules.md, section 6 (copy), and always goes through messages

export type Section = "general" | "annotate" | "capture" | "ai" | "system" | "keys" | "advanced" | "about";

export const SECTIONS: readonly Section[] = ["general", "annotate", "capture", "ai", "system", "keys", "advanced", "about"];

/** The messages of this page: settings.<page>.<item> */
function useT() {
  const intl = useIntl();
  return (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
}

/** The Settings window. Changes take effect and are saved immediately; there is no OK button */
export function SettingsDialog(props: {
  /** The notes folder of the current item */
  home?: string;
  onClose: () => void;
  onNotify: (text: string) => void;
  /** Which page to show first when opened (menu "Help → About", etc.) */
  initial?: Section;
  /** Differs on every open request: when Settings is already open and asked to open again (the toast's "Open Settings"), switch to the initial page */
  request?: number;
}) {
  const [section, setSection] = useState<Section>(props.initial && SECTIONS.includes(props.initial) ? props.initial : "general");
  // Asked to open again (initial / request changed): switch to that page by comparing with the previous render during rendering (the React docs' "adjusting state based on the previous render" pattern, same as panelScope.ts; an effect would render one extra time)
  const [seenAsk, setSeenAsk] = useState({ initial: props.initial, request: props.request });
  if (props.initial !== seenAsk.initial || props.request !== seenAsk.request) {
    setSeenAsk({ initial: props.initial, request: props.request });
    if (props.initial && SECTIONS.includes(props.initial)) setSection(props.initial);
  }
  // While recording a shortcut, Esc means "cancel recording", not close Settings
  const [recording, setRecording] = useState(false);
  /** The "Restore Defaults" confirm dialog is open: Esc and Enter belong to it */
  const [confirmReset, setConfirmReset] = useState(false);
  /** About → Third-party notices is open: Esc closes only that */
  const [notices, setNotices] = useState(false);
  const { setPrefs } = usePrefs();
  const t = useT();
  // Keyboard focus: on open it goes into the dialog (the current tab), Tab cycles only inside, and closing returns to where it was (same as the confirm dialog and context menu)
  const overlay = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDivElement>(null);
  useRestoreFocus(overlay);
  useEffect(() => dialog.current?.querySelector<HTMLElement>(".settings-tab.is-on")?.focus(), []);
  const tab = (e: KeyboardEvent) => trapTab(dialog.current, e);
  useKeys({ Escape: props.onClose, Tab: tab, "Shift+Tab": tab }, { modal: true, enabled: !recording && !confirmReset && !notices });

  return (
    <div className="overlay fade-in" ref={overlay} onPointerDown={props.onClose}>
      <div
        className="settings"
        ref={dialog}
        onPointerDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={t("settings.title")}
      >
        <nav className="settings-nav">
          <div className="settings-title">{t("settings.title")}</div>
          {SECTIONS.map((s) => (
            <button key={s} className={`settings-tab${s === section ? " is-on" : ""}`} onClick={() => setSection(s)}>
              {t(`settings.${s}.title`)}
            </button>
          ))}
          <div className="settings-nav-foot muted">{t("settings.applyNow")}</div>
        </nav>
        {/* × sits on the dialog, not inside the scrolling content area, so it does not move when the content scrolls. No tooltip (everyone knows ×); the name is for screen readers */}
        <button className="dialog-close settings-close" onClick={props.onClose} aria-label={t("settings.close")}>
          <CloseIcon />
        </button>
        <div className="settings-body">
          {section === "general" && <General home={props.home} onNotify={props.onNotify} />}
          {section === "annotate" && <Annotate />}
          {section === "capture" && <Capture onNotify={props.onNotify} onRecording={setRecording} />}
          {section === "ai" && <Ai />}
          {section === "system" && <System onNotify={props.onNotify} />}
          {section === "keys" && <Keys />}
          {section === "advanced" && <Advanced onNotify={props.onNotify} onReset={() => setConfirmReset(true)} />}
          {section === "about" && <About onNotify={props.onNotify} onNotices={() => setNotices(true)} />}
        </div>
        {/* Rendered into body (the settings box has an animated transform, and a fixed overlay inside it would move with it); React events still pass through the settings box, so clicking outside it does not close Settings */}
        {confirmReset &&
          createPortal(
            <ConfirmDialog
              title={t("settings.reset.title")}
              body={t("settings.reset.body")}
              confirm={t("settings.reset.confirm")}
              danger
              onConfirm={() => {
                setConfirmReset(false);
                // Remembered state (which new files have been seen) is not a setting and is left alone
                setPrefs(Object.fromEntries(Object.entries(DEFAULT_PREFS).filter(([k]) => !NOT_SETTINGS.includes(k as keyof Prefs))));
                props.onNotify(t("settings.reset.done"));
              }}
              onCancel={() => setConfirmReset(false)}
            />,
            document.body,
          )}
        {notices && createPortal(<NoticesSheet onClose={() => setNotices(false)} onNotify={props.onNotify} />, document.body)}
      </div>
    </div>
  );
}

// ---------- Widgets ----------

function Row(props: { label: string; desc?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`set-row${props.wide ? " is-wide" : ""}`}>
      <div className="set-text">
        <div className="set-label">{props.label}</div>
        {props.desc && <div className="set-desc">{props.desc}</div>}
      </div>
      <div className="set-control">{props.children}</div>
    </div>
  );
}

function Switch(props: { on: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      className={`switch${props.on ? " is-on" : ""}`}
      role="switch"
      aria-checked={props.on}
      aria-label={props.label}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.on)}
    >
      <span className="switch-knob" />
    </button>
  );
}

function Choice<T extends string | number>(props: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented">
      {props.options.map((o) => (
        <button key={String(o.value)} className={`seg${o.value === props.value ? " is-on" : ""}`} onClick={() => props.onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Heading(props: { children: ReactNode; desc?: ReactNode }) {
  return (
    <div className="set-heading">
      <h2>{props.children}</h2>
      {props.desc && <p className="muted">{props.desc}</p>}
    </div>
  );
}

/** A group within a page (Advanced): the group name is a subheading, and desc is the explanation shared by the group */
function Group(props: { title: string; desc?: string }) {
  return (
    <div className="set-group">
      <div className="set-group-title">{props.title}</div>
      {props.desc && <div className="set-desc">{props.desc}</div>}
    </div>
  );
}

function Button(props: { onClick: () => void; children: ReactNode; disabled?: boolean; danger?: boolean }) {
  return (
    <button className={`btn btn-secondary btn-small${props.danger ? " btn-danger" : ""}`} onClick={props.onClick} disabled={props.disabled}>
      {props.children}
    </button>
  );
}

/** Reading the shell-side settings failed: say why and offer a retry (otherwise the whole page would be blank and say nothing) */
function LoadError(props: { reason: string; onRetry: () => void }) {
  const t = useT();
  return (
    <>
      <div className="error">{t("settings.loadFailed", { reason: props.reason })}</div>
      <button className="btn btn-secondary btn-small set-retry" onClick={props.onRetry}>
        {t("settings.retry")}
      </button>
    </>
  );
}

/** The settings for Screen Capture, the tray and launch at startup live in the shell (the shortcut and tray are needed right at startup), not in the UI's prefs */
function useCaptureSettings(onNotify: (t: string) => void) {
  const [c, setC] = useState<CaptureSettings>();
  const [loadError, setLoadError] = useState<string>();
  const fetchSettings = useCallback(() => {
    call("captureSettings")
      .then(setC)
      .catch((e: Error) => setLoadError(e.message));
  }, []);
  // Read directly on open (there is no error to clear yet); "Retry" clears the previous error first and then reads. Do not call setState synchronously in an effect (react(set-state-in-effect))
  const load = useCallback(() => {
    setLoadError(undefined);
    fetchSettings();
  }, [fetchSettings]);
  useEffect(fetchSettings, [fetchSettings]);
  const save = async (patch: Partial<Omit<CaptureSettings, "hotkeyError" | "hotkeyTypes" | "hotkeyMoved" | "defaultFolder">>) => {
    try {
      setC(await call("setCaptureSettings", patch));
      window.dispatchEvent(new Event("sniptoss:capture-settings")); // The shortcut shown on the title bar and menus follows
    } catch (e) {
      onNotify((e as Error).message);
    }
  };
  return { c, loadError, load, save };
}

/** The app's version and paths (Advanced and About pages); a failed read says why and offers a retry (otherwise it would show "…" forever) */
function useAppInfo() {
  const [info, setInfo] = useState<AppInfo>();
  const [error, setError] = useState<string>();
  const fetchInfo = useCallback(() => {
    call("appInfo")
      .then(setInfo)
      .catch((e: Error) => setError(e.message));
  }, []);
  // Same as useCaptureSettings: read directly on open; only "Retry" clears the previous error first
  const load = useCallback(() => {
    setError(undefined);
    fetchInfo();
  }, [fetchInfo]);
  useEffect(fetchInfo, [fetchInfo]);
  return { info, error, load };
}

/** Show in File Explorer: say missing when the folder has not been created yet, and report other causes (File Explorer cannot start, access denied) as they are, instead of always saying it does not exist */
function reveal(path: string, missing: string, onNotify: (t: string) => void) {
  return call("reveal", { path }).catch((e: HostError) => onNotify(e.code === "notFound" ? missing : e.message));
}

/**
 * Interface language (Settings → General, ADR-0001 item 6): "Follow system" says which language it currently resolves to, followed by the languages that have messages, each named in its own language.
 * A change takes effect immediately (UI, tray, capture overlay); the REVIEW.md of existing projects does not change with it (it remembers its own language)
 */
function LanguagePicker() {
  const t = useT();
  const { prefs, setPrefs } = usePrefs();
  const { info } = useAppInfo();
  const system = resolveLocale("system", info?.systemLanguage ?? navigator.language);
  const current = (AVAILABLE_LOCALES as readonly string[]).includes(prefs.language) ? prefs.language : "system";
  const options = [
    { value: "system", label: t("settings.general.languageSystem", { name: LOCALE_NAMES[system] }), lang: undefined },
    ...AVAILABLE_LOCALES.map((l) => ({ value: l as string, label: LOCALE_NAMES[l], lang: l })),
  ];
  const label = options.find((o) => o.value === current)?.label ?? options[0].label;
  return (
    <Menu
      align="left"
      buttonClass="btn btn-secondary btn-small set-select"
      trigger={() => (
        <>
          <span lang={options.find((o) => o.value === current)?.lang}>{label}</span>
          <ChevronIcon />
        </>
      )}
      items={options.map((o) => ({
        label: o.label,
        checked: o.value === current,
        radio: true,
        onClick: () => setPrefs({ language: o.value }),
      }))}
    />
  );
}

/** The description for the items that write to the registry (launch at startup, context menu): in the portable build a separate line says why they are unavailable (the switch is grayed out) */
function RegistryDesc(props: { desc: string; portable: boolean }) {
  const t = useT();
  return (
    <>
      {props.desc}
      {props.portable && <span className="set-desc-line">{t("settings.portable.unavailable")}</span>}
    </>
  );
}

// ---------- Sections ----------

function General(props: { home?: string; onNotify: (t: string) => void }) {
  const t = useT();
  const locale = useIntl().locale;
  const { prefs, setPrefs } = usePrefs();
  const capture = useCaptureSettings(props.onNotify);
  const portable = useAppInfo().info?.portable === true;
  const dataDir = props.home ? homeJoin(props.home, DATA_DIR) : undefined;
  return (
    <>
      <Heading>{t("settings.general.title")}</Heading>
      <Row
        label={t("settings.general.language")}
        desc={
          <>
            {t("settings.general.languageDesc")}
            {/* Second-tier languages have not been reviewed by native speakers yet: say so and welcome corrections (ADR-0001 item 4) */}
            {(NEEDS_REVIEW as readonly string[]).includes(locale) && (
              <span className="set-desc-line">{t("settings.general.languageReview")}</span>
            )}
          </>
        }
      >
        <LanguagePicker />
      </Row>
      <Row label={t("settings.general.uiScale")} desc={t("settings.general.uiScaleDesc")}>
        <Choice
          value={prefs.uiScale}
          options={[0.9, 1, 1.1, 1.25].map((v) => ({ value: v, label: `${Math.round(v * 100)}%` }))}
          onChange={(v) => setPrefs({ uiScale: v })}
        />
      </Row>
      <Row label={t("settings.general.backdrop")} desc={t("settings.general.backdropDesc")}>
        <Choice
          value={prefs.backdrop}
          options={[
            { value: "blur", label: t("settings.general.backdropBlur") },
            { value: "plain", label: t("settings.general.backdropPlain") },
          ]}
          onChange={(v) => setPrefs({ backdrop: v })}
        />
      </Row>
      {capture.loadError ? (
        <LoadError reason={capture.loadError} onRetry={capture.load} />
      ) : (
        capture.c && (
          <>
            <Row label={t("settings.general.tray")} desc={t("settings.general.trayDesc")}>
              <Switch on={capture.c.keepInTray} onChange={(v) => void capture.save({ keepInTray: v })} />
            </Row>
            <Row
              label={t("settings.general.autostart")}
              desc={<RegistryDesc desc={t("settings.general.autostartDesc")} portable={portable} />}
            >
              <Switch on={capture.c.autostart} disabled={portable} onChange={(v) => void capture.save({ autostart: v })} />
            </Row>
          </>
        )
      )}
      {/* Check for updates (app/Updates.cs): the app goes online only here, so it is its own item and says what it checks (About → Privacy says so too) */}
      <Row label={t("settings.general.updateCheck")} desc={t("settings.general.updateCheckDesc")}>
        <Switch on={prefs.updateCheck} onChange={(v) => setPrefs({ updateCheck: v })} />
      </Row>{" "}
      <Row label={t("settings.general.initialSelect")}>
        <Choice
          value={prefs.initialSelect}
          options={[
            { value: "first", label: t("settings.general.initialFirst") },
            { value: "firstOpen", label: t("settings.general.initialOpen") },
          ]}
          onChange={(v) => setPrefs({ initialSelect: v })}
        />
      </Row>
      <Row
        label={t("settings.general.storage")}
        desc={
          <>
            {t("settings.general.storageDesc")}
            <br />
            {dataDir ? <code>{dataDir}</code> : t("settings.general.storageNone")}
          </>
        }
      >
        <Button disabled={!dataDir} onClick={() => void reveal(dataDir!, t("settings.general.storageMissing"), props.onNotify)}>
          {t("settings.reveal")}
        </Button>
      </Row>
    </>
  );
}

function Annotate() {
  const t = useT();
  const intl = useIntl();
  const { prefs, setPrefs } = usePrefs();
  return (
    <>
      <Heading>{t("settings.annotate.title")}</Heading>
      <Row label={t("settings.annotate.category")} desc={t("settings.annotate.categoryDesc")}>
        <Choice
          value={prefs.defaultCategory}
          options={CATEGORIES.map((c) => ({ value: c, label: t(`category.${c}`) }))}
          onChange={(v) => setPrefs({ defaultCategory: v })}
        />
      </Row>
      <Row label={t("settings.annotate.autoCompose")} desc={t("settings.annotate.autoComposeDesc")}>
        <Switch on={prefs.autoCompose} onChange={(v) => setPrefs({ autoCompose: v })} />
      </Row>
      <Row label={t("settings.annotate.pause")} desc={t("settings.annotate.pauseDesc")}>
        <Switch on={prefs.pauseOnAnnotate} onChange={(v) => setPrefs({ pauseOnAnnotate: v })} />
      </Row>
      <Row label={t("settings.annotate.loop")} desc={t("settings.annotate.loopDesc")}>
        <Switch on={prefs.loop} onChange={(v) => setPrefs({ loop: v })} />
      </Row>
      <Row label={t("settings.annotate.showResolved")} desc={t("settings.annotate.showResolvedDesc")}>
        <Switch on={prefs.showResolved} onChange={(v) => setPrefs({ showResolved: v })} />
      </Row>
      <Row label={t("settings.annotate.color")} desc={t("settings.annotate.colorDesc")}>
        <div className="swatches">
          {MARK_COLORS.map((c) => (
            <button
              key={c}
              className={`swatch${prefs.markColor === c ? " is-on" : ""}`}
              style={{ background: c }}
              onClick={() => setPrefs({ markColor: c })}
              aria-label={colorName(intl, c)}
              data-tip={colorName(intl, c)}
            />
          ))}
        </div>
      </Row>
      <Row label={t("settings.annotate.width")}>
        <Choice
          value={prefs.markWidth}
          options={[
            { value: 1.5, label: t("settings.annotate.widthThin") },
            { value: 2, label: t("settings.annotate.widthMedium") },
            { value: 3, label: t("settings.annotate.widthThick") },
          ]}
          onChange={(v) => setPrefs({ markWidth: v })}
        />
      </Row>
    </>
  );
}

function Capture(props: { onNotify: (t: string) => void; onRecording: (on: boolean) => void }) {
  const t = useT();
  const { c, loadError, load, save } = useCaptureSettings(props.onNotify);
  const pickFolder = async () => {
    try {
      const path = await call("pickFolder", { title: t("settings.capture.pickFolder") });
      if (path) await save({ folder: path });
    } catch (e) {
      props.onNotify((e as Error).message);
    }
  };
  if (loadError)
    return (
      <>
        <Heading>{t("settings.capture.title")}</Heading>
        <LoadError reason={loadError} onRetry={load} />
      </>
    );
  if (!c) return null;
  const folder = c.folder || c.defaultFolder;
  const openAccess = async () => {
    try {
      await call("openScreenAccessSettings");
    } catch (e) {
      props.onNotify((e as Error).message);
    }
  };
  return (
    <>
      <Heading desc={t("settings.capture.desc")}>{t("settings.capture.title")}</Heading>
      {/* Mac only: macOS must allow the app to record the screen before any capture starts */}
      {c.screenAccess !== undefined && (
        <Row
          label={t("settings.capture.access")}
          desc={
            c.screenAccess ? (
              t("settings.capture.accessOn")
            ) : (
              <span className="text-warn">{t("settings.capture.accessOff", { app: t("brand.name") })}</span>
            )
          }
        >
          {!c.screenAccess && <Button onClick={() => void openAccess()}>{t("settings.capture.openAccess")}</Button>}
        </Row>
      )}
      <Row
        label={t("settings.capture.hotkey")}
        desc={
          c.hotkeyError ? (
            <span className="text-danger">{c.hotkeyError}</span>
          ) : c.hotkeyTypes ? (
            // A recorded combination types a character on an installed keyboard layout (AltGr = Ctrl+Alt): it is used anyway, but the text says which character it blocks
            <span className="text-warn">
              {t("settings.capture.hotkeyTypes", { keys: keycaps(prettyKeys(c.hotkey), t), typed: c.hotkeyTypes })}
            </span>
          ) : (
            <>
              {t("settings.capture.hotkeyDesc")} {t("settings.capture.hotkeyConflict")}
            </>
          )
        }
      >
        <HotkeyInput value={c.hotkey} onChange={(v) => void save({ hotkey: v })} onRecording={props.onRecording} />
      </Row>
      <Row label={t("settings.capture.hide")} desc={t("settings.capture.hideDesc")}>
        <Switch on={c.hideWindow} onChange={(v) => void save({ hideWindow: v })} />
      </Row>
      <Row label={t("settings.capture.notes")} desc={t("settings.capture.notesDesc")}>
        <Switch on={c.notesInImage} onChange={(v) => void save({ notesInImage: v })} />
      </Row>
      <Row
        label={t("settings.capture.folder")}
        desc={
          <>
            <code>{folder}</code>
            {c.folder ? "" : t("settings.capture.folderDefault")}
          </>
        }
      >
        <div className="set-actions">
          <Button onClick={() => void pickFolder()}>{t("settings.capture.change")}</Button>
          {c.folder && <Button onClick={() => void save({ folder: "" })}>{t("settings.capture.reset")}</Button>}
          <Button onClick={() => void reveal(folder, t("settings.capture.folderMissing"), props.onNotify)}>{t("settings.open")}</Button>
        </div>
      </Row>
    </>
  );
}

/** Shortcut recording box: click to start recording, and pressing a combination saves it */
function HotkeyInput(props: { value: string; onChange: (v: string) => void; onRecording: (on: boolean) => void }) {
  const t = useT();
  const [recording, setRecording] = useState(false);
  /** An unusable combination was pressed while recording: say so in the box and keep waiting */
  const [hint, setHint] = useState<string>();
  // Clear the previous hint when recording starts / ends: by comparing with the previous render during rendering (the React docs' "adjusting state based on the previous render" pattern, same as panelScope.ts; an effect is not used)
  const [seenRecording, setSeenRecording] = useState(recording);
  if (recording !== seenRecording) {
    setSeenRecording(recording);
    setHint(undefined);
  }
  const button = useRef<HTMLButtonElement>(null);
  // The callback is new on every render, so go through an Effect Event to get the latest one: while recording, a parent re-render must not repeatedly stop / restart the shortcut (writing it into a ref during render violates react(refs))
  const emitChange = useEffectEvent((v: string) => props.onChange(v));
  const emitRecording = useEffectEvent((on: boolean) => props.onRecording(on));
  // On the Mac the rule is "needs Command or Control", and the text says that
  const shiftOnlyText = useEffectEvent(() => t(platform === "mac" ? "settings.hotkey.needsCommand" : "settings.hotkey.shiftOnly"));
  // layout effect: attach the listeners right at the click. A regular effect waits until this frame is painted, and the first key pressed right after the click would be missed (inevitable when the machine is busy)
  useLayoutEffect(() => {
    emitRecording(recording);
    if (!recording) return;
    void call("captureHotkeyPause", { pause: true });
    const down = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === "Escape") return setRecording(false);
      if (e.key === "Backspace" || e.key === "Delete") {
        emitChange("");
        return setRecording(false);
      }
      // The system takes PrintScreen on key down first and the page only receives the release: handle it in up
      if (e.code === "PrintScreen") return;
      record(e);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "PrintScreen") return;
      e.preventDefault();
      record(e);
    };
    const record = (e: KeyboardEvent) => {
      const hotkey = hotkeyFrom(e);
      // Only modifier keys were pressed, or no modifier was included: keep waiting
      if (hotkey === undefined) return;
      if (hotkey === "shiftOnly") return setHint(shiftOnlyText());
      emitChange(hotkey);
      setRecording(false);
    };
    // Clicking elsewhere or switching to another app = no change (if you opened it and changed your mind, clicking anywhere cancels)
    const outside = (e: PointerEvent) => {
      if (!button.current?.contains(e.target as Node)) setRecording(false);
    };
    const blur = () => setRecording(false);
    window.addEventListener("keydown", down, true);
    window.addEventListener("keyup", up, true);
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down, true);
      window.removeEventListener("keyup", up, true);
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("blur", blur);
      void call("captureHotkeyPause", { pause: false });
    };
  }, [recording]);
  return (
    <button
      ref={button}
      className={`hotkey-input${recording ? " is-recording" : ""}`}
      onClick={() => setRecording((r) => !r)}
      title={recording ? t("settings.hotkey.recordingTitle") : t("settings.hotkey.title")}
    >
      {recording ? (
        <span className={hint ? "text-danger" : "muted"}>{hint ?? t("settings.hotkey.recording")}</span>
      ) : props.value ? (
        hotkeyParts(props.value).map((k) => <kbd key={k}>{keycaps(k, t)}</kbd>)
      ) : (
        <span className="muted">{t("settings.hotkey.none")}</span>
      )}
    </button>
  );
}

function Ai() {
  const t = useT();
  const { prefs, setPrefs } = usePrefs();
  return (
    <>
      <Heading
        desc={
          <>
            {t("settings.ai.desc")}
            <br />
            {/* There is a single rule for the copy scope, worded the same as in shortcuts.md and design.md */}
            {t("settings.ai.scope")}
          </>
        }
      >
        {t("settings.ai.title")}
      </Heading>
      <Row label={t("settings.ai.extra")} wide desc={t("settings.ai.extraDesc")}>
        <textarea
          name="prompt-extra"
          className="text-area"
          rows={3}
          value={prefs.promptExtra}
          onChange={(e) => setPrefs({ promptExtra: e.target.value })}
          spellCheck={false}
          placeholder={t("settings.ai.extraPlaceholder")}
        />
      </Row>
    </>
  );
}

function System(props: { onNotify: (t: string) => void }) {
  const t = useT();
  const [shell, setShell] = useState<boolean>();
  const [loadError, setLoadError] = useState<string>();
  const portable = useAppInfo().info?.portable === true;
  // A failed read: say why and offer a retry, with no switches shown (otherwise the switches would sit at "off" and stay clickable)
  const fetchShell = useCallback(() => {
    call("shellIntegration")
      .then(setShell)
      .catch((e: Error) => setLoadError(e.message));
  }, []);
  // Same as useCaptureSettings: read directly on open; only "Retry" clears the previous error first
  const load = useCallback(() => {
    setLoadError(undefined);
    fetchShell();
  }, [fetchShell]);
  useEffect(fetchShell, [fetchShell]);
  // Report by the result read back, not by the click (when the registry write did not take, the switch springs back, instead of still saying "added")
  const toggleShell = async (on: boolean) => {
    try {
      await call("setShellIntegration", { enable: on });
      const now = await call("shellIntegration");
      setShell(now);
      props.onNotify(t(now !== on ? "settings.shell.notApplied" : now ? "settings.system.shellAdded" : "settings.system.shellRemoved"));
    } catch (e) {
      props.onNotify((e as Error).message);
    }
  };
  return (
    <>
      <Heading desc={t("settings.system.desc")}>{t("settings.system.title")}</Heading>
      {loadError ? (
        <LoadError reason={loadError} onRetry={load} />
      ) : (
        shell !== undefined && (
          <Row
            label={t("settings.system.shell")}
            desc={<RegistryDesc desc={t("settings.system.shellDesc", { app: t("brand.name") })} portable={portable} />}
          >
            <Switch on={shell} disabled={portable} onChange={toggleShell} />
          </Row>
        )
      )}
      <Row label={t("settings.system.drop")} desc={t("settings.system.dropDesc")}>
        <span className="muted">{t("settings.system.dropOn")}</span>
      </Row>
    </>
  );
}

function Keys() {
  const t = useT();
  return (
    <>
      <Heading desc={t("settings.keys.desc")}>{t("settings.keys.title")}</Heading>
      <div className="keys-grid">
        {SHORTCUT_GROUPS.map((g) => (
          <section key={g.title}>
            <div className="section-label">{t(g.title)}</div>
            {g.items.map(([keys, label]) => (
              <ShortcutRow key={shortcutKey(label)} keys={keys} label={label} />
            ))}
          </section>
        ))}
      </div>
    </>
  );
}

function Advanced(props: { onNotify: (t: string) => void; onReset: () => void }) {
  const t = useT();
  const { prefs, setPrefs } = usePrefs();
  const { info, error: infoError, load: loadInfo } = useAppInfo();
  const [draft, setDraft] = useState("");
  const act = (p: Promise<unknown>) => p.catch((e: Error) => props.onNotify(e.message));
  // PDF and PPT do not appear until they can be annotated (otherwise turning them on would only list rows that are useless once opened); the shell does not scan them either
  const kinds: { kind: MaterialKind; ext: string }[] = [
    { kind: "image", ext: "png jpg webp gif svg bmp avif" },
    { kind: "video", ext: "mp4 webm mov m4v" },
  ];
  // Compare by name (case-insensitive, like the shell's scan): ones with a path can never match, so they are rejected; names differing only in case count as duplicates
  const addDir = () => {
    const name = draft.trim();
    if (/[\\/]/.test(name)) return props.onNotify(t("settings.skipDirs.noPath"));
    if (name && !prefs.skipDirs.some((d) => d.toLowerCase() === name.toLowerCase())) setPrefs({ skipDirs: [...prefs.skipDirs, name] });
    setDraft("");
  };
  return (
    <>
      <Heading desc={t("settings.advanced.desc")}>{t("settings.advanced.title")}</Heading>
      {infoError && <LoadError reason={infoError} onRetry={loadInfo} />}

      <Group title={t("settings.advanced.notes")} />
      <Row
        label={t("settings.advanced.author")}
        desc={t("settings.advanced.authorDesc", { name: info ? t("settings.advanced.authorName", { name: info.userName }) : "" })}
      >
        <input
          name="author"
          className="text-input"
          value={prefs.author}
          placeholder={info?.userName ?? "user"}
          onChange={(e) => setPrefs({ author: e.target.value })}
          spellCheck={false}
        />
      </Row>
      <Row label={t("settings.advanced.hold")} desc={t("settings.advanced.holdDesc")}>
        <Switch on={prefs.holdTools} onChange={(v) => setPrefs({ holdTools: v })} />
      </Row>

      <Group title={t("settings.advanced.list")} desc={t("settings.advanced.listDesc")} />
      {kinds.map((k) => (
        <Row key={k.kind} label={t(`settings.advanced.kind.${k.kind}`)} desc={k.ext}>
          <Switch on={prefs.kinds[k.kind]} onChange={(v) => setPrefs({ kinds: { ...prefs.kinds, [k.kind]: v } })} />
        </Row>
      ))}
      <Row label={t("settings.advanced.kind.more")} desc={t("settings.advanced.kind.moreDesc", { exts: "tiff heic ico apng jfif mkv" })}>
        <Switch on={prefs.moreFormats} onChange={(v) => setPrefs({ moreFormats: v })} />
      </Row>
      <Row label={t("settings.advanced.skip")} desc={t("settings.skipDirs.desc")} wide>
        <div className="chips">
          {prefs.skipDirs.map((d) => (
            <span key={d} className="chip-tag">
              {d}
              <button
                onClick={() => setPrefs({ skipDirs: prefs.skipDirs.filter((x) => x !== d) })}
                aria-label={t("settings.advanced.skipRemove", { name: d })}
              >
                ×
              </button>
            </span>
          ))}
          <input
            name="skip-folder"
            className="text-input chip-input"
            value={draft}
            placeholder={t("settings.advanced.skipPlaceholder")}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addDir()}
            spellCheck={false}
          />
        </div>
      </Row>

      <Group title={t("settings.advanced.files")} />
      <Row label={t("settings.advanced.review")} desc={t("settings.advanced.reviewDesc")}>
        <Switch on={prefs.reviewIncludeResolved} onChange={(v) => setPrefs({ reviewIncludeResolved: v })} />
      </Row>
      <Row label={t("settings.advanced.shotSize")} desc={t("settings.advanced.shotSizeDesc", { dir: `${DATA_DIR}/snapshots/` })}>
        <Choice
          value={prefs.snapshotMax}
          options={[
            { value: 1280, label: "1280" },
            { value: 1600, label: "1600" },
            { value: 2048, label: "2048" },
            { value: 0, label: t("settings.advanced.shotOriginal") },
          ]}
          onChange={(v) => setPrefs({ snapshotMax: v })}
        />
      </Row>
      <Row label={t("settings.advanced.shotFormat")} desc={t("settings.advanced.shotFormatDesc")}>
        <Choice
          value={prefs.snapshotFormat}
          options={[
            { value: "png", label: "PNG" },
            { value: "jpeg", label: "JPEG" },
          ]}
          onChange={(v) => setPrefs({ snapshotFormat: v })}
        />
      </Row>

      <Group title={t("settings.advanced.debug")} />
      <Row label={t("settings.advanced.settingsFile")} desc={info?.settingsPath}>
        <Button onClick={() => act(call("reveal", { path: "@settings" }))}>{t("settings.reveal")}</Button>
      </Row>
      <Row label={t("settings.advanced.appPath")} desc={info?.exe}>
        <Button onClick={() => act(call("reveal", { path: "@app" }))}>{t("settings.reveal")}</Button>
      </Row>
      <Row label={t("settings.advanced.logs")} desc={info?.logDir}>
        <Button onClick={() => act(call("reveal", { path: "@logs" }))}>{t("settings.open")}</Button>
      </Row>
      <Row label={t("settings.advanced.devTools")} desc={t("settings.advanced.devToolsDesc")}>
        <Button onClick={() => act(call("openDevTools"))}>{t("settings.open")}</Button>
      </Row>
      {/* Confirm first and say exactly what gets restored (a description saying "all" would be wrong: Screen Capture and system integration are left alone) */}
      <Row label={t("settings.reset.label")} desc={t("settings.reset.desc")}>
        <Button danger onClick={props.onReset}>
          {t("settings.reset.button")}
        </Button>
      </Row>
    </>
  );
}

/**
 * Third-party notices (shipped with the app and visible under About): the root THIRD-PARTY-NOTICES.txt (generated by scripts/build-notices.mjs),
 * about 100 KB, loaded only when opened (a separate bundle, so startup is not slowed). Listed component by component (split by notices.ts); the intro and table header follow the interface language;
 * the license texts stay in English and are not translated (the original governs, a translation has no force), and a row expands only when clicked (a whole page of English would be unreadable for people who do not read English)
 */
function NoticesSheet(props: { onClose: () => void; onNotify: (t: string) => void }) {
  const t = useT();
  const [list, setList] = useState<Notice[]>();
  const [failed, setFailed] = useState<string>();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    import("../../../THIRD-PARTY-NOTICES.txt?raw").then(
      (m) => setList(parseNotices(m.default)),
      (e: Error) => setFailed(e.message),
    );
  }, []);
  const toggle = (key: string) =>
    setOpen((was) => {
      const next = new Set(was);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  const visit = (url: string) => call("openExternal", { url }).catch((e: Error) => props.onNotify(e.message));
  return (
    <Sheet title={t("settings.about.notices")} className="sheet-notices" onClose={props.onClose}>
      {failed ? (
        <p className="text-danger">{failed}</p>
      ) : (
        <>
          <p className="notices-intro">{t("settings.notices.intro", { app: t("brand.name") })}</p>
          {/* The header is for sighted users only; screen readers read each row's button (name, version and license read together) */}
          <div className="notices-head" aria-hidden="true">
            <span />
            <span>{t("settings.notices.component")}</span>
            <span>{t("settings.notices.version")}</span>
            <span>{t("settings.about.license")}</span>
          </div>
          {list?.map((n) => {
            const key = `${n.name}@${n.version}`;
            const on = open.has(key);
            return (
              <section key={key} className={`notice${on ? " is-open" : ""}`}>
                {/* The expanded row sticks to the top while scrolling down: the item being read stays visible and can be collapsed at any time */}
                <button type="button" className="notice-row" aria-expanded={on} onClick={() => toggle(key)}>
                  <span className={`lib-twisty${on ? " is-open" : ""}`}>
                    <ChevronIcon />
                  </span>
                  <span className="notice-name">{n.name}</span>
                  <span className="notice-meta">{n.version}</span>
                  <span className="notice-meta">{n.license}</span>
                </button>
                {on && (
                  <div className="notice-body">
                    <div className="notice-source">
                      <span className="notice-label">{t("settings.notices.source")}</span>
                      {n.sources.map((url) => (
                        <button key={url} type="button" className="link-btn" onClick={() => void visit(url)}>
                          {url.replace(/^https:\/\//, "")}
                        </button>
                      ))}
                    </div>
                    <pre className="notices-text" lang="en">
                      {n.text}
                    </pre>
                  </div>
                )}
              </section>
            );
          }) ?? "…"}
        </>
      )}
    </Sheet>
  );
}

function About(props: { onNotify: (t: string) => void; onNotices: () => void }) {
  const t = useT();
  const intl = useIntl();
  const { info, error: infoError, load: loadInfo } = useAppInfo();
  // The same thing as "Copy Diagnostic Info" and "Report an Issue…" in the Help menu
  const copy = () =>
    copyDiagnostics(info, intl.locale).then(
      () => props.onNotify(t("help.diagnostics.done")),
      () => props.onNotify(t("app.error.clipboard")),
    );
  const report = () => reportIssue(intl, info).catch((e: Error) => props.onNotify(e.message));
  const open = (url: string) => call("openExternal", { url }).catch((e: Error) => props.onNotify(e.message));
  return (
    <>
      <Heading>{t("settings.about.title")}</Heading>
      <div className="about-mark">
        <Wordmark size="about" />
      </div>
      {infoError && <LoadError reason={infoError} onRetry={loadInfo} />}
      <Row
        label={`${t("brand.name")} ${versionLabel(APP_VERSION)}${IS_BETA ? t("settings.about.beta") : ""}`}
        desc={
          <>
            {t("settings.about.version", { version: APP_VERSION })}
            {" · "}
            {t("settings.about.uiBuilt", { time: shortTime(UI_BUILT) })}
            {" · "}
            {info && info.version !== APP_VERSION ? (
              <span className="text-danger">{t("settings.about.shellMismatch", { version: versionLabel(info.version) })}</span>
            ) : (
              t("settings.about.shellBuilt", { time: info ? shortTime(info.built) : "…" })
            )}
          </>
        }
      >
        <span />
      </Row>
      <Row label={t("settings.about.author")} desc={AUTHOR}>
        <span />
      </Row>
      <Row label={t("settings.about.license")} desc={t("settings.about.licenseName", { name: LICENSE_NAME })}>
        <Button onClick={() => void open(LICENSE_URL)}>{t("settings.about.view")}</Button>
      </Row>
      <Row label={t("settings.about.notices")} desc={t("settings.about.noticesDesc")}>
        <Button onClick={props.onNotices}>{t("settings.about.view")}</Button>
      </Row>
      {/* Privacy: nothing is collected, uploaded or sent over the network, stated plainly so users can confidently drag in confidential work files */}
      <Row label={t("settings.about.privacy")} desc={t("settings.about.privacyDesc")}>
        <span />
      </Row>
      <Row label={t("settings.about.homepage")} desc={HOMEPAGE.replace(/^https:\/\//, "")}>
        <Button onClick={() => void open(HOMEPAGE)}>{t("settings.open")}</Button>
      </Row>
      <Row label={t("settings.about.runtime")} desc={info ? `.NET ${info.dotnet} · WebView2 ${info.webview2}` : "…"}>
        <span />
      </Row>
      <Row label={t("settings.about.feedback")} desc={t("settings.about.feedbackDesc")}>
        <div className="set-actions">
          <Button onClick={() => void copy()}>{t("menu.help.diagnostics")}</Button>
          <Button onClick={() => void report()}>{t("menu.help.report")}</Button>
        </div>
      </Row>
    </>
  );
}
