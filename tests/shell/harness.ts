// Fixture for the real-shell smoke tests (docs/adr/0004-testing-layers.md, layer 4): each test starts a SnipToss.exe test instance
// and Playwright connects to its WebView2 over CDP.
// Division of labor with layer 3 (tests/e2e, mock host): that layer tests everything in the UI; this one only tests that the bridge
// really works: virtual host mapping, real disk reads and writes, file watching, single instance, tray, process crash and reload.
//
// Instances don't disturb each other, nor any installed copy of the app that is in use:
// - SNIPTOSS_SETTINGS points to a temp folder → settings, logs and WebView2 data all live there,
//   and the single-instance check is per settings file
// - the debugging port is 0; the real port is read from DevToolsActivePort in the WebView2 data folder,
//   so it doesn't clash with 9333 used by the inspection scripts
// - the capture hotkey is empty (doesn't take Ctrl+Alt+A from an installed copy), the tray hint is marked as seen (no system notification)
// - the system clipboard is left alone (tests that copy first replace navigator.clipboard in the page)
// The app is the one `npm run e2e:shell` builds into tests/shell/.app, not the usual app/bin.

import { test as base, expect, chromium, type Browser, type Page } from "@playwright/test";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = fileURLToPath(new URL("../..", import.meta.url));
// The performance budget (npm run perf) measures a release-style build (ReadyToRun, self-contained) in .app-r2r:
// playwright.perf.config.ts sets SNIPTOSS_SHELL_EXE
export const EXE = process.env.SNIPTOSS_SHELL_EXE ?? join(ROOT, "tests", "shell", ".app", "SnipToss.exe");
const FIXTURE = join(ROOT, "tests", "e2e", "fixtures", "project");
export const CLI = join(ROOT, "packages", "cli", "dist", "index.js");
const APP_URL = "https://app.sniptoss.example/";
/**
 * An unreachable network share (192.0.2.x is reserved for documentation and never answers):
 * a real check waits for the system timeout, 10–40 seconds.
 * In a test instance the shell's Volumes answers "not there" for it after a fixed 3 seconds (TestHooks.DeadShare);
 * code that checks it directly, bypassing Volumes, still waits for the real timeout
 */
export const DEAD_SHARE = String.raw`\\192.0.2.1\share`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits until check() returns a truthy value; throws on timeout (with `what` saying what we were waiting for) */
export async function waitFor<T>(
  what: string,
  check: () => T | undefined | null | false | Promise<T | undefined | null | false>,
  timeout = 15_000,
): Promise<T> {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await check();
    if (v) return v;
    if (Date.now() > end) throw new Error(`Gave up after ${timeout} ms waiting for: ${what}`);
    await sleep(100);
  }
}

