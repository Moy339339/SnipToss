// Talks to the desktop shell (WPF + WebView2 in app/). Message format:
//   UI → shell { id, method, params }
//   shell → UI { id, result } or { id, error }
// The shell side is app/Bridge.cs; the method names on both sides must match.

import { ANNOTATIONS_DIR, parseMaterialFile, pathSep, type MaterialFile, type MaterialKind } from "@sniptoss/core";
import type { NativeCommand, SetMenus } from "./menuModel";
export type { MaterialFile };

interface WebViewBridge {
  postMessage(message: unknown): void;
  /** Can pass File objects along with the message, so the shell can get the real paths (for drag and drop) */
  postMessageWithAdditionalObjects(message: unknown, objects: ArrayLike<unknown>): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  /** Set by the Mac shell's script on the object it defines; WebView2's own object has none, which means Windows */
  platform?: string;
  /** Set by the Mac shell when it draws the menus itself (setMenus, menuCommand); without it the page keeps its own menu bar */
  nativeMenus?: boolean;
}

declare global {
  interface Window {
    chrome?: { webview?: WebViewBridge };
  }
}

/** One entry in the library on the left: a file or folder the user dragged in or added */
export interface LibraryEntry {
  path: string;
  /** Pinned: sorted first and kept when the library is cleared */
  pinned: boolean;
  /** missing = the file was moved or deleted */
  kind: "file" | "folder" | "missing";
  /**
   * Not found because the whole drive is absent (a USB stick or external disk is unplugged, a network drive is not connected): it fixes
   * itself when plugged back in, it was not deleted
   */
  offline?: boolean;
}

export interface LibraryState {
  entries: LibraryEntry[];
  /** Expanded folders (absolute paths) */
  expanded: string[];
  /** Collapsed projects (absolute paths of the project folders); projects are expanded by default */
  collapsed: string[];
  /** The item selected last time */
  selected: string | null;
  /** A path brought in by the command line / context menu; the UI locates it after loading */
  focus: string | null;
  /** Likewise: paths that were not added, with the reason (queued by the shell while the UI had not started or was loading), shown after loading */
  skipped?: string[];
  /**
   * Likewise: entries recognized as the one in the library that could no longer be found (moved) and replaced in place; "recognized" is
   * announced after loading
   */
  relocated?: { from: string; to: string }[];
}

/** One item. All paths are absolute paths normalized by the shell */
export interface MaterialEntry {
  path: string;
  /**
   * Relative path (forward slashes) within the library entry it belongs to: a folder entry builds its tree from it, and for a single file
   * it is the file name
   */
  rel: string;
  kind: MaterialKind;
  size: number;
  /** Millisecond timestamp, appended to the item URL so an old file is not served from cache */
  mtime: number;
  /** Creation time (ms): files that appeared only after the folder was added to the library get the "New" marker; older shells don't provide it */
  ctime?: number;
  /** Notes folder: the folder that holds .sniptoss (rules in HomeFinder in app/Library.cs) */
  home: string;
  /** Path relative to the notes folder (forward slashes) = material.path in the notes file */
  homeRel: string;
  /** The URL after the shell maps the drive holding the item to a virtual host */
  url: string;
  /**
   * The path is over 260 characters and cannot be read through a short junction (on a network drive): WebView2 cannot read it, and the
   * canvas says that is the reason (app/LongPaths.cs)
   */
  longPath?: boolean;
}

export interface ScanResult {
  entry: string;
  kind: LibraryEntry["kind"];
  /** The project the entry belongs to = its notes folder (for an entry that can't be found, the folder it was in); the library groups by it */
  project: string;
  materials: MaterialEntry[];
  /** The folder holds more items than the shell's limit (MaterialScanner.Limit) and only the first this many are listed; null if not exceeded */
  truncatedAt?: number | null;
  /**
   * An entry that can't be found: if the .sniptoss of its project still exists, that notes folder (its notes are still read, so the "item
   * not found" group of the notes panel can list them)
   */
  keptHome?: string | null;
  /**
   * Files in the folder that look like items but are not supported yet (psd, svg, pdf…): how many and which extensions (lower case, no
   * dot); null if none
   */
  others?: { count: number; exts: string[] } | null;
  /** Files in a less common format left out because Settings → Advanced → More formats is off: how many, which extensions; null when none */
  moreOff?: { count: number; exts: string[] } | null;
  /** Folders skipped during the scan (Settings → Advanced → Skipped folders); null if none */
  skippedDirs?: string[] | null;
}

