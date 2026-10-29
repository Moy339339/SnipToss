// Mock host (layer 3 of docs/adr/0004-testing-layers.md): the UI runs in a regular browser (Edge) and the bridge methods are implemented here
// with the semantics of app/Bridge.cs, reading and writing for real in a temp directory. It is also an executable spec of the shell interface:
// a future Mac shell can be implemented against it and run the same e2e suite.
// When the behavior of Bridge.cs changes, update this file too (and keep it in line with Methods in packages/web/src/host.ts).

import { createHash, randomBytes } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { posix, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR, LEGACY_DATA_DIR } from "@sniptoss/core";
// The write lock is the command line's own (app/FileLock.cs uses the same name and the same rules)
import { withFileLock } from "../../packages/cli/dist/fs-store.js";

const KINDS: Record<string, string> = {
  ".png": "image", ".jpg": "image", ".jpeg": "image", ".jfif": "image", ".jpe": "image", ".pjpeg": "image", ".pjp": "image",
  ".webp": "image", ".gif": "image", ".apng": "image", ".bmp": "image", ".avif": "image", ".ico": "image", ".svg": "image",
  ".tif": "image", ".tiff": "image", ".heic": "image", ".heif": "image",
  ".mp4": "video", ".webm": "video", ".mov": "video", ".m4v": "video", ".mkv": "video",
};
/** Same as MaterialScanner.NotYet: files that look like items but can't be annotated yet are only counted when scanning (PDF and PPT are here too) */
const NOT_YET = new Set(
  (
    ".pdf .pptx .ppt .key .psd .psb .ai .eps .jxl .tga .exr .hdr .dds .raw .dng .cr2 .cr3 .nef .arw .orf " +
    ".rw2 .xcf .kra .sketch .fig .xd .afdesign .afphoto .avi .wmv .flv .f4v .mpg .mpeg .3gp .m2ts .mts .vob .ogv .rm .rmvb"
  ).split(" "),
);
/** Same as MaterialScanner.More: folders list these only when Settings → Advanced → More formats is on */
const MORE = new Set([".jfif", ".jpe", ".pjpeg", ".pjp", ".apng", ".ico", ".tif", ".tiff", ".heic", ".heif", ".mkv"]);
/** Same as DecodedImages.Needs: formats the UI can't display, which the shell converts to PNG */
const DECODED = new Set([".tif", ".tiff", ".heic", ".heif"]);
/**
 * PNGs converted by the shell: the real shell converts on the fly with Windows image decoding (app/DecodedImages.cs); here pre-converted ones are used
 * (fixtures/formats/decoded/<file name>.png, whose size is the size of the original image). A file with no pre-converted PNG is treated as corrupt
 */
const DECODED_DIR = fileURLToPath(new URL("./fixtures/formats/decoded/", import.meta.url));
/** Names of the onboarding tour and hints (onboarding.ts in packages/web) */
export const ONBOARDED = ["tour", "hint.copy", "hint.video", "hint.screenAccess"];
const DEFAULT_SKIP = ["node_modules", "bin", "obj", "dist", "build", "__pycache__", "venv"];
/** Same as DataDir.GitIgnore */
const GIT_IGNORE =
  "# SnipToss: temporary and lock files left while saving notes (normally removed right away).\n" +
  "# Your notes are not ignored; commit them or not as you like.\n" +
  "*.tmp\n" +
  "*.lock\n";