export interface Shell {
  /** The test instance's temp folder: settings.json, logs\ and WebView2\ are all here */
  temp: string;
  /** The temporary project with files to annotate (a copy of tests/e2e/fixtures/project), already in the library */
  project: string;
  /** The first instance's process */
  proc: ChildProcess | null;
  /** The UI page currently connected (only after launch) */
  page: Page;
  /**
   * Starts the first instance, connects to the UI and waits for the library to appear.
   * tray = pass --tray (as at login: tray only, no window, no UI built);
   * withoutUi = start a copy of the app without the ui folder (an incomplete install): the UI can't start, so don't connect;
   * connect = false: other cases where the UI can't start, don't connect either;
   * verbatim = args are put on the command line exactly as given, with no quoting or escaping (write the quotes yourself): what File Explorer
   * produces from the registered right-click command `"SnipToss.exe" "%V"`, where `"X:\"` reaches the program as `X:"`
   */
  launch(opts?: { args?: string[]; tray?: boolean; cwd?: string; withoutUi?: boolean; connect?: boolean; verbatim?: boolean }): Promise<void>;
  /**
   * Starts one process per entry of argsList at the same moment (no head start for any of them, as when Explorer opens a multi-selection),
   * waits until exactly one is left running, makes that one "the first instance" (shell.proc) and connects to its UI.
   * Returns the exit codes of the others (in the order they were started)
   */
  launchMany(argsList: string[][]): Promise<(number | null)[]>;
  /** Connects to the UI once it is built (for a --tray start, wait until the window shows) */
  connect(): Promise<Page>;
  /**
   * Starts another process (same settings as the first = same single instance), waits for it to exit, returns the exit code.
   * cwd = its current folder (to test relative paths)
   */
  second(args: string[], opts?: { cwd?: string; verbatim?: boolean }): Promise<number | null>;
  /** Whether the first instance's process is still running */
  alive(): boolean;
  /** Force-ends the first instance (like "End task" in Task Manager, WebView2 child processes included) and waits until it is gone */
  kill(): Promise<void>;
  /** The first instance's window is shown (not hidden in the tray) */
  windowShown(): boolean;
  /**
   * The top-level windows the first instance shows (one per line: handle WxH title);
   * close = also send each WM_CLOSE (what Alt+F4 ends up as, without touching the keyboard)
   */
  windows(close?: boolean): string[];
  /** The main window (the one with the product name in its title) as it is now, in physical pixels; undefined when not shown */
  windowInfo(): WindowInfo | undefined;
  /** Restores the main window (like clicking it in the taskbar: back to maximized if it was maximized before minimizing); no mouse movement */
  restoreWindow(): void;
  /** Moves the main window to x,y and resizes it to width × height (physical pixels), without moving the mouse */
  moveWindow(x: number, y: number, width: number, height: number): void;
  /** The text and buttons in the native windows the first instance shows (error window, notice page, system message box) (UI Automation) */
  nativeWindows(): NativeWindow[];
  /** Clicks the button with that name in a native window (UI Automation Invoke, without moving the mouse) */
  clickNative(button: string): void;
  /** Calls a shell method the way a UI button does (doesn't wait for the reply) */
  callHost(method: string, params?: unknown): Promise<void>;
  /** Calls a shell method and waits for the reply */
  ask<T>(method: string, params?: unknown): Promise<T>;
  /** The new process the first instance starts itself (error window "Restart"): waits for it and makes it "the first instance" (ended at cleanup) */
  adoptRestarted(): Promise<void>;
  /** Reads one notes file in the project */
  annotations(file: string): { id: string; status: string; body: string; replies: unknown[] }[];
  /** All lines in the log */
  log(): string[];
  /** Replaces the library before launch (for the performance budget: a project with 20,000 files and 1000 notes) */
  setLibrary(paths: string[]): void;
  /** Performance records (SNIPTOSS_PERF_LOG): name → the milliseconds recorded each time, e.g. { "Process start → UI ready": [812], "Hotkey → capture overlay shown": [96] } */
  perf(): Record<string, number[]>;
  /** [ERROR] lines in the log are expected in this test (e.g. the UI process is crashed on purpose) */
  allowLogErrors(): void;
}

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
/** One line of windows.ps1 -Uia */
export interface NativeWindow {
  handle: number;
  title: string;
  texts: string[];
  buttons: string[];
  /** Where each button is on screen, in the same order as buttons (physical pixels); null for one with no place on screen (hidden, not laid out yet) */
  buttonRects: (Rect | null)[];
}

/** One line of windows.ps1 -Info */
export interface WindowInfo {
  handle: number;
  title: string;
  zoomed: boolean;
  iconic: boolean;
  topmost: boolean;
  /** Desktop composition doesn't draw it (a restored window stays hidden until it has painted) */
  cloaked: boolean;
  rect: Rect;
  /** Where the top-left corner of the client area is on screen */
  client: { x: number; y: number };
  /** The monitor the window is on and its work area (taskbar excluded) */
  monitor: Rect;
  work: Rect;
}

/**
 * The feature tour and hints count as seen (onboarding.ts in packages/web):
 * otherwise the first file dims the whole window for the tour and covers what the test clicks
 */
export const ONBOARDED = ["tour", "hint.copy", "hint.video"];

function settingsJson(project: string, library = [project]) {
  return JSON.stringify(
    {
      Library: library.map((p) => ({ Path: p, Pinned: false })),
      Expanded: [join(project, "assets"), join(project, "video")],
      Prefs: { panelResolved: true, onboarding: ONBOARDED },
      // The first-use note under the capture overlay's magnifier counts as seen too
      // (the test in capture.spec.ts that covers it resets this itself)
      Capture: { Hotkey: "", KeepInTray: true, TrayHintShown: true, SelectHintDone: true },
    },
    null,
    2,
  );
}

/** Spawn options for putting the arguments on the Windows command line as they are, with the program path quoted like the shell does */
function verbatim(exe: string, on?: boolean) {
  return on ? { windowsVerbatimArguments: true, argv0: `"${exe}"` } : {};
}

/** Ends a process tree (SnipToss.exe and its msedgewebview2 children); callers wait until it is really gone, or the temp folder can't be deleted */
function killTree(pid: number) {
  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
}