export interface AddResult {
  added: string[];
  /** The first path this time that can be opened (also counting ones already in the library); the UI locates it */
  focus: string | null;
  /** What was not added, with the reason (unsupported files, not found) */
  skipped: string[];
  /** Added paths recognized as the library entry that could no longer be found (moved), replaced in place with the new location */
  relocated?: { from: string; to: string }[];
  /**
   * A drive that is only mapped after the page loaded was used, so the shell reloads the page immediately (it locates focus by itself
   * after loading), and nothing is needed here
   */
  reloading?: boolean;
  /** The file an image pasted with Ctrl+V was saved as (in the "Pasted images" folder, appInfo.pastedDir) */
  pasted?: string | null;
  /** Ctrl+V when the clipboard holds neither an image nor files */
  empty?: boolean;
}

interface Methods {
  ready: [void, void];
  library: [void, LibraryState];
  libraryAdd: [{ paths: string[] }, AddResult];
  /** Files / folders dragged in (File objects travel with the message, see addDropped) */
  addDropped: [void, AddResult];
  /** Ctrl+V: files copied in File Explorer (same as dragging them in) or an image (saved into the "Pasted images" folder) from the clipboard */
  pasteClipboard: [void, AddResult];
  pickFiles: [void, string[]];
  /** title: the dialog title (if omitted, "Add Item Folder") */
  pickFolder: [{ title?: string }, string | null];
  /** Point a library entry that can no longer be found to a new location (moved, renamed): replaced in place, with pinning and position unchanged */
  libraryRelocate: [{ from: string; to: string }, { to: string; reloading: boolean }];
  /** Returns how many entries were removed */
  libraryRemove: [{ paths: string[] }, number];
  /** Remove everything that is not pinned */
  /** Pin / unpin all entries of a project together */
  libraryPin: [{ paths: string[]; pinned: boolean }, void];
  libraryExpanded: [{ paths: string[] }, void];
  libraryCollapsed: [{ paths: string[] }, void];
  librarySelect: [{ path: string | null }, void];
  scan: [{ paths: string[] }, ScanResult[]];
  /** Read all notes files in the notes folders and start watching them */
  readHomes: [
    { homes: string[] },
    {
      home: string;
      /** Sequence number taken before reading (ADR-0005 item 8; older shells don't have it) */
      seq?: number;
      annotations: { name: string; text: string }[];
      /**
       * The raw text of .sniptoss/project.json (null if absent) and whether REVIEW.md exists: decides which language REVIEW.md is written
       * in (core's reviewLanguage)
       */
      project: { text: string | null; review: boolean };
    }[],
  ];
  /** path is relative to the notes folder and can only fall inside .sniptoss/ */
  writeText: [{ home: string; path: string; text: string }, void];
  /**
   * Write a notes file with a precondition (docs/adr/0005-write-protocol.md): expectSha256 = the content the caller believes the disk
   * holds (computed by textSha256), null = the caller believes the file doesn't exist yet. If it doesn't match nothing is written,
   * written = false, and current is what the disk holds now (null = no such file). seq: sequence number of the state returned back / of
   * the content written (taken under the lock, ADR-0005 item 8; older shells don't have it)
   */
  writeAnnotation: [
    { home: string; path: string; text: string; expectSha256: string | null },
    { written: boolean; current: string | null; seq?: number },
  ];
  writeBase64: [{ home: string; path: string; data: string }, void];
  deleteFile: [{ home: string; path: string }, void];
  /**
   * Delete the old snapshots in .sniptoss/snapshots that this app named and that are not in keep (relative to .sniptoss/); returns how
   * many were deleted (Bridge.PruneSnapshots)
   */
  pruneSnapshots: [{ home: string; keep: string[] }, number];
  /**
   * SHA-256 of an item's absolute path (read-only). The shell caches computed values locally by path + size + modification time, so the
   * same file isn't read twice
   */
  sha256: [{ path: string }, string];
  /**
   * URL of a file in the notes folder (path is relative to the notes folder, and only files in .sniptoss/ are accepted): when a note on
   * an earlier version is selected, the canvas shows its snapshot from back then (ADR-0008)
   */
  fileUrl: [{ home: string; path: string }, string];
  /**
   * An image the UI cannot display (TIFF, HEIC / HEIF; path is an item in the library): the shell converts it to PNG with Windows image
   * decoding (app/DecodedImages.cs) and returns the URL and the original image size (after rotating upright; scaled down if the PNG is too large).
   * If it could not be converted, problem is given: heif = the HEIF Image Extensions are not installed; hevc = most likely the HEVC Video
   * Extensions are missing (the file may also be damaged); unreadable = the file is damaged, not this format
   */
  decodeImage: [{ path: string }, { url: string; width: number; height: number } | { problem: "heif" | "hevc" | "unreadable" }];
  /** Which of these items no longer exist (deleted, renamed, moved); returns those that are gone */
  missing: [{ paths: string[] }, string[]];
  /**
   * Copy as Images (for web-based AI and chat apps, app/HandoffImages.cs): one image per note (title + snapshot + caption area), drawn by the
   * shell and put on the clipboard. One image goes on the clipboard as an image; several are saved as image files and those are put there; no
   * text is added in either case. snapshot is relative to the notes folder (.sniptoss/snapshots/x.png), or null if there is none
   */
  copyImages: [{ items: HandoffImageItem[]; extra: string }, { count: number }];
  getPrefs: [void, Record<string, unknown> | null];
  setPrefs: [{ prefs: object }, void];
  appInfo: [void, AppInfo];
  /** path: an absolute path; "@settings" = the settings file; "@app" = the app folder */
  reveal: [{ path: string }, void];
  /** Open a URL in the default browser (only http / https are accepted) */
  openExternal: [{ url: string }, void];
  /**
   * Help → Export Diagnostics Package…: the shell asks where to save, writes a zip (diagnostic info text, logs, settings with paths
   * removed) and selects it in File Explorer; returns the saved path, or null if cancelled
   */
  exportDiagnostics: [{ text: string }, string | null];
  /**
   * Help → Check for Updates… (app/Updates.cs): checks GitHub Releases. newer is a version newer than the current one in the same
   * channel; if the check can't be done (offline, repository not public) error holds the reason, for the log only
   */
  checkUpdates: [void, { newer: NewerVersion | null; error: string | null }];
  /** Record a UI error in the shell's log (%LOCALAPPDATA%\SnipToss\logs) */
  log: [{ level: "error" | "warn" | "info"; message: string }, void];
  /** Window menu: minimize, maximize / restore, full screen, always on top (toggle), close; returns the window state after the action */
  window: [{ action: WindowAction }, WindowState];
  windowState: [void, WindowState];
  /** The self-drawn title bar: the top edge, top-left or top-right corner was pressed, handing resizing over to the system */
  windowResize: [{ edge: "top" | "topleft" | "topright" }, void];
  /** Mac: a press on the blank part of the title strip starts moving the window (the page cannot ask for it with app-region, as WebView2 pages can) */
  windowDrag: [void, void];
  /** Mac: a double click on the blank part of the title strip does what the system setting for the title bar says (zoom or minimize) */
  windowZoom: [void, void];
  /** Mac: the menus as data for the shell's native menu bar; sent again whenever they change (menuModel.ts) */
  setMenus: [SetMenus, void];
  /** Screen Capture (the shell's app/Capture): starts from the button in the window and hides this window first */
  captureStart: [void, void];
  captureSettings: [void, CaptureSettings];
  setCaptureSettings: [
    Partial<Omit<CaptureSettings, "hotkeyError" | "hotkeyTypes" | "hotkeyMoved" | "defaultFolder" | "screenAccess">>,
    CaptureSettings,
  ];
  /** When recording a new shortcut the old one is stopped first, otherwise pressing the old key combination would start a capture right away */
  captureHotkeyPause: [{ pause: boolean }, void];
  /** Mac: opens System Settings where the user allows the app to record the screen (Privacy & Security → Screen Recording) */
  openScreenAccessSettings: [void, void];
  shellIntegration: [void, boolean];
  setShellIntegration: [{ enable: boolean }, void];
  openDevTools: [void, void];
}