/** App version: the same number the UI was built with (version in the root package.json), so the bottom right of the Library looks normal; use appInfoPatch to test a mismatch */
export const VERSION = (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;
/** Whether this build is a beta (1.0.0-beta.N); a release version (1.0.0) is not */
export const IS_BETA = /-beta\.\d+$/.test(VERSION);
/** How the UI writes this version (versionLabel in packages/web/src/brand.ts): "Beta N" during the beta, "v1.0.0" once released */
export const VERSION_LABEL = IS_BETA ? `Beta ${/-beta\.(\d+)$/.exec(VERSION)![1]}` : `v${VERSION}`;

export interface Call {
  method: string;
  params: unknown;
}

interface Entry {
  path: string;
  pinned: boolean;
}

// Paths are the system's own: Windows paths where the tests normally run, POSIX ones when they run on a Mac (the line-breaking checks in
// WebKit run on the Mac CI)
const path = process.platform === "win32" ? win32 : posix;

/** Normalizes to an absolute path and drops the trailing separator (a drive root keeps it), same as Library.Norm */
export const norm = (p: string) => {
  const full = path.resolve(p);
  const root = path.parse(full).root;
  return full.length > root.length ? full.replace(/[\\/]+$/, "") : full;
};
const same = (a: string, b: string) => norm(a).toLowerCase() === norm(b).toLowerCase();
/** Same as Library.Inside: excludes the folder itself (a drive root like E:\ is not inside E:\) */
const inside = (p: string, folder: string) => {
  const f = norm(folder);
  const prefix = (f.endsWith(path.sep) ? f : f + path.sep).toLowerCase();
  const n = norm(p).toLowerCase();
  return n.length > prefix.length && n.startsWith(prefix);
};
/** Same as Uri.EscapeDataString: escapes ! ' ( ) * in addition to what encodeURIComponent does */
const escapeData = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const kindOf = (p: string) => KINDS[path.extname(p).toLowerCase()];
const toSlash = (p: string) => p.replaceAll("\\", "/");

/**
 * Item URL, same as MainWindow.UrlOf: the drive letter maps to a virtual host such as vol-c.sniptoss.example. A POSIX path has no drive:
 * vol-root stands for its root (the Mac shell serves items from sniptoss://media, which a test cannot intercept)
 */
export function urlOf(p: string): string {
  const root = path.parse(p).root;
  const host = /^[a-z]:/i.test(root) ? `vol-${root[0].toLowerCase()}` : "vol-root";
  const rest = p.slice(root.length).split(path.sep).filter(Boolean).map(escapeData).join("/");
  return `https://${host}.sniptoss.example/${rest}`;
}

/** The reverse: virtual host URL → disk path (used by tests to serve item files) */
export function pathOfUrl(url: string): string | null {
  const u = new URL(url);
  const m = /^vol-([a-z]|root)\.sniptoss\.example$/.exec(u.hostname);
  if (!m) return null;
  const parts = u.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  return m[1] === "root" ? `/${parts.join("/")}` : `${m[1].toUpperCase()}:\\${parts.join("\\")}`;
}

export class MockHost {
  /** Every method the UI called (to assert "clicking a button → the shell was asked to do something") */
  readonly calls: Call[] = [];
  /** What the UI wrote to the shell log (ErrorBoundary, window.onerror, CSP blocks, ...): should be empty in normal flows */
  readonly logs: { level: string; message: string }[] = [];
  entries: Entry[] = [];
  /** The shell just migrated settings from before the rename from pizhu (renamedFromPizhu in appInfo): set to true to test the upgrade notice */
  renamedFromPizhu = false;
  /** The settings file was corrupt and restored from backup, and similar cases (startupNotice in appInfo): set to test the startup notice. Same as Bridge.TakeStartupNotice, given only on the first appInfo (not again after the page reloads) */
  startupNotice: string | null = null;
  private startupNoticeTaken = false;
  /** Test only: when enabling the context menu the shell reports success but the registry isn't written (what the real app does when started in an environment that forbids registry writes) */
  shellIgnoresWrites = false;
  /** Test only: path prefixes treated as "the whole drive is offline" (the real shell checks whether the drive letter / network share exists) */
  offlineDrives: string[] = [];
  /** Paths the UI asked the shell to open / select in File Explorer (reveal), in order */
  revealed: string[] = [];
  /** URLs the UI asked the shell to open in the browser (openExternal), in order */
  opened: string[] = [];
  /** The notes handed to the shell by each Copy as Images (the real shell's HandoffImages draws the images and puts them on the clipboard; this only records them) */
  copiedImages: { home: string; snapshot: string | null; title: string; number: number; category: string; where: string; body: string; color: string; name: string }[][] = [];
  /** What checkUpdates returns: by default no newer version; change it to test "new version" and "can't check" */
  updateResult: { newer: { version: string; url: string; prerelease: boolean } | null; error: string | null } = { newer: null, error: null };
  /** The shell found a new version by itself after startup (same as the updateAvailable event sent by MainWindow.AutoCheckUpdatesAsync) */
  announceUpdate(newer: { version: string; url: string; prerelease: boolean }) {
    this.emit({ event: "updateAvailable", ...newer });
  }
  /** Test only: fields laid over the appInfo reply (e.g. a bad value to make the Settings page fail to render) */
  appInfoPatch: Record<string, unknown> = {};
  /** Test only: decodeImage reports this problem, simulating a computer without the HEIF / HEVC extension */
  decodeProblem: "heif" | "hevc" | null = null;
  /**
   * Full paths of the files dropped into the window next time: the browser can't get the path of a dropped File (the real shell gets it from WebView2's CoreWebView2File), so the test supplies it first;
   * a path is only added if the file name the UI sent along matches (which shows the UI really handed over the dropped files)
   */
  nextDrop: string[] = [];
  expanded: string[] = [];
  collapsed: string[] = [];
  selected: string | null = null;
  prefs: Record<string, unknown> | null = null;
  /**
   * The onboarding tour and hints all count as seen (onboarding.ts): otherwise the first item displayed dims the whole window for the tour and blocks whatever the test clicks.
   * Added on read, removed on write, so the prefs a test sees and asserts on don't have this extra entry. Tests of the tour set it to false first
   */
  onboarded = true;
  /** What the next Add Files / Add Folder dialog returns (set in the test first) */
  nextPickFiles: string[] = [];
  nextPickFolder: string | null = null;
  shellIntegration = false;
  /** Simulates the Windows display language (to test "Follow system") */
  systemLanguage = "zh-CN";
  /** Export Diagnostics Package: the path the Save dialog "picks" (null = the user cancelled), and the diagnostic info handed over */
  nextExportPath: string | null = "C:\\Users\\me\\Desktop\\SnipToss-diagnostics.zip";
  exported: string[] = [];
  /** maximized is the state from before full screen; the state returned to the UI is the same as MainWindow.State: full screen doesn't count as maximized */
  window = { maximized: false, fullscreen: false, topmost: false };
  windowState() {
    return { ...this.window, maximized: this.window.maximized && !this.window.fullscreen };
  }
  /** The Mac-only window calls the page made (windowDrag, windowZoom), in order */
  windowCalls: string[] = [];
  /** The shell reports that an item of the Mac's native menu was chosen */
  chooseMenuItem(id: string, version: number) {
    this.emit({ event: "menuCommand", id, version });
  }
  /** Every setMenus the page sent (the Mac's native menus), in order */
  menusSent: { version: number; modal: boolean; menus: { label: string; items: unknown[] }[] }[] = [];
  capture = {
    hotkey: "Ctrl+Alt+A",
    hotkeyError: null as string | null,
    hotkeyTypes: "",
    hotkeyMoved: null as { from: string; to: string; typed: string } | null,
    keepInTray: true,
    hideWindow: true,
    notesInImage: true,
    folder: "",
    autostart: false,
    /** The Mac shell sends whether macOS lets it record the screen; the Windows shell leaves it out */
    screenAccess: undefined as boolean | undefined,
  };
  /** How many times the page asked the Mac shell to open System Settings at the screen recording permission */
  screenAccessOpened = 0;
  /** Simulated system clipboard (Ctrl+V pastes items): files copied in File Explorer, or an image (PNG bytes); neither = nothing addable on the clipboard */
  clipboardFiles: string[] | null = null;
  clipboardImage: Buffer | null = null;
  private pastes = 0;
  /** Same as AppPaths.PastedDir: images pasted with Ctrl+V go here */
  get pastedDir() {
    return path.join(this.opts.tempDir, "pasted");
  }
  /** Test only: these shortcuts are held by another program (same as GlobalHotKey.Set failing to register: not saved, hotkeyError returned, the old one stays) */
  hotkeyTaken = new Set<string>();
  /** The UI paused the old shortcut while recording a new one (captureHotkeyPause); it must be restored when recording ends */
  hotkeyPaused = false;
  /** Simulates the keyboard layout of the user's computer: which key combination types which character (AltGr = Ctrl+Alt, e.g. Polish "Ctrl+Alt+A": "ą"); the shell's GlobalHotKey.TypedChars */
  typingKeys: Record<string, string> = {};
  /** Test only: temporarily don't push external changes (simulates the disk having changed while the notification hasn't reached the UI yet) */
  muted = false;
  /** Test only: writes whose path (relative to the notes folder, e.g. .sniptoss/REVIEW.md) matches always fail, simulating a full disk or a locked file */
  failWrites: RegExp | null = null;
  /** Test only: these methods fail as soon as they're called */
  failMethods = new Set<string>();
  /** Test only: the message reported when a method in failMethods fails (default: the method name followed by the injected-failure message) */
  failMessages: Record<string, string> = {};
  /** Test only: called before every notes file write, before the fingerprint comparison (gets the full path), simulating another program constantly modifying the file */
  beforeWriteAnnotation: ((full: string) => void) | null = null;
  /** Test only: these methods reply after this many milliseconds (simulates fingerprinting a large file, a slow network drive) */
  delays: Record<string, number> = {};
  /** pruneSnapshots only deletes snapshots unchanged for longer than this (10 minutes in the real shell; reduced in tests) */
  snapshotMinAgeMs = 10 * 60 * 1000;
  /** Focus target and "not added" notes the shell has queued for the UI to take when it loads the library (same as MainWindow.TakePending; tests command-line startup where the UI wasn't up yet when paths were forwarded) */
  pendingFocus: string | null = null;
  pendingSkipped: string[] = [];
  pendingRelocated: { from: string; to: string }[] = [];
  /** Test only: the next thing added to the library is treated as being on a drive that was mapped only after the page loaded (same as MainWindow.ReloadIfNewVolume): the result is queued in pending*, reloading is returned, and the test calls page.reload() itself */
  reloadOnNextAdd = false;
  /** Max number of items listed for one folder entry (same as MaterialScanner.Limit; reduced in tests) */
  scanLimit = 20000;
  private homes = new Set<string>();

  constructor(
    private readonly opts: {
      /** Pushes an event to the UI (annotationsChanged etc.) */
      emit: (payload: object) => Promise<void>;
      tempDir: string;
    },
  ) {}

  private disposed = false;
  private timers = new Set<NodeJS.Timeout>();

  /** End of a test: stops the folder watching and the pushes that haven't fired yet (otherwise they would push into a closed page and crash the test process) */
  dispose() {
    this.disposed = true;
    if (this.poller) clearInterval(this.poller);
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
  }

  private emit(payload: object) {
    if (this.disposed) return;
    this.opts.emit(payload).catch(() => {
      // The page is closing: nobody receives this push
    });
  }

  /** The UI sends { id, method, params }; the reply is { id, result } or { id, error }, same as Bridge.HandleAsync */
  async handle(msg: { id: number; method: string; params: unknown }): Promise<object> {
    const { id, method } = msg;
    const a = (msg.params ?? {}) as Record<string, unknown>;
    this.calls.push({ method, params: msg.params });
    try {
      return { id, result: await this.dispatch(method, a) ?? null };
    } catch (e) {
      // code: classified as in Bridge.ErrorCode (notFound, denied, ...), which the UI turns into plain language
      return { id, error: (e as Error).message, code: (e as { code?: string }).code ?? null };
    }
  }

  private async dispatch(method: string, a: Record<string, unknown>): Promise<unknown> {
    const str = (k: string) => {
      const v = a[k];
      if (typeof v !== "string") throw new Error(`Missing argument: ${k}`);
      return v;
    };
    if (this.failMethods.has(method)) throw new Error(this.failMessages[method] ?? `${method} 失败（测试注入）`);
    if (this.delays[method]) await new Promise((r) => setTimeout(r, this.delays[method]));
    if (["writeText", "writeBase64", "writeAnnotation"].includes(method) && this.failWrites?.test(str("path")))
      throw new Error(`磁盘满了（测试注入）：${str("path")}`);
    const list = (k: string) => (Array.isArray(a[k]) ? (a[k] as string[]).filter((s) => typeof s === "string" && s !== "") : []);
    switch (method) {
      case "ready":
        return null;
      case "library": {
        this.syncMaterialWatch();
        const focus = this.pendingFocus;
        this.pendingFocus = null;
        return {
          entries: this.entries.map((e) => ({
            path: e.path,
            pinned: e.pinned,
            kind: existsSync(e.path) ? (statSync(e.path).isDirectory() ? "folder" : "file") : "missing",
            // Same as Bridge.DriveThere: the whole drive is missing (tests simulate an unplugged USB drive with offlineDrives)
            offline: !existsSync(e.path) && this.offlineDrives.some((d) => e.path.toLowerCase().startsWith(d.toLowerCase())),
          })),
          expanded: this.expanded,
          collapsed: this.collapsed,
          selected: this.selected,
          focus,
          skipped: this.pendingSkipped.splice(0),
          relocated: this.pendingRelocated.splice(0),
        };
      }
      case "libraryAdd":
        return this.afterAdd(this.add(list("paths")));
      case "addDropped": {
        const names = new Set(list("dropped").map((n) => n.toLowerCase()));
        const paths = this.nextDrop.filter((p) => names.has(path.basename(p).toLowerCase()));
        this.nextDrop = [];
        return this.afterAdd(this.add(paths));
      }
      case "pasteClipboard": {
        // Same as Bridge.PasteFromClipboard: copied files are handled like dropped ones; an image is saved in the "pasted images" folder, the whole folder is added to the library and focus goes to this image
        if (this.clipboardFiles?.length) return { ...this.add(this.clipboardFiles), reloading: false };
        if (!this.clipboardImage) return { empty: true };
        const dir = this.pastedDir;
        mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `paste-${String(++this.pastes).padStart(3, "0")}.png`);
        writeFileSync(file, this.clipboardImage);
        return { ...this.add([dir]), focus: file, pasted: file, reloading: false };
      }
      case "pickFiles": {
        const r = this.nextPickFiles;
        this.nextPickFiles = [];
        return r;
      }
      case "pickFolder": {
        const r = this.nextPickFolder;
        this.nextPickFolder = null;
        return r;
      }
      case "libraryRelocate": {
        // Same as Library.Relocate
        const target = norm(str("to"));
        if (!existsSync(target)) throw new Error(`Not found: ${target}`);
        const entry = this.entries.find((e) => same(e.path, str("from")));
        if (!entry) throw new Error(`Not in the list: ${str("from")}`);
        this.entries = this.entries.filter((e) => e === entry || !same(e.path, target));
        this.retarget(entry, target);
        return { to: target, reloading: false };
      }
      case "libraryRemove": {
        const paths = list("paths");
        const before = this.entries.length;
        this.entries = this.entries.filter((e) => !paths.some((p) => same(p, e.path)));
        // Same as Library.Remove: clear the expanded records of the entry and of what's inside it; if the item being viewed was removed along with it, clear "last selected"
        this.expanded = this.expanded.filter((x) => !paths.some((p) => same(p, x) || inside(x, p)));
        if (this.selected && paths.some((p) => same(p, this.selected!) || inside(this.selected!, p))) this.selected = null;
        // Same as MaterialWatcher: forget the fingerprints of entries no longer in the library; adding them back is a "first sighting", which is recorded but not pushed
        for (const k of this.materialSigs.keys()) if (paths.some((p) => same(p, k))) this.materialSigs.delete(k);
        return before - this.entries.length;
      }
      case "libraryPin": {
        const paths = list("paths");
        const pinned = a.pinned === true;
        const targets = this.entries.filter((e) => paths.some((p) => same(p, e.path)));
        if (targets.length === 0) throw new Error("素材列表中没有此项");
        this.entries = this.entries.filter((e) => !targets.includes(e));
        let at = this.entries.filter((e) => e.pinned).length;
        for (const t of targets) this.entries.splice(at++, 0, { ...t, pinned });
        return null;
      }
      case "libraryExpanded":
        this.expanded = list("paths");
        return null;
      case "libraryCollapsed":
        this.collapsed = list("paths");
        return null;
      case "librarySelect":
        this.selected = typeof a.path === "string" ? a.path : null;
        return null;
      case "scan":
        return list("paths").filter((p) => this.entries.some((e) => same(e.path, p))).map((p) => this.scanEntry(p));
      case "readHomes":
        return list("homes")
          .map(norm)
          .filter((h) => this.homes.has(h.toLowerCase()))
          .map((home) => {
            this.migrateDataDir(home);
            const seq = this.observe(); // Take the sequence number before reading, same as Bridge.ReadHomes
            const annotations = this.readAnnotations(home);
            this.watch(home);
            return { home, seq, annotations, project: this.readProject(home) };
          });
      case "writeText":
        return this.write(this.home(a), str("path"), Buffer.from(str("text"), "utf8"));
      case "writeBase64":
        return this.write(this.home(a), str("path"), Buffer.from(str("data"), "base64"));
      case "writeAnnotation": {
        const full = this.inDataDir(this.home(a), str("path"));
        this.beforeWriteAnnotation?.(full);
        // Same as Bridge.WriteIfUnchangedAsync: the comparison and the write happen under the same lock (command-line write-backs take the same one, ADR-0005 item 7)
        // seq: the sequence number taken under the lock (same as Bridge.WriteIfUnchangedAsync, ADR-0005 item 8)
        const res = await withFileLock(full, async () => {
          if ("expectSha256" in a) {
            const current = existsSync(full) ? readFileSync(full, "utf8").replace(/^\uFEFF/, "") : null;
            if (textSha256(current) !== (a.expectSha256 ?? null)) return { written: false, current, seq: this.observe() };
          }
          this.atomicWrite(full, Buffer.from(str("text"), "utf8"));
          return { written: true, current: null, seq: this.observe() };
        });
        if (!res.written) return res;
        this.watch(this.home(a));
        this.ensureGitIgnore(this.home(a));
        return res;
      }
      case "deleteFile": {
        const full = this.inDataDir(this.home(a), str("path"));
        if (existsSync(full)) rmSync(full);
        return null;
      }
      case "pruneSnapshots": {
        // Same as Bridge.PruneSnapshots: only deletes snapshots nobody uses, with names this app creates (6-character id + .png / .jpg), unchanged for over 10 minutes
        const dir = path.dirname(this.inDataDir(this.home(a), `${DATA_DIR}/snapshots/_`));
        if (!existsSync(dir)) return 0;
        const kept = new Set(
          list("keep")
            .map(toSlash)
            .filter((k) => k.toLowerCase().startsWith("snapshots/"))
            .map((k) => k.slice("snapshots/".length).toLowerCase()),
        );
        let deleted = 0;
        for (const name of readdirSync(dir)) {
          if (kept.has(name.toLowerCase()) || !/^[a-z0-9]{6}\.(png|jpg)$/.test(name)) continue;
          const full = path.join(dir, name);
          if (Date.now() - statSync(full).mtimeMs < this.snapshotMinAgeMs) continue;
          rmSync(full);
          deleted++;
        }
        return deleted;
      }
      case "sha256":
        return createHash("sha256").update(readFileSync(this.allowed(str("path")))).digest("hex");
      case "fileUrl":
        return urlOf(this.inDataDir(this.home(a), str("path")));
      case "decodeImage": {
        const file = this.allowed(str("path"));
        if (!existsSync(file)) throw new Error(`File not found: ${file}`);
        if (!DECODED.has(path.extname(file).toLowerCase())) throw new Error(`Not an image that needs decoding: ${file}`);
        if (this.decodeProblem) return { problem: this.decodeProblem };
        const png = path.join(DECODED_DIR, `${path.basename(file)}.png`);
        if (!existsSync(png)) return { problem: "unreadable" };
        // PNG IHDR: width and height are at bytes 16–23
        const head = readFileSync(png).subarray(16, 24);
        return { url: urlOf(png), width: head.readUInt32BE(0), height: head.readUInt32BE(4) };
      }
      case "missing":
        return list("paths").filter((p) => !existsSync(p));
      case "getPrefs":
        return this.onboarded ? { ...this.prefs, onboarding: ONBOARDED } : this.prefs;
      case "setPrefs": {
        const { onboarding, ...rest } = a.prefs as Record<string, unknown>;
        this.prefs = this.onboarded ? rest : { ...rest, ...(onboarding === undefined ? {} : { onboarding }) };
        return null;
      }
      case "appInfo": {
        // Same as Bridge.AppInfo: the rename notice must be computed before the startup notice is taken (both are given only the first time)
        const renamed = !this.startupNoticeTaken && this.renamedFromPizhu;
        const notice = this.startupNoticeTaken ? null : this.startupNotice;
        this.startupNoticeTaken = true;
        return {
          version: VERSION,
          startupNotice: notice,
          renamedFromPizhu: renamed,
          systemLanguage: this.systemLanguage,
          logDir: path.join(this.opts.tempDir, "logs"),
          pastedDir: this.pastedDir,
          portable: false,
          built: new Date().toISOString(),
          dotnet: "e2e",
          webview2: "e2e",
          os: "e2e (X64)",
          exe: "e2e",
          settingsPath: path.join(this.opts.tempDir, "settings.json"),
          userName: "tester",
          ...this.appInfoPatch,
        };
      }
      case "checkUpdates":
        return this.updateResult;
      case "reveal": {
        // Same as Shell.Reveal: a missing path throws FileNotFoundException (code notFound); @settings, @app, @logs are resolved by the shell itself
        const p = str("path");
        if (!p.startsWith("@") && !existsSync(p)) throw Object.assign(new Error(`找不到文件或文件夹：${p}`), { code: "notFound" });
        this.revealed.push(p);
        return null;
      }
      case "copyImages": {
        const items = a.items as MockHost["copiedImages"][number];
        if (!Array.isArray(items) || items.length === 0) throw new Error("Nothing to copy");
        this.copiedImages.push(items);
        return { count: items.length };
      }
      case "exportDiagnostics": {
        // Same as Bridge.ExportDiagnostics: the path chosen in the Save dialog is set by nextExportPath (null = cancelled); records the diagnostic info handed over
        this.exported.push(str("text"));
        return this.nextExportPath;
      }
      case "openExternal": {
        // Same as HostServices.OpenUrl: only http / https are accepted
        const url = str("url");
        if (!/^https?:\/\//i.test(url)) throw new Error(`Only http and https addresses can be opened: ${url}`);
        this.opened.push(url);
        return null;
      }
      case "captureHotkeyPause":
        this.hotkeyPaused = a.pause === true;
        return null;
      case "openScreenAccessSettings":
        this.screenAccessOpened++;
        return null;
      case "openDevTools":
      case "windowResize":
      case "captureStart":
        return null;
      case "log":
        this.logs.push({ level: String(a.level), message: String(a.message) });
        return null;
      case "window": {
        // Same as MainWindow.Command: Maximize does nothing in full screen, and leaving full screen restores the state from before; Reset Layout first leaves full screen and returns to the normal state
        const action = str("action");
        const w = this.window;
        if (!["minimize", "maximize", "fullscreen", "topmost", "resetLayout", "close", "quit"].includes(action))
          throw new Error(`不支持的窗口操作：${action}`);
        if (action === "maximize" && !w.fullscreen) w.maximized = !w.maximized;
        if (action === "fullscreen") w.fullscreen = !w.fullscreen;
        if (action === "topmost") w.topmost = !w.topmost;
        if (action === "resetLayout") Object.assign(w, { maximized: false, fullscreen: false });
        return this.windowState();
      }
      case "windowState":
        return this.windowState();
      case "windowDrag":
      case "windowZoom":
        this.windowCalls.push(method);
        return null;
      case "setMenus":
        this.menusSent.push(a as unknown as (typeof this.menusSent)[number]);
        return null;
      case "captureSettings":
        return this.captureState();
      case "setCaptureSettings": {
        // Same as MainWindow.SetCapture: the shortcut is registered first and only saved if that works
        const { hotkey, ...rest } = a as { hotkey?: string } & Record<string, unknown>;
        Object.assign(this.capture, rest);
        if (typeof hotkey === "string") {
          if (this.hotkeyTaken.has(hotkey)) this.capture.hotkeyError = `${hotkey.split("+").join(" ")} 已被其他程序占用，请更换快捷键`;
          else Object.assign(this.capture, { hotkey, hotkeyError: null });
        }
        return this.captureState();
      }
      case "shellIntegration":
        return this.shellIntegration;
      case "setShellIntegration":
        if (!this.shellIgnoresWrites) this.shellIntegration = a.enable === true;
        return null;
      default:
        throw new Error(`Unsupported method: ${method}`);
    }
  }

  /** Same as MainWindow.CaptureState: which characters the current shortcut types is computed each time; the note about a moved key is given only once (TakeHotkeyMoved) */
  private captureState() {
    const moved = this.capture.hotkeyMoved;
    this.capture.hotkeyMoved = null;
    return {
      ...this.capture,
      hotkeyMoved: moved,
      hotkeyTypes: this.typingKeys[this.capture.hotkey] ?? "",
      defaultFolder: path.join(this.opts.tempDir, "captures"),
    };
  }

  // ---------- Library (same as Library.Add) ----------

  /** Same as Library.Retarget: this entry moves to target, and whatever is under it in the expanded / collapsed / last selected records moves with it */
  retarget(entry: Entry, target: string) {
    const old = entry.path;
    entry.path = target;
    const move = (p: string) => (same(p, old) ? target : inside(p, old) ? path.join(target, path.relative(old, p)) : p);
    this.expanded = this.expanded.map(move);
    this.collapsed = this.collapsed.map(move);
    if (this.selected) this.selected = move(this.selected);
  }

  /** Same as Bridge.AfterAdd: when the page is to be reloaded (reloadOnNextAdd) the result is queued and the UI side says nothing */
  private afterAdd(r: ReturnType<MockHost["add"]>) {
    if (!this.reloadOnNextAdd) return { ...r, reloading: false };
    this.reloadOnNextAdd = false;
    this.stash(r);
    return { ...r, reloading: true };
  }

  private stash(r: ReturnType<MockHost["add"]>) {
    this.pendingFocus = r.focus ?? this.pendingFocus;
    this.pendingSkipped.push(...r.skipped);
    this.pendingRelocated.push(...r.relocated);
  }

  /**
   * Same as MainWindow.OpenFromOutside: something was opened from the context menu / command line while the app is running (forwarded by another process).
   * It is added to the library and libraryChanged is pushed; listening = false simulates the UI not having read the library yet (still loading), in which case it is queued and taken with the next library read
   */
  openFromOutside(paths: string[], listening = true) {
    const r = this.add(paths);
    if (!listening) return this.stash(r);
    this.emit({ event: "libraryChanged", focus: r.focus, skipped: r.skipped, relocated: r.relocated });
  }

  add(paths: string[]) {
    const added: string[] = [];
    const skipped: string[] = [];
    const relocated: { from: string; to: string }[] = [];
    let focus: string | null = null;
    let at = this.entries.filter((e) => e.pinned).length;
    for (const raw of paths) {
      const full = norm(raw);
      const isDir = existsSync(full) && statSync(full).isDirectory();
      if (!isDir && !existsSync(full)) {
        skipped.push(`找不到文件或文件夹：${full}`);
        continue;
      }
      if (full.split(path.sep).some((s) => [DATA_DIR, LEGACY_DATA_DIR].includes(s.toLowerCase()))) {
        skipped.push(`此项属于批注数据（位于 ${DATA_DIR} 中），不能作为素材添加：${full}`);
        continue;
      }
      if (!isDir && !kindOf(full)) {
        skipped.push(`不支持此文件类型（${path.extname(full)}）：${path.basename(full)}`);
        continue;
      }
      focus ??= full;
      if (this.entries.some((e) => same(e.path, full) || this.covers(e.path, full))) continue;
      // Same as Library.MovedFrom: an entry that is no longer found has moved, so its path is replaced in place instead of adding another
      const moved = this.entries.find(
        (e) =>
          path.basename(e.path).toLowerCase() === path.basename(full).toLowerCase() &&
          (isDir ? !kindOf(e.path) : path.extname(e.path).toLowerCase() === path.extname(full).toLowerCase()) &&
          !same(e.path, full) &&
          !existsSync(e.path) &&
          // An entry on a drive that isn't there (USB drive unplugged) doesn't count as moved
          existsSync(path.parse(e.path).root),
      );
      if (moved) {
        relocated.push({ from: moved.path, to: full });
        this.retarget(moved, full);
        added.push(full);
        continue;
      }
      let pinned = false;
      if (isDir) {
        const absorbed = this.entries.filter((e) => this.covers(full, e.path));
        at -= this.entries.slice(0, at).filter((e) => absorbed.includes(e)).length;
        this.entries = this.entries.filter((e) => !absorbed.includes(e));
        pinned = absorbed.some((e) => e.pinned);
      }
      if (pinned) {
        this.entries.splice(this.entries.filter((e) => e.pinned).length, 0, { path: full, pinned });
        at++;
      } else this.entries.splice(at++, 0, { path: full, pinned });
      added.push(full);
    }
    return { added, focus, skipped, relocated };
  }

  /** Same as Library.Covers: whether scanning folder would list p (no dot-prefixed or skipped folder on the way, and the file's kind is on) */
  private covers(folder: string, p: string): boolean {
    if (!inside(p, folder)) return false;
    const parts = path.relative(norm(folder), norm(p)).split(path.sep);
    let cur = norm(folder);
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      cur = path.join(cur, name);
      if (name.startsWith(".") || !existsSync(cur)) return false;
      if (statSync(cur).isDirectory()) {
        if (this.skipDirs().has(name.toLowerCase())) return false;
      } else if (i < parts.length - 1 || !this.listed(name) || name.startsWith("~$")) return false;
    }
    return true;
  }

  private enabledKinds = () => (this.prefs?.kinds as Record<string, boolean> | undefined) ?? { image: true, video: true, pdf: false, slides: false };
  /** Same as MaterialScanner.Listed: its kind is on, and it's a common format or More formats is on */
  private listed = (name: string) => {
    const kind = kindOf(name);
    return !!kind && this.enabledKinds()[kind] !== false && (this.prefs?.moreFormats === true || !MORE.has(path.extname(name).toLowerCase()));
  };
  private skipDirs = () => new Set(((this.prefs?.skipDirs as string[] | undefined) ?? DEFAULT_SKIP).map((s) => s.toLowerCase()));

  /** Same as Library.OuterFolder: the outermost folder entry in the library that contains p (or is p) */
  private outerFolder(p: string): string | null {
    return (
      this.entries
        .filter((e) => (same(e.path, p) || inside(p, e.path)) && existsSync(e.path) && statSync(e.path).isDirectory())
        .map((e) => norm(e.path))
        .sort((a, b) => a.length - b.length)[0] ?? null
    );
  }

  // ---------- Scanning (same as Bridge.ScanAsync + MaterialScanner + HomeFinder) ----------

  private scanEntry(raw: string) {
    const entry = norm(raw);
    const outer = this.outerFolder(entry);
    if (existsSync(entry) && statSync(entry).isFile()) {
      const home = this.findHome(entry, outer);
      const m = this.describe(entry, entry, home, false);
      if (m) this.homes.add(home.toLowerCase());
      return { entry, kind: "file", project: home, materials: m ? [m] : [] };
    }
    if (existsSync(entry) && statSync(entry).isDirectory()) {
      const folderEntry = outer ?? entry;
      const stats = { others: 0, exts: new Set<string>(), moreOff: 0, moreExts: new Set<string>(), skipped: new Set<string>(), truncated: false };
      const materials = this.walk(entry, stats).map((f) => {
        const home = this.findHome(f, folderEntry);
        this.homes.add(home.toLowerCase());
        return this.describe(f, entry, home, true)!;
      });
      // Same as MaterialScanner.Scan: the list only counts as incomplete if there is more beyond the limit; hitting the limit exactly doesn't
      const truncatedAt = stats.truncated ? this.scanLimit : null;
      return {
        entry,
        kind: "folder",
        project: this.existingHome(entry) ?? folderEntry,
        materials,
        truncatedAt,
        others: stats.others ? { count: stats.others, exts: [...stats.exts].sort() } : null,
        moreOff: stats.moreOff ? { count: stats.moreOff, exts: [...stats.moreExts].sort() } : null,
        skippedDirs: stats.skipped.size ? [...stats.skipped].sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" })) : null,
      };
    }
    // Same as Bridge.ScanEntry: if the .sniptoss of the project it belongs to still exists it is returned (keptHome), so the UI can still read the notes
    const kept = this.existingHome(path.dirname(entry));
    if (kept) this.homes.add(kept.toLowerCase());
    return { entry, kind: "missing", project: kept ?? path.dirname(entry), keptHome: kept ?? null, materials: [] };
  }

  private describe(file: string, entry: string, home: string, inFolder: boolean) {
    const kind = kindOf(file);
    if (!kind) return null;
    const st = statSync(file);
    return {
      path: file,
      rel: inFolder ? toSlash(path.relative(entry, file)) : path.basename(file),
      kind,
      size: st.size,
      mtime: Math.round(st.mtimeMs),
      ctime: Math.round(st.birthtimeMs),
      home,
      homeRel: toSlash(path.relative(home, file)),
      url: urlOf(file),
    };
  }

  private walk(
    root: string,
    stats?: { others: number; exts: Set<string>; moreOff: number; moreExts: Set<string>; skipped: Set<string>; truncated: boolean },
  ): string[] {
    const enabled = this.enabledKinds();
    const skip = this.skipDirs();
    const found: string[] = [];
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop()!;
      for (const d of readdirSync(dir, { withFileTypes: true })) {
        if (d.name.startsWith(".")) continue;
        const full = path.join(dir, d.name);
        if (d.isDirectory()) {
          if (!skip.has(d.name.toLowerCase())) stack.push(full);
          else stats?.skipped.add(d.name);
        } else if (d.name.startsWith("~$")) continue;
        else if (this.listed(d.name)) found.push(full);
        else if (stats && NOT_YET.has(path.extname(d.name).toLowerCase())) {
          stats.others++;
          stats.exts.add(path.extname(d.name).slice(1).toLowerCase());
        } else if (stats && MORE.has(path.extname(d.name).toLowerCase()) && enabled[kindOf(full)] !== false) {
          stats.moreOff++;
          stats.moreExts.add(path.extname(d.name).slice(1).toLowerCase());
        }
      }
    }
    if (stats) stats.truncated = found.length > this.scanLimit;
    return found.sort().slice(0, this.scanLimit);
  }

  private existingHome(dir: string): string | null {
    for (let d = dir; ; ) {
      if (existsSync(path.join(d, DATA_DIR)) || existsSync(path.join(d, LEGACY_DATA_DIR))) return d;
      const parent = path.dirname(d);
      if (parent === d) return null;
      d = parent;
    }
  }

  private findHome(file: string, folderEntry: string | null): string {
    const dir = path.dirname(file);
    return this.existingHome(dir) ?? folderEntry ?? dir;
  }

  // ---------- Reading and writing the notes folder (same as Bridge's Home / InDataDir / WriteAsync and DataDir's Active / Migrate) ----------

  private home(a: Record<string, unknown>): string {
    const h = norm(String(a.home ?? ""));
    if (!this.homes.has(h.toLowerCase())) throw new Error(`Unknown notes folder: ${h}`);
    return h;
  }

  private inDataDir(home: string, rel: string): string {
    if (path.isAbsolute(rel)) throw new Error(`Relative path required: ${rel}`);
    const full = path.resolve(home, rel);
    if (!full.toLowerCase().startsWith((path.join(home, DATA_DIR) + path.sep).toLowerCase())) throw new Error(`Only files in ${DATA_DIR}/ can be written: ${rel}`);
    if (!existsSync(home)) throw new Error(`素材文件夹已不存在（可能已被删除、重命名或移动），批注未保存：${home}`);
    return full;
  }

  /** Which folder to read notes from: .sniptoss if it exists, otherwise the old .pizhu if it hasn't been migrated yet */
  private activeDataDir(home: string): string {
    const current = path.join(home, DATA_DIR);
    const legacy = path.join(home, LEGACY_DATA_DIR);
    return existsSync(current) || !existsSync(legacy) ? current : legacy;
  }

  /** When a project is opened, moves the old-named .pizhu to .sniptoss: rename first, and if that fails copy it over and delete the old one; the old write-back script is deleted */
  private migrateDataDir(home: string) {
    const legacy = path.join(home, LEGACY_DATA_DIR);
    const current = path.join(home, DATA_DIR);
    if (!existsSync(legacy) || existsSync(current)) return;
    try {
      renameSync(legacy, current);
    } catch {
      const staging = `${current}.migrating-${randomBytes(6).toString("hex")}`;
      cpSync(legacy, staging, { recursive: true });
      renameSync(staging, current);
      rmSync(legacy, { recursive: true, force: true });
    }
    rmSync(path.join(current, "pizhu.cmd"), { force: true });
  }

  private allowed(p: string): string {
    if (!this.entries.some((e) => same(p, e.path) || inside(p, e.path))) throw new Error(`Path is not in the material list or a notes folder: ${p}`);
    return p;
  }

  private write(home: string, rel: string, bytes: Buffer) {
    this.atomicWrite(this.inDataDir(home, rel), bytes);
    this.watch(home);
    this.ensureGitIgnore(home);
    return null;
  }

  /** Same as DataDir.EnsureGitIgnore: after something has been written, puts a .gitignore there if there is none (ignoring only temp and lock files); an existing one is left alone */
  private ensureGitIgnore(home: string) {
    const file = path.join(home, DATA_DIR, ".gitignore");
    if (!existsSync(file) && existsSync(path.dirname(file))) writeFileSync(file, GIT_IGNORE);
  }

  private atomicWrite(full: string, bytes: Buffer) {
    mkdirSync(path.dirname(full), { recursive: true });
    const tmp = path.join(path.dirname(full), `.${path.basename(full)}.${process.pid}-${randomBytes(6).toString("hex")}.tmp`);
    writeFileSync(tmp, bytes);
    // Same as AtomicFile.Write: Windows refuses to replace a target that another program has open (an agent reading it), so wait a moment and retry
    for (let attempt = 1; ; attempt++) {
      try {
        renameSync(tmp, full);
        return;
      } catch (e) {
        if (attempt >= 10 || !["EPERM", "EBUSY", "EACCES"].includes((e as NodeJS.ErrnoException).code ?? "")) {
          rmSync(tmp, { force: true });
          throw e;
        }
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * attempt);
      }
    }
  }

  /** Same as Bridge.ReadProject: the raw text of project.json (null if there is none) and whether REVIEW.md exists (see "Folder settings" in docs/annotation-format.md) */
  readProject(home: string) {
    const dir = this.activeDataDir(home);
    const file = path.join(dir, "project.json");
    return { text: existsSync(file) ? readFileSync(file, "utf8") : null, review: existsSync(path.join(dir, "REVIEW.md")) };
  }

  readAnnotations(home: string) {
    const dir = path.join(this.activeDataDir(home), "annotations");
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .map((name) => ({ name, text: readFileSync(path.join(dir, name), "utf8").replace(/^\uFEFF/, "") }));
  }

  /** Sequence number of the notes content read / written (same as Bridge.Observe, ADR-0005 item 8) */
  private observed = 0;
  observe() {
    return ++this.observed;
  }

  /** Notes folder → the fingerprint last seen (same as AnnotationWatcher in app/ChangeWatch.cs) */
  private annotationSigs = new Map<string, { home: string; sig: string }>();
  /** Item entry → the fingerprint last seen (same as MaterialWatcher, simplified: scans everything every time) */
  private materialSigs = new Map<string, string>();
  private poller: NodeJS.Timeout | undefined;

  /**
   * Same as app/ChangeWatch.cs: check periodically, compare fingerprints, and push only on a change (no fs.watch: like FileSystemWatcher it holds the folder open, so tests couldn't rename or move it).
   * The shell checks once a second; here it is 200 ms to keep tests fast
   */
  private startPolling() {
    if (this.poller || this.disposed) return;
    this.poller = setInterval(() => {
      if (this.disposed || this.muted) return;
      for (const [key, { home, sig }] of this.annotationSigs) {
        const now = this.annotationSig(home);
        if (now === sig) continue;
        this.annotationSigs.set(key, { home, sig: now });
        const seq = this.observe(); // Take the sequence number before reading, same as ChangeWatch
        this.emit({ event: "annotationsChanged", home, seq, annotations: this.readAnnotations(home) });
      }
      const dirty: string[] = [];
      for (const e of this.entries) {
        const now = this.materialSig(e.path);
        const old = this.materialSigs.get(e.path.toLowerCase());
        this.materialSigs.set(e.path.toLowerCase(), now);
        if (old !== undefined && old !== now) dirty.push(e.path);
      }
      if (dirty.length) this.emit({ event: "materialsChanged", entries: dirty });
    }, 200);
  }

  private syncMaterialWatch() {
    for (const e of this.entries) if (!this.materialSigs.has(e.path.toLowerCase())) this.materialSigs.set(e.path.toLowerCase(), this.materialSig(e.path));
    this.startPolling();
  }

  private annotationSig(home: string): string {
    const dir = path.join(this.activeDataDir(home), "annotations");
    if (!existsSync(dir)) return "";
    return readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .sort()
      .map((n) => {
        const st = statSync(path.join(dir, n));
        return `${n}:${st.size}:${st.mtimeMs}`;
      })
      .join("|");
  }

  /** The item fingerprint of one library entry: dot-prefixed paths (the data folder) don't count */
  private materialSig(entry: string): string {
    if (!existsSync(entry)) return "missing";
    const st = statSync(entry);
    if (!st.isDirectory()) return `${st.size}:${st.mtimeMs}`;
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name.startsWith(".")) continue;
        const full = path.join(dir, name);
        const s = statSync(full);
        if (s.isDirectory()) walk(full);
        else out.push(`${full}:${s.size}:${s.mtimeMs}`);
      }
    };
    walk(entry);
    return out.sort().join("|");
  }

  /** Same as MainWindow.Watch: starts watching this notes folder (even if it doesn't exist yet; it is pushed once it appears) */
  private watch(home: string) {
    if (!this.annotationSigs.has(home.toLowerCase())) this.annotationSigs.set(home.toLowerCase(), { home, sig: this.annotationSig(home) });
    this.startPolling();
  }
}

/** Same as Bridge.TextSha256 / textSha256 in host.ts */
export function textSha256(text: string | null): string | null {
  return text === null ? null : createHash("sha256").update(text, "utf8").digest("hex");
}