export const test = base.extend<{ shell: Shell }>({
  shell: async ({}, use) => {
    if (!existsSync(EXE)) throw new Error(`${EXE} does not exist: run npm run e2e:shell first (it builds the UI and the shell)`);
    const temp = mkdtempSync(join(tmpdir(), "shell-"));
    const project = join(temp, "project");
    cpSync(FIXTURE, project, { recursive: true });
    const settings = join(temp, "settings.json");
    writeFileSync(settings, settingsJson(project));
    const env = {
      ...process.env,
      SNIPTOSS_SETTINGS: settings,
      SNIPTOSS_PERF_LOG: join(temp, "perf.log"),
      SNIPTOSS_TEST_DEAD_SHARE: DEAD_SHARE,
      // This variable overrides the browser arguments the app sets itself, so the autoplay one has to be included here
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: "--remote-debugging-port=0 --autoplay-policy=no-user-gesture-required",
    };
    const portFile = join(temp, "WebView2", "EBWebView", "DevToolsActivePort");
    const logDir = join(temp, "logs");
    const others: ChildProcess[] = [];
    /** Processes not started here that must also be ended at cleanup (the new process started by "Restart") */
    const adopted: number[] = [];
    /** The new process taken over after "Restart" (not a ChildProcess: whether it is alive has to be asked of the system) */
    let adoptedPid = 0;
    let browser = null as Browser | null;
    let allowErrors = false;
    const pid = () => adoptedPid || shell.proc!.pid!;
    const windowsPs1 = (extra: string[]) => {
      const args = ["-NoProfile", "-File", join(ROOT, "tests", "shell", "windows.ps1"), "-ProcessId", String(pid()), ...extra];
      const r = spawnSync("pwsh", args, { encoding: "utf8" });
      if (r.status !== 0) throw new Error(`windows.ps1 failed: ${r.stderr}`);
      return r.stdout.split(/\r?\n/).filter(Boolean);
    };

    const shell: Shell = {
      temp,
      project,
      proc: null,
      page: undefined as unknown as Page,
      async launch(opts = {}) {
        const args = [...(opts.tray ? ["--tray"] : []), ...(opts.args ?? [])];
        // Starting again after an exit (to measure a hot start): the last debugging port file is still there and would connect to the old port
        rmSync(portFile, { force: true });
        adoptedPid = 0;
        let exe = EXE;
        if (opts.withoutUi) {
          const from = dirname(EXE);
          cpSync(from, join(temp, "app"), { recursive: true, filter: (src) => src !== join(from, "ui") });
          exe = join(temp, "app", "SnipToss.exe");
        }
        shell.proc = spawn(exe, args, { env, stdio: "ignore", cwd: opts.cwd, ...verbatim(exe, opts.verbatim) });
        if (!opts.tray && !opts.withoutUi && opts.connect !== false) await shell.connect();
      },
      async launchMany(argsList) {
        rmSync(portFile, { force: true });
        adoptedPid = 0;
        const procs = argsList.map((args) => spawn(EXE, args, { env, stdio: "ignore" }));
        others.push(...procs); // ended at cleanup if still running
        const running = () => procs.filter((p) => p.exitCode === null && p.signalCode === null);
        await waitFor("all but one process to exit", () => running().length === 1, 30_000);
        shell.proc = running()[0];
        await shell.connect();
        return procs.filter((p) => p !== shell.proc).map((p) => p.exitCode);
      },
      async connect() {
        const port = await waitFor(
          "the UI's debugging port",
          () => existsSync(portFile) && Number(readFileSync(portFile, "utf8").split("\n")[0]),
        );
        await browser?.close().catch(() => {}); // when reconnecting (after the UI process crashed and reloaded), drop the old connection first
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
        const page = await waitFor("the UI page", () =>
          browser!
            .contexts()
            .flatMap((c) => c.pages())
            .find((p) => p.url().startsWith(APP_URL)),
        );
        await expect(page.locator(".lib-row").first()).toBeVisible({ timeout: 15_000 });
        shell.page = page;
        return page;
      },
      async second(args, opts = {}) {
        const p = spawn(EXE, args, { env, stdio: "ignore", cwd: opts.cwd, ...verbatim(EXE, opts.verbatim) });
        others.push(p);
        return await new Promise((resolve) => p.once("exit", (code) => resolve(code)));
      },
      alive: () =>
        adoptedPid
          ? spawnSync("pwsh", ["-NoProfile", "-Command", `[bool](Get-Process -Id ${adoptedPid} -ErrorAction SilentlyContinue)`], { encoding: "utf8" })
              .stdout.trim() === "True"
          : shell.proc !== null && shell.proc.exitCode === null && shell.proc.signalCode === null,
      async kill() {
        killTree(pid());
        await waitFor("the process to be ended", () => !shell.alive());
      },
      windows: (close = false) => windowsPs1(close ? ["-Close"] : []),
      windowInfo: () =>
        windowsPs1(["-Info"])
          .map((line) => JSON.parse(line) as WindowInfo)
          .find((w) => /(超级批注|SnipToss)$/.test(w.title)), // the product name follows the UI language (SnipToss in the English UI)
      restoreWindow: () => void windowsPs1(["-Restore"]),
      moveWindow: (x, y, width, height) => {
        const main = shell.windowInfo();
        if (!main) throw new Error("The main window is not shown");
        windowsPs1(["-Handle", String(main.handle), "-Move", [x, y, width, height].join(",")]);
      },
      nativeWindows: () => windowsPs1(["-Uia"]).map((line) => JSON.parse(line) as NativeWindow),
      clickNative: (button) => void windowsPs1(["-Click", button]),
      ask: <T>(method: string, params?: unknown) =>
        shell.page.evaluate(
          ([m, p]) =>
            new Promise<T>((resolve, reject) => {
              const wv = (window as unknown as { chrome: { webview: EventTarget & { postMessage(m: unknown): void } } }).chrome.webview;
              const id = 910000 + Math.floor(Math.random() * 1000);
              const on = (e: Event) => {
                const d = (e as MessageEvent).data as { id?: number; result?: T; error?: string };
                if (d?.id !== id) return;
                wv.removeEventListener("message", on);
                if (d.error !== undefined) reject(new Error(d.error));
                else resolve(d.result as T);
              };
              wv.addEventListener("message", on);
              wv.postMessage({ id, method: m, params: p });
            }),
          [method, params ?? null] as const,
        ),
      async adoptRestarted() {
        const parent = shell.proc!.pid!;
        rmSync(portFile, { force: true });
        const child = await waitFor("the new process started by Restart", () => {
          const r = spawnSync(
            "pwsh",
            ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${parent} AND Name='SnipToss.exe'").ProcessId`],
            { encoding: "utf8" },
          );
          return Number(r.stdout.trim().split(/\s+/)[0]) || 0;
        });
        adopted.push(child);
        adoptedPid = child;
        await shell.connect();
      },
      callHost: (method, params) =>
        shell.page.evaluate(
          ([m, p]) =>
            (window as unknown as { chrome: { webview: { postMessage(m: unknown): void } } }).chrome.webview.postMessage({
              id: 900000 + Math.floor(Math.random() * 1000),
              method: m,
              params: p,
            }),
          [method, params ?? null] as const,
        ),
      windowShown: () => {
        // .NET's MainWindowHandle only counts a visible top-level window: it is 0 once hidden in the tray
        const r = spawnSync("pwsh", ["-NoProfile", "-Command", `(Get-Process -Id ${pid()}).MainWindowHandle`], {
          encoding: "utf8",
        });
        return r.stdout.trim() !== "0";
      },
      annotations: (file) => JSON.parse(readFileSync(join(project, ".sniptoss", "annotations", file), "utf8")).annotations,
      setLibrary: (paths) => writeFileSync(settings, settingsJson(project, paths)),
      perf: () => {
        const out: Record<string, number[]> = {};
        const file = join(temp, "perf.log");
        if (!existsSync(file)) return out;
        for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
          const m = /^\S+ (.+?) (\d+) ms/.exec(line);
          if (m) (out[m[1]] ??= []).push(Number(m[2]));
        }
        return out;
      },
      log: () =>
        existsSync(logDir)
          ? readdirSync(logDir)
              .filter((f) => f.endsWith(".log"))
              .flatMap((f) => readFileSync(join(logDir, f), "utf8").split(/\r?\n/))
          : [],
      allowLogErrors: () => {
        allowErrors = true;
      },
    };

    try {
      await use(shell);
    } finally {
      await browser?.close().catch(() => {});
      for (const p of [shell.proc, ...others]) if (p?.pid && p.exitCode === null) killTree(p.pid);
      for (const p of adopted) killTree(p);
      await waitFor(
        "the test instances to exit",
        () => [shell.proc, ...others].every((p) => !p || p.exitCode !== null || p.signalCode !== null),
        10_000,
      ).catch(() => {});
    }

    // In a normal run neither the shell nor the UI should log an error (UI errors go through the bridge into the same log)
    const errors = allowErrors ? [] : shell.log().filter((l) => l.includes("[ERROR]"));
    // WebView2 child processes take a while to exit, so retry deleting the temp folder; after the app quits by itself (menu "Exit")
    // they go even slower. If the folder still can't be deleted it is left in the temp folder and the test doesn't fail
    try {
      rmSync(temp, { recursive: true, force: true, maxRetries: 40, retryDelay: 250 });
    } catch (e) {
      console.warn(`Temp folder not deleted (harmless to leave it): ${temp}: ${(e as Error).message}`);
    }
    expect(errors, `Errors in the log:\n${errors.join("\n")}`).toEqual([]);
  },
});

export { expect };