/** The Window menu and the three title-bar buttons. close = close the window (hides it to the tray when "keep in tray" is on), quit = really quit */
export type WindowAction = "minimize" | "maximize" | "fullscreen" | "topmost" | "close" | "quit" | "resetLayout";

/** Settings → Screen Capture (stored in the shell's Settings.Capture) */
export interface CaptureSettings {
  /** Global shortcut, e.g. "Ctrl+Alt+P"; empty = not used */
  hotkey: string;
  /** Why the shortcut could not be registered (taken by another program); null = fine */
  hotkeyError: string | null;
  /** The character this key combination would type in the installed keyboard layouts (AltGr = Ctrl+Alt, e.g. Polish ą); "" = types nothing */
  hotkeyTypes: string;
  /**
   * At this launch the default shortcut would have typed a character and the shell replaced it (present only for that one launch); to =
   * "" means no alternative worked and no shortcut is used
   */
  hotkeyMoved: { from: string; to: string; typed: string } | null;
  keepInTray: boolean;
  hideWindow: boolean;
  notesInImage: boolean;
  /** Where screenshots are saved; empty = defaultFolder */
  folder: string;
  defaultFolder: string;
  autostart: boolean;
  /** Mac: whether macOS lets the app record the screen, read when the settings are asked for. Absent on Windows, which needs no permission */
  screenAccess?: boolean;
}

/**
 * A version newer than the current one (app/Updates.cs): version is a semantic version number (1.0.0-beta.70), url is the download page
 * of that version on GitHub
 */
export interface NewerVersion {
  version: string;
  url: string;
  prerelease: boolean;
}

export interface WindowState {
  maximized: boolean;
  fullscreen: boolean;
  /** Always on top (remembered, still on the next time it is opened) */
  topmost: boolean;
}

export interface AppInfo {
  /** Version of the app itself (the shell), which should equal the UI's APP_VERSION */
  version: string;
  /**
   * A message to tell the user when something went wrong reading the settings at startup (file damaged, restored from backup); null if
   * fine. Given only on the first load
   */
  startupNotice: string | null;
  /** First launch after the rename (pizhu → SnipToss), with the old settings just moved over: shows a notice once. Given only on the first load */
  renamedFromPizhu: boolean;
  /** Log folder */
  logDir: string;
  /** The folder where images pasted with Ctrl+V are put: shown in the library as "Pasted images" */
  pastedDir?: string;
  /**
   * Portable build (a data folder next to the app holds all data): writes no registry, and the context menu and start-with-Windows
   * switches in Settings are greyed out
   */
  portable?: boolean;
  /** The Windows display language (e.g. zh-CN, en-US), used by "Follow system" in Settings (matchLocale in i18n.tsx) */
  systemLanguage: string;
  /** When the app itself was built (ISO) */
  built: string;
  /** The build number of a Mac package (CFBundleVersion): the version is then written "1.0.0 (44)" (versionWithBuild). Not sent on Windows */
  build?: string;
  dotnet: string;
  webview2: string;
  /** OS and architecture, e.g. "Microsoft Windows 10.0.26200 (X64)" (used in diagnostic info) */
  os: string;
  exe: string;
  settingsPath: string;
  userName: string;
}

/**
 * One Copy as Images entry: title is the top line (project / file), where is the position (without the category), name is the file name
 * when saved (without extension)
 */
export interface HandoffImageItem {
  home: string;
  snapshot: string | null;
  title: string;
  number: number;
  category: string;
  where: string;
  body: string;
  color: string;
  name: string;
}

/**
 * An error reported back by the shell. code classifies common disk errors (Bridge.ErrorCode: denied = no write permission, diskFull, busy,
 * network, notFound, tooLong), and the UI explains it by that (hostReason); message is the system's original text, in the Windows language
 */
export class HostError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

// No window in the unit tests that only import the modules which read `platform` (keys.ts, hotkey.ts)
const webview = typeof window === "undefined" ? undefined : window.chrome?.webview;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let nextId = 1;

type HostEvents = {
  /**
   * A notes file in some notes folder was changed externally (an agent wrote back a status, etc.). seq: the sequence number taken before
   * reading; if it is smaller than the one the UI has seen for this file, the content may be late and stale and must not be merged
   * (ADR-0005 item 8; older shells don't have it)
   */
  annotationsChanged: { home: string; seq?: number; annotations: { name: string; text: string }[] };
  /** While the app is open something else was opened from the context menu / command line, and the shell has added it to the library */
  libraryChanged: { focus: string | null; skipped: string[]; relocated?: { from: string; to: string }[] };
  /** The window was hidden (hidden to the tray on close, or hidden first when Screen Capture is started from the window): a playing video stops */
  windowHidden: Record<string, never>;
  /** The files of these library entries changed (an agent edited, added or deleted items): rescan them (app/MaterialWatcher.cs) */
  materialsChanged: { entries: string[] };
  /** The system window menu popped up (Alt+Space, right-click on blank title bar space): close our own menu and leave menu-bar mode */
  systemMenu: Record<string, never>;
  /**
   * The shell wants to open a page of Settings (a click on the tray balloon "capture shortcut could not be enabled"): section is the name
   * of a SettingsDialog section
   */
  openSettings: { section: string };
  /** Mac: an item of the native menu bar was chosen; `version` is the version of the setMenus it was in (menuModel.ts) */
  menuCommand: NativeCommand;
  /** After startup the shell found a new version automatically (checked at most once a day, can be turned off in Settings): shown in the title bar */
  updateAvailable: NewerVersion;
};
const listeners = new Map<string, Set<(payload: never) => void>>();

/** Events the shell pushes by itself (not replies to a call), e.g. a notes file was changed externally */
export function onHostEvent<K extends keyof HostEvents>(name: K, cb: (payload: HostEvents[K]) => void): () => void {
  const set = listeners.get(name) ?? new Set();
  set.add(cb as (payload: never) => void);
  listeners.set(name, set);
  return () => set.delete(cb as (payload: never) => void);
}

webview?.addEventListener("message", ({ data }) => {
  if (!data || typeof data !== "object") return;
  const ev = data as { event?: string };
  if (ev.event) {
    listeners.get(ev.event)?.forEach((cb) => cb(data as never));
    return;
  }
  const msg = data as { id: number; result?: unknown; error?: string; code?: string | null };
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  if (msg.error !== undefined) p.reject(new HostError(msg.error, msg.code ?? undefined));
  else p.resolve(msg.result);
});

export const inHost = webview !== undefined;

/** Which shell hosts the page. Known at once (before any call), so the error page can use it too */
export const platform: "windows" | "mac" = webview?.platform === "mac" ? "mac" : "windows";

/** The shell draws the menus itself: the page sends them (setMenus) and does not show its own menu bar */
export const nativeMenus = webview?.nativeMenus === true;

/**
 * How long without a reply from the shell counts as no response (ms). Opening dialogs and capturing wait for the user and have no limit;
 * scanning a large folder and reading many notes get plenty of time. There used to be no limit at all: if the shell went wrong and never
 * replied, the call hung forever, which looked like "clicked and nothing happened" in the UI.
 * library and missing check whether each entry exists: an entry on a disconnected network drive or a sleeping NAS takes tens of seconds
 * for one entry (30 seconds used to count as no response and the library stayed empty);
 * copyImages draws dozens of notes into images one by one
 */
const TIMEOUT: Partial<Record<keyof Methods, number>> = {
  pickFiles: 0,
  pickFolder: 0,
  captureStart: 0,
  exportDiagnostics: 0, // waits for the user to choose in the save dialog
  checkUpdates: 30_000, // the shell has its own 15-second timeout
  windowResize: 0,
  scan: 300_000,
  library: 120_000,
  missing: 120_000,
  readHomes: 120_000,
  libraryAdd: 120_000,
  addDropped: 120_000,
  sha256: 120_000,
  copyImages: 120_000,
};
const DEFAULT_TIMEOUT = 30_000;
/** How long to wait for the shell when calling method (ms, 0 = no limit) */
export const callTimeout = (method: keyof Methods) => TIMEOUT[method] ?? DEFAULT_TIMEOUT;

function send<T>(method: keyof Methods, post: (id: number) => void): Promise<T> {
  // This only happens when the page is opened directly in a browser during development (the UI has a separate notice page,
  // app.boot.notInHost); not translated
  if (!webview) return Promise.reject(new Error("Open this page in the SnipToss window"));
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    const limit = callTimeout(method);
    const timer =
      limit > 0
        ? window.setTimeout(() => {
            if (!pending.delete(id)) return;
            // The wording is a message (report.ts turns the code into app.error.timeout); the text here goes to the log
            reject(new HostError(`No response from the app (${method})`, "timeout"));
          }, limit)
        : 0;
    pending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v as T);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    try {
      post(id);
    } catch (e) {
      // The message was never sent (WebView2 rejected it on the spot): no reply to wait for
      pending.get(id)?.reject(e instanceof Error ? e : new Error(String(e)));
      pending.delete(id);
    }
  });
}

export function call<M extends keyof Methods>(
  method: M,
  ...params: Methods[M][0] extends void ? [] : [Methods[M][0]]
): Promise<Methods[M][1]> {
  return send(method, (id) => webview!.postMessage({ id, method, params: params[0] ?? null }));
}

/** Hand the files dragged into the window to the shell, adding them to the library */
export async function addDropped(files: File[]): Promise<AddResult> {
  // If one of the File objects WebView2 receives is not on disk (an image dragged out of a web page), the whole message is rejected on
  // the spot ("additional File object is not a file on the disk"); that English sentence used to pop up as it was, and the "not a local
  // file" message could never be shown. So hand them over one by one, and the ones that cannot be handed over don't count
  let refused = false;
  const post = (fs: File[]) =>
    send<AddResult>("addDropped", (id) => {
      try {
        webview!.postMessageWithAdditionalObjects({ id, method: "addDropped", params: null }, fs);
      } catch (e) {
        refused = true;
        throw e;
      }
    });
  try {
    return await post(files);
  } catch (e) {
    if (!refused) throw e;
  }
  const all: AddResult = { added: [], focus: null, skipped: [], relocated: [] };
  for (const f of files) {
    refused = false;
    let r: AddResult;
    try {
      r = await post([f]);
    } catch (e) {
      if (refused) continue;
      throw e;
    }
    all.added.push(...r.added);
    all.skipped.push(...r.skipped);
    all.relocated!.push(...(r.relocated ?? []));
    all.focus ??= r.focus;
    // The page is about to reload (a new drive): the rest could not be taken over by the reloaded page either, and the shell has already
    // queued this locate
    if (r.reloading) return { ...all, reloading: true };
  }
  return all;
}

/**
 * Records a UI error in the shell's log. If logging itself fails, so be it (an error must not trigger another error report).
 * The same entry is recorded once per minute: an error repeating in a render loop doesn't flood the log
 */
const reported = new Map<string, number>();
export function logError(where: string, error: unknown, level: "error" | "warn" = "error"): void {
  const e = error instanceof Error ? error : new Error(String(error));
  // The log is always written in English, independent of the UI language (ADR-0001 item 13): "where: original text"
  const message = `${where}: ${e.message}${e.stack ? `\n${e.stack}` : ""}`;
  const now = Date.now();
  const last = reported.get(message);
  if (last !== undefined && now - last < 60_000) return;
  reported.set(message, now);
  console.error(message);
  if (inHost) void call("log", { level, message }).catch(() => {});
}

/**
 * The URL of an item in WebView2; it carries the modification time and size, so a replaced file is not read from the cache and a video reloads.
 * The modification time alone is not enough: Windows keeps the original file's modification time when copying, and two files in the same
 * checkout often share one, so after swapping the URL would still be the same
 */
export function materialUrl(m: MaterialEntry): string {
  return `${m.url}?v=${m.mtime}-${m.size}`;
}

/** The last segment of a path (file name or folder name) */
export function baseName(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean);
  const last = parts[parts.length - 1] ?? p;
  // A drive root is called E:\ (the shell gives the same form)
  return parts.length === 1 && /^[a-z]:$/i.test(last) && pathSep(p) === "\\" ? `${last}\\` : last;
}

/**
 * The parent folder. A file at a drive root, or the drive root itself → E:\ (consistent with the shell's Path.GetDirectoryName);
 * a file directly under / → /
 */
export function dirName(p: string): string {
  const posix = pathSep(p) === "/";
  if (!posix) {
    // A network share root (\\srv\share) is treated like a drive root: its parent is itself (it used to step back to \\srv, and the project
    // row subtitle showed the server name)
    const share = /^[\\/]{2}[^\\/]+[\\/][^\\/]+(?=[\\/]*$|[\\/][^\\/]+[\\/]*$)/.exec(p);
    if (share) return share[0];
  }
  const i = Math.max(p.lastIndexOf("\\"), p.lastIndexOf("/"));
  if (i < 0 || (i === 0 && !posix)) return p;
  if (i === 0) return "/";
  const d = p.slice(0, i);
  return /^[a-z]:$/i.test(d) ? `${d}\\` : d;
}

/**
 * The key for comparing paths. Every path is written in one form (backslashes, lowercase, composed Unicode), so a Windows and a POSIX
 * path compare the same way: Windows paths are case-insensitive, a Mac volume is by default, and macOS can hand over the same file name in
 * decomposed form (é as e + an accent)
 */
export const keyOf = (path: string) => path.replaceAll("/", "\\").normalize("NFC").toLowerCase();

/** Notes folder + relative path → absolute path (the separator follows the notes folder, see pathSep) */
export const homeJoin = (home: string, rel: string) => {
  const sep = pathSep(home);
  return `${home.replace(/[\\/]+$/, "")}${sep}${rel.replaceAll("/", sep)}`;
};

/**
 * Parses the notes files in one notes folder. The validation rules are written only once, in core; damaged ones are listed separately and
 * don't block the rest. text is the raw text on disk (for the compare before writing)
 */
export function parseHomeFiles(raw: { name: string; text: string }[]): {
  files: { file: MaterialFile; text: string }[];
  bad: { name: string; error: unknown }[];
} {
  const files: { file: MaterialFile; text: string }[] = [];
  const bad: { name: string; error: unknown }[] = [];
  for (const { name, text } of raw) {
    try {
      files.push({ file: parseMaterialFile(text, name), text });
    } catch (error) {
      bad.push({ name, error });
    }
  }
  return { files, bad };
}

/** Absolute path of a notes file (name is the file name inside annotations/) */
export const annotationPath = (home: string, name: string) => homeJoin(home, `${ANNOTATIONS_DIR}/${name}`);

/** SHA-256 of a text (computed over UTF-8, lowercase hex), the same algorithm as the shell's Bridge.TextSha256 */
export async function textSha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
