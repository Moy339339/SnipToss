// Screen Capture. The capture overlay is a native WPF window, tested through the test hooks (app/TestHooks.cs,
// app/Capture/CaptureOverlay.TestHooks.cs, compiled only into the shell-test build):
// - the fake monitors sit off screen (from -20000, -20000): the overlay can't be seen on screen and the screen of the machine running
//   the test isn't captured; the picture is a pattern whose color follows from the coordinates (color())
// - mouse and keyboard are injected by the test hooks and routed like the real ones (a captured mouse goes to the element that captured it;
//   a covered button can't be clicked); the real mouse and keyboard are blocked by the overlay at that point, so someone using them
//   next to the test can't interfere
// - the clipboard is replaced by a recorder; the system clipboard is untouched
// Coordinates are DIPs inside the overlay (= physical pixels at 100%). The feel of a real mouse, real mixed-DPI multi-monitor setups,
// pasting into real programs and input methods are checked by hand

import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { expect, test, waitFor, type Shell } from "./harness";

type Box = { x: number; y: number; width: number; height: number };
type Mark = {
  kind: string;
  color: string;
  size: number;
  points: number[][];
  text: string;
  note: string;
  category: string;
  /** Follow-on marks carry the first mark's number (ADR-0009) */
  number: number;
  pending: number;
  /** For a follow-on mark: the index of the first mark in marks; -1 for others */
  lead: number;
  badge: number[] | null;
};
type Layer = {
  monitor: Box & { scale: number };
  owner: boolean;
  active: boolean;
  sel: Box | null;
  hover: Box | null;
  frame: Box | null;
  tool: string;
  color: string;
  size: number | null;
  locked: boolean;
  op: string;
  captured: boolean;
  cursor: string;
  handles: boolean;
  sizeLabel: { text: string; box: Box } | null;
  /** center = the color of the cell at the middle of the magnified view (the one the crosshair marks) */
  /** hint = the few lines of explanation under the magnifier on first use (gone once a screen capture has been finished) */
  magnifier: { pos: string; color: string; center: string; box: Box; hint: string | null } | null;
  marks: Mark[];
  /** Index in marks of the picked (clicked) mark (the sub-toolbar colors and the number keys change it); -1 when nothing is picked */
  picked: number;
  drawing: Mark | null;
  overall: string;
  overallCategory: string;
  note: { title: string; text: string; category: string; overall: boolean; saveEnabled: boolean; placeholder: boolean; box: Box } | null;
  text: { text: string; size: number; color: string; box: Box } | null;
  toolbar: Box | null;
  subbar: Box | null;
  buttons: { id: string; name: string; on: boolean | null }[];
  warn: { text: string; box: Box } | null;
};
type State = { open: boolean; overlays: Layer[] };
type Shown = { kind: "toast" | "error"; title: string; detail: string; path: string | null; error: string | null };
type Clip = {
  formats: string[];
  text: string | null;
  png: { bytes: number; signature: boolean; width: number; height: number } | null;
  bitmap: { width: number; height: number; format: string } | null;
};
type Result = {
  clipboard: Clip | null;
  clipboardAttempts: number;
  shown: Shown[];
  saved: string | null;
  image: { width: number; height: number } | null;
  pixels: string[] | null;
  /** Toast windows still open; excluded = a screen grab doesn't catch it */
  windows: { kind: "toast" | "error"; excluded: boolean }[];
};
type Op = Record<string, unknown> & { op: string };

const OFF = -20000;
type Monitor = { x: number; y: number; width: number; height: number; scale?: number };
const ONE: Monitor[] = [{ x: OFF, y: OFF, width: 1280, height: 720, scale: 1 }];
/** Two: 1280×720 on the left and another 1280×720 right next to it */
const TWO: Monitor[] = [ONE[0], { x: OFF + 1280, y: OFF, width: 1280, height: 720, scale: 1 }];

const hex = (...rgb: number[]) => rgb.map((v) => (v & 255).toString(16).padStart(2, "0")).join("");
/** The color of physical pixel x, y on the fake picture (same as CaptureFakes.Pattern in TestHooks), m = which monitor */
const color = (x: number, y: number, m = 0) => hex((x >> 8) + (y >> 8) * 16 + m * 64, y, x);

const state = (shell: Shell) => shell.ask<State>("debugCaptureState");
const layer = async (shell: Shell, i = 0) => (await state(shell)).overlays[i];
const result = (shell: Shell, pixels?: number[][]) => shell.ask<Result>("debugCaptureResult", { pixels });
/** Runs a few steps in order and returns how layer number monitor looks afterwards (and each step's return value) */
async function run(shell: Shell, ops: Op[], monitor = 0) {
  const r = await shell.ask<{ results: unknown[]; state: State }>("debugCaptureDo", { monitor, ops });
  return Object.assign(r.state.overlays[monitor] ?? ({} as Layer), { results: r.results, open: r.state.open, all: r.state.overlays });
}

/**
 * Switches to fake monitors and opens the capture overlay. via: hotkey = the capture hotkey (the main window isn't hidden),
 * button = the title bar button (captureStart, hides the main window first), tray = the tray menu
 */
async function open(
  shell: Shell,
  o: {
    monitors?: Monitor[];
    windows?: Box[];
    cursor?: [number, number];
    clipboardFailures?: number;
    via?: "hotkey" | "button" | "tray";
    fail?: boolean;
    /** Creating the finish toast or error toast window throws at once */
    toastFails?: boolean;
  } = {},
) {
  const monitors = o.monitors ?? ONE;
  await shell.ask("debugCaptureFake", {
    monitors,
    windows: o.windows ?? [],
    cursor: o.cursor ?? null,
    clipboardFailures: o.clipboardFailures ?? 0,
    fail: !!o.fail,
    toastFails: !!o.toastFails,
  });
  if (o.via === "button") await shell.callHost("captureStart");
  else if (o.via === "tray") await shell.callHost("debugTrayAct", { action: "截图批注" });
  else await shell.ask("debugHotkey");
  if (o.fail || monitors.length === 0) return;
  await waitFor("the capture overlay to appear", async () => {
    const s = await state(shell);
    return s.open && s.overlays.length === monitors.length;
  });
}

/** Drags out a selection (default 200,200 → 600,500, 400×300) */
const select = (shell: Shell, from = [200, 200], to = [600, 500], monitor = 0) => run(shell, [{ op: "drag", from, to }], monitor);

const closed = async (shell: Shell) => expect((await state(shell)).open).toBe(false);

/**
 * Written into the settings file before launch. Once loaded, the UI writes its whole remembered copy of the settings back (when the
 * library records "which files are new"), which overwrites anything written through the bridge after launch;
 * a user changes settings in the settings page, which the UI knows about, so that doesn't happen to them
 */
function presetPrefs(shell: Shell, prefs: Record<string, unknown>) {
  const file = join(shell.temp, "settings.json");
  const s = JSON.parse(readFileSync(file, "utf8"));
  s.Prefs = { ...s.Prefs, ...prefs };
  writeFileSync(file, JSON.stringify(s, null, 2));
}

/** Changes the mark color in the real settings page (Settings → Annotations → Mark color) and waits for it to be written to the settings file */
async function pickMarkColor(shell: Shell, c: string) {
  const page = shell.page;
  await page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Control+,");
  await page.locator(".settings-tab", { hasText: /^批注$/ }).click();
  // A swatch's screen-reader name is the color's name (e.g. "蓝色"), so find it by the order of the row in settings (same as MARK_COLORS)
  const order = ["#ff6a3d", "#ff4d6d", "#ffc233", "#3ddc84", "#5b8cff", "#b07cff"];
  await page.locator(".swatches .swatch").nth(order.indexOf(c)).click();
  await waitFor("the setting to be written to the settings file", () => JSON.parse(readFileSync(join(shell.temp, "settings.json"), "utf8")).Prefs?.markColor === c);
  await page.keyboard.press("Escape");
}

/** Tries to register this global hotkey in another process: success = nobody holds it (the test instance really unregistered it); it is unregistered again at once */
function hotkeyFree(mods: number, vk: number) {
  const script = `
Add-Type -Namespace T -Name H -MemberDefinition '[DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr h, int id, uint m, uint vk); [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr h, int id);'
if ([T.H]::RegisterHotKey([IntPtr]::Zero, 77, ${mods}, ${vk})) { [void][T.H]::UnregisterHotKey([IntPtr]::Zero, 77); 'free' } else { 'taken' }`;
  const r = spawnSync("pwsh", ["-NoProfile", "-Command", script], { encoding: "utf8" });
  return r.stdout.trim() === "free";
}

// ---------- 1. Entry points and the global hotkey ----------

test("Hotkey: one overlay per monitor, the one under the cursor gets the keyboard, the main window stays; pressing again opens no second set and brings the layer being selected to the front", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell, { monitors: TWO, cursor: [OFF + 1280 + 100, OFF + 100] });
  let s = await state(shell);
  expect(s.overlays.map((o) => o.monitor.x)).toEqual([OFF, OFF + 1280]);
  expect(s.overlays.map((o) => o.active)).toEqual([false, true]);
  expect(s.overlays.every((o) => o.sel === null && o.toolbar === null)).toBe(true);
  expect(shell.windowShown()).toBe(true);
  // Selected on the first monitor while the cursor is still on the second: pressing the hotkey again brings the first one (being selected) to the front
  await select(shell);
  await shell.ask("debugHotkey");
  await waitFor("the first layer to come to the front", async () => (await layer(shell, 0)).active);
  s = await state(shell);
  expect(s.overlays.length).toBe(2);
  expect(s.overlays[0].sel).toEqual({ x: 200, y: 200, width: 400, height: 300 });
  await run(shell, [{ op: "key", key: "Escape" }]);
  await closed(shell);
});

test("Pressing the hotkey while nothing is selected: the layer brought to the front is the one on the monitor under the mouse", async ({ shell }) => {
  await shell.launch();
  await open(shell, { monitors: TWO, cursor: [OFF + 100, OFF + 100] });
  expect((await state(shell)).overlays.map((o) => o.active)).toEqual([true, false]);
  await shell.ask("debugCaptureFake", { off: true }); // switching back to the real thing ends the capture: close it first, then reopen with a different cursor position
  await open(shell, { monitors: TWO, cursor: [OFF + 1300, OFF + 100] });
  expect((await state(shell)).overlays.map((o) => o.active)).toEqual([false, true]);
});

test("Title bar button: the main window hides first and comes back after cancel or finish; with \"hide this window while capturing\" off it isn't hidden", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell, { via: "button" });
  expect(shell.windowShown()).toBe(false);
  await run(shell, [{ op: "key", key: "Escape" }]);
  await waitFor("the main window to come back", () => shell.windowShown());
  // A restored window stays cloaked until it has painted (it used to flash a white frame): count it as back only once uncloaked
  await waitFor("the main window to be uncloaked", () => shell.windowInfo()?.cloaked === false);
  // Finish brings it back too (close the overlay → restore the main window → composite and put it on the clipboard)
  await open(shell, { via: "button" });
  await select(shell);
  await run(shell, [{ op: "key", key: "Enter" }]);
  await waitFor("the main window to come back", () => shell.windowShown());
  expect((await result(shell)).clipboard).not.toBeNull();
  await shell.ask("setCaptureSettings", { hideWindow: false });
  await open(shell, { via: "button" });
  expect(shell.windowShown()).toBe(true);
  await run(shell, [{ op: "key", key: "Escape" }]);
});

test("No monitor could be captured: no overlay opens, a line is logged, and the main window still comes back when started from the button", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell, { monitors: [], via: "button" });
  await waitFor("the log line", () => shell.log().some((l) => l.includes("no display could be grabbed")));
  await waitFor("the main window to come back", () => shell.windowShown());
  await closed(shell);
});

test("The capture overlay can't open (the screen grab fails): the reason is shown, the main window comes back, no stuck \"capturing\" state remains, and it can be opened again", async ({
  shell,
}) => {
  await shell.launch();
  shell.allowLogErrors(); // "the capture overlay can't open" is logged as an ERROR
  await open(shell, { fail: true, via: "button" });
  await waitFor("the error to be shown", async () => (await result(shell)).shown.length > 0);
  const r = await result(shell);
  expect(r.shown[0]).toMatchObject({ kind: "error", title: "无法启动截图批注", error: "Test hook: screen capture failed" });
  await waitFor("the main window to come back", () => shell.windowShown());
  await closed(shell);
  expect(shell.log().some((l) => l.includes("Screen Capture could not open"))).toBe(true);
  await open(shell);
  expect((await state(shell)).open).toBe(true);
});

test("Clearing the hotkey means unused: it is really unregistered in the system; paused while the settings page records a new key and restored afterwards", async ({
  shell,
}) => {
  await shell.launch();
  const CTRL_ALT_SHIFT = 0x1 | 0x2 | 0x4;
  const F9 = 0x78; // not F11: the tray test (tray.spec.ts) registers it in a parallel run at the same time
  expect(hotkeyFree(CTRL_ALT_SHIFT, F9)).toBe(true);
  expect(await shell.ask("setCaptureSettings", { hotkey: "Ctrl+Alt+Shift+F9" })).toMatchObject({ hotkey: "Ctrl+Alt+Shift+F9", hotkeyError: null });
  expect(hotkeyFree(CTRL_ALT_SHIFT, F9)).toBe(false);
  await shell.ask("captureHotkeyPause", { pause: true });
  expect(hotkeyFree(CTRL_ALT_SHIFT, F9)).toBe(true);
  await shell.ask("captureHotkeyPause", { pause: false });
  expect(hotkeyFree(CTRL_ALT_SHIFT, F9)).toBe(false);
  expect(await shell.ask("setCaptureSettings", { hotkey: "" })).toMatchObject({ hotkey: "", hotkeyError: null });
  expect(hotkeyFree(CTRL_ALT_SHIFT, F9)).toBe(true);
});

// ---------- 2. Scale factors, multiple monitors, finding windows ----------

test("150% screen: the layer size is physical pixels divided by the scale and window positions are converted; the selection, size and composited image are all in physical pixels", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell, { monitors: [{ x: OFF, y: OFF, width: 1920, height: 1080, scale: 1.5 }], windows: [{ x: OFF + 300, y: OFF + 150, width: 600, height: 450 }] });
  const o = await run(shell, [{ op: "move", x: 300, y: 200 }]);
  expect(o.hover).toEqual({ x: 200, y: 100, width: 400, height: 300 });
  expect(o.sizeLabel!.text).toBe("600 × 450");
  // physical pixel 300, 200 → DIP 200, 133.33: the magnifier shows physical pixels
  expect(o.magnifier!.pos).toBe("x 450  y 300");
  const s = await select(shell, [100, 100], [300, 200]);
  expect(s.sel).toEqual({ x: 100, y: 100, width: 200, height: 100 });
  expect(s.sizeLabel!.text).toBe("300 × 150");
  await run(shell, [{ op: "key", key: "Enter" }]);
  const r = await result(shell, [
    [0, 0],
    [299, 149],
  ]);
  expect(r.image).toEqual({ width: 300, height: 150 });
  expect(r.pixels).toEqual([color(150, 150), color(449, 299)]);
});

test("The selection snaps to physical pixels: at 125%, dragging to fractional DIPs lands the selection on whole pixels", async ({ shell }) => {
  await shell.launch();
  await open(shell, { monitors: [{ x: OFF, y: OFF, width: 1600, height: 900, scale: 1.25 }] });
  const s = await select(shell, [100.3, 100.3], [300.5, 200.7]);
  for (const v of [s.sel!.x, s.sel!.y, s.sel!.width, s.sel!.height]) expect(Math.abs(v * 1.25 - Math.round(v * 1.25))).toBeLessThan(1e-6);
});

test("Multiple monitors: a selection lives on one monitor; pressing on another hands over to it while nothing is drawn, and does nothing once something is drawn (the keyboard returns to the drawn layer)", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell, { monitors: TWO });
  await select(shell);
  let b = await run(shell, [{ op: "move", x: 100, y: 100 }, { op: "down", x: 100, y: 100 }, { op: "up", x: 100, y: 100 }], 1);
  expect(b.owner).toBe(true);
  expect(b.sel).toEqual({ x: 0, y: 0, width: 1280, height: 720 }); // no windows: a single click = the whole monitor
  expect(b.all[0].sel).toBeNull();
  expect(b.all[0].toolbar).toBeNull();
  // back to the first monitor: select and draw a box (locks it)
  await run(shell, [{ op: "right", x: 50, y: 50 }], 1);
  await select(shell);
  await run(shell, [{ op: "key", key: "R" }, { op: "drag", from: [250, 250], to: [350, 350] }, { op: "key", key: "Escape" }]);
  b = await run(shell, [{ op: "drag", from: [100, 100], to: [500, 400] }], 1);
  expect(b.sel).toBeNull();
  expect(b.owner).toBe(false);
  expect(b.all[0].sel).toEqual({ x: 200, y: 200, width: 400, height: 300 });
  expect(b.all[0].marks.length).toBe(1);
  await waitFor("the keyboard to go back to the first layer", async () => (await layer(shell, 0)).active);
  // Unsaved text alone counts as having drawn something: the other monitor can't take over, and the text here stays
  await run(shell, [{ op: "key", key: "Z", ctrl: true }]);
  await run(shell, [{ op: "key", key: "N" }, { op: "type", text: "还没保存" }]);
  b = await run(shell, [{ op: "drag", from: [100, 100], to: [500, 400] }], 1);
  expect(b.sel).toBeNull();
  expect(b.all[0].note).toMatchObject({ overall: true, text: "还没保存" });
});

test("Hover: the topmost window under the mouse is highlighted (the whole monitor if none), also on open without moving; moving to another monitor removes this one's highlight and magnifier", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell, {
    monitors: TWO,
    // the earlier one in the list is on top and covers the later one
    windows: [
      { x: OFF + 150, y: OFF + 150, width: 200, height: 150 },
      { x: OFF + 100, y: OFF + 100, width: 600, height: 400 },
    ],
    cursor: [OFF + 160, OFF + 160],
  });
  let a = await layer(shell, 0);
  expect(a.hover).toEqual({ x: 150, y: 150, width: 200, height: 150 });
  expect(a.frame).not.toBeNull();
  a = await run(shell, [{ op: "move", x: 500, y: 400 }]);
  expect(a.hover).toEqual({ x: 100, y: 100, width: 600, height: 400 });
  expect(a.magnifier).not.toBeNull();
  a = await run(shell, [{ op: "move", x: 900, y: 600 }]);
  expect(a.hover).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  a = await run(shell, [{ op: "leave" }]);
  expect(a.hover).toBeNull();
  expect(a.magnifier).toBeNull();
  expect(a.frame).toBeNull();
  // A window spanning two monitors: each keeps only the part on its own monitor; parts too narrow (< 8) are dropped
  await shell.ask("debugCaptureFake", { off: true });
  await open(shell, {
    monitors: TWO,
    windows: [
      { x: OFF + 1000, y: OFF + 100, width: 600, height: 300 },
      { x: OFF + 1276, y: OFF + 500, width: 10, height: 100 },
    ],
  });
  a = await run(shell, [{ op: "move", x: 1100, y: 200 }]);
  expect(a.hover).toEqual({ x: 1000, y: 100, width: 280, height: 300 });
  const b = await run(shell, [{ op: "move", x: 100, y: 200 }], 1);
  expect(b.hover).toEqual({ x: 0, y: 100, width: 320, height: 300 });
  expect((await run(shell, [{ op: "move", x: 1278, y: 550 }])).hover).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
});

// ---------- 3. Selection: pick, adjust, lock ----------

test("Just opened: the whole screen is dimmed with no box or toolbar; a click selects the hovered window, or the whole monitor if none; a box dragged in any of four directions works; too small a box reverts", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell, { windows: [{ x: OFF + 100, y: OFF + 100, width: 400, height: 300 }] });
  let o = await layer(shell);
  expect([o.sel, o.toolbar, o.frame, o.magnifier]).toEqual([null, null, null, null]);
  // A click (moving no more than 3): selects the hovered window
  o = await run(shell, [{ op: "move", x: 150, y: 150 }, { op: "down", x: 150, y: 150 }, { op: "move", x: 152, y: 152 }, { op: "up" }]);
  expect(o.sel).toEqual({ x: 100, y: 100, width: 400, height: 300 });
  expect(o.owner).toBe(true);
  expect(o.toolbar).not.toBeNull();
  expect(o.captured).toBe(false);
  // Right-click to reselect; dragging from bottom-right to top-left is normalized
  o = await run(shell, [{ op: "right" }, { op: "drag", from: [900, 600], to: [700, 450] }]);
  expect(o.sel).toEqual({ x: 700, y: 450, width: 200, height: 150 });
  // The toolbar hides during a drag; dragging off screen clamps to the screen edge
  o = await run(shell, [{ op: "right" }, { op: "drag", from: [1000, 500], to: [1500, 900], hold: true }]);
  expect(o.toolbar).toBeNull();
  expect(o.sel).toEqual({ x: 1000, y: 500, width: 280, height: 220 });
  o = await run(shell, [{ op: "up" }]);
  expect(o.toolbar).not.toBeNull();
  // Too small (width < 4): reverts to the selection from before the press
  o = await run(shell, [{ op: "drag", from: [100, 650], to: [102, 700] }]);
  expect(o.sel).toEqual({ x: 1000, y: 500, width: 280, height: 220 });
  // A too-small drag with no selection: reverts to the hovered window
  o = await run(shell, [{ op: "right" }, { op: "move", x: 150, y: 150 }, { op: "drag", from: [150, 150], to: [152, 190] }]);
  expect(o.sel).toEqual({ x: 100, y: 100, width: 400, height: 300 });
  // A click where there is no window: the whole monitor
  o = await run(shell, [{ op: "right" }, { op: "move", x: 900, y: 600 }, { op: "down", x: 900, y: 600 }, { op: "up" }]);
  expect(o.sel).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
});

test("Magnifier and size label: hover shows coordinates and color, dragging shows width × height; the magnifier flips near the bottom-right edge; the label sits 6 above the box, or inside it when there's no room", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell);
  let o = await run(shell, [{ op: "move", x: 300, y: 260 }]);
  expect(o.magnifier).toMatchObject({ pos: "x 300  y 260", color: `#${color(300, 260).toUpperCase()}` });
  expect(o.magnifier!.box.x).toBe(320);
  expect(o.magnifier!.box.y).toBe(280);
  o = await run(shell, [{ op: "move", x: 1250, y: 700 }]);
  expect(o.magnifier!.box.x + o.magnifier!.box.width).toBe(1230);
  expect(o.magnifier!.box.y + o.magnifier!.box.height).toBe(680);
  o = await run(shell, [{ op: "drag", from: [200, 200], to: [600, 500], hold: true }]);
  expect(o.magnifier!.pos).toBe("400 × 300");
  o = await run(shell, [{ op: "up" }]);
  expect(o.sizeLabel!.text).toBe("400 × 300");
  expect(o.sizeLabel!.box.y + o.sizeLabel!.box.height).toBe(194);
  // Once a selection is made, moving the mouse hides the magnifier
  o = await run(shell, [{ op: "move", x: 300, y: 300 }]);
  expect(o.magnifier).toBeNull();
  // A selection against the top edge of the screen: the label goes inside the box
  o = await run(shell, [{ op: "right" }, { op: "drag", from: [200, 0], to: [600, 300] }]);
  expect(o.sizeLabel!.box.y).toBe(6);
});

test("First use: a hint under the magnifier says how to select, goes away once dragging starts, doesn't count when cancelled, and is gone after one finished capture", async ({
  shell,
}) => {
  const file = join(shell.temp, "settings.json");
  const s = JSON.parse(readFileSync(file, "utf8"));
  writeFileSync(file, JSON.stringify({ ...s, Capture: { ...s.Capture, SelectHintDone: false } }, null, 2));
  const done = () => JSON.parse(readFileSync(file, "utf8")).Capture?.SelectHintDone === true;
  await shell.launch();
  await open(shell);
  let o = await run(shell, [{ op: "move", x: 300, y: 260 }]);
  expect(o.magnifier!.hint).toBe("拖动以选择区域\n单击以选择窗口\n按 Esc 退出");
  // The hint lives inside the magnifier, which still flips to the other side of the cursor near the bottom-right edge and stays on screen
  o = await run(shell, [{ op: "move", x: 1250, y: 700 }]);
  expect(o.magnifier!.box.y + o.magnifier!.box.height).toBe(680);
  o = await run(shell, [{ op: "drag", from: [200, 200], to: [600, 500], hold: true }]);
  expect(o.magnifier!.hint).toBeNull();
  await run(shell, [{ op: "up" }, { op: "key", key: "Escape" }]);
  await closed(shell);
  expect(done()).toBe(false);

  await open(shell);
  o = await run(shell, [{ op: "move", x: 300, y: 260 }]);
  expect(o.magnifier!.hint).not.toBeNull();
  await select(shell);
  await run(shell, [{ op: "key", key: "Enter" }]);
  await closed(shell);
  await waitFor("the finished state to be recorded", done);

  await open(shell);
  o = await run(shell, [{ op: "move", x: 300, y: 260 }]);
  expect(o.magnifier!.hint).toBeNull();
  await run(shell, [{ op: "key", key: "Escape" }]);
});

test("Moving the selection, pulling the eight handles, cursor shapes; moving and pulling are clamped to the screen, pulling past the opposite edge flips, too small reverts; clicking outside the box changes nothing", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell);
  let o = await select(shell);
  expect(o.handles).toBe(true);
  const cursorAt = async (x: number, y: number) => (await run(shell, [{ op: "move", x, y }])).cursor;
  expect(await cursorAt(200, 200)).toBe("nwse");
  expect(await cursorAt(600, 500)).toBe("nwse");
  expect(await cursorAt(600, 200)).toBe("nesw");
  expect(await cursorAt(400, 203)).toBe("ns"); // the whole edge, ±4, can be pulled
  expect(await cursorAt(597, 350)).toBe("we");
  expect(await cursorAt(400, 350)).toBe("sizeall");
  expect(await cursorAt(100, 100)).toBe("arrow");
  // Move: the toolbar hides while dragging and comes back on release
  o = await run(shell, [{ op: "drag", from: [400, 350], to: [450, 330], hold: true }]);
  expect(o.toolbar).toBeNull();
  expect(o.sel).toEqual({ x: 250, y: 180, width: 400, height: 300 });
  o = await run(shell, [{ op: "up" }]);
  expect(o.toolbar).not.toBeNull();
  // Move off screen: clamped at the edge
  o = await run(shell, [{ op: "drag", from: [450, 330], to: [2000, -500] }]);
  expect(o.sel).toEqual({ x: 880, y: 0, width: 400, height: 300 });
  // Pull the bottom-left corner to the top-right: the height becomes 0, too small, so it reverts to the previous one
  o = await run(shell, [{ op: "drag", from: [880, 300], to: [1200, 0] }]);
  expect(o.sel).toEqual({ x: 880, y: 0, width: 400, height: 300 });
  o = await run(shell, [{ op: "drag", from: [880, 300], to: [1000, 500] }]);
  expect(o.sel).toEqual({ x: 1000, y: 0, width: 280, height: 500 });
  // Pull the right edge left past the left edge
  o = await run(shell, [{ op: "drag", from: [1280, 250], to: [900, 250] }]);
  expect(o.sel).toEqual({ x: 900, y: 0, width: 100, height: 500 });
  // Click outside the box (no drag): no change
  o = await run(shell, [{ op: "down", x: 200, y: 600 }, { op: "up" }]);
  expect(o.sel).toEqual({ x: 900, y: 0, width: 100, height: 500 });
});

test("With a tool picked a drag inside the box draws while handles within 6 of the edge still resize; a drag outside re-selects; once something is drawn the selection is locked", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell);
  await select(shell);
  let o = await run(shell, [{ op: "key", key: "R" }, { op: "move", x: 400, y: 350 }]);
  expect(o.cursor).toBe("tool");
  // On the box edge (the border line included) counts as inside: draws; within 6 outside is a handle
  expect((await run(shell, [{ op: "move", x: 600, y: 350 }])).cursor).toBe("tool");
  expect((await run(shell, [{ op: "move", x: 604, y: 350 }])).cursor).toBe("we");
  // A drag outside: pulls out a new selection (nothing drawn yet)
  o = await run(shell, [{ op: "drag", from: [700, 100], to: [1000, 400] }]);
  expect(o.sel).toEqual({ x: 700, y: 100, width: 300, height: 300 });
  // The half of the handle outside the box resizes (also works with a tool picked)
  o = await run(shell, [{ op: "drag", from: [1004, 404], to: [1100, 500] }]);
  expect(o.sel).toEqual({ x: 700, y: 100, width: 400, height: 400 });
  // A drag inside the box = draw a rectangle
  o = await run(shell, [{ op: "drag", from: [750, 150], to: [850, 250] }, { op: "key", key: "Escape" }]);
  expect(o.marks.map((m) => m.kind)).toEqual(["rect"]);
  expect(o.locked).toBe(true);
  expect(o.handles).toBe(false);
  // Once locked: put the tool down; dragging inside or outside the box, pulling a corner and arrow keys all do nothing
  o = await run(shell, [{ op: "click", id: "rect" }]);
  expect(o.tool).toBe("none");
  o = await run(shell, [
    { op: "drag", from: [900, 300], to: [950, 350] },
    { op: "drag", from: [100, 100], to: [300, 300] },
    { op: "drag", from: [1100, 500], to: [1200, 600] },
    { op: "key", key: "Left" },
    { op: "right", x: 900, y: 300 },
  ]);
  expect(o.sel).toEqual({ x: 700, y: 100, width: 400, height: 400 });
  expect(o.marks.length).toBe(1);
  expect((await run(shell, [{ op: "move", x: 900, y: 300 }])).cursor).toBe("arrow");
});

// ---------- 4. Toolbar and sub-toolbar ----------

test("Toolbar: right-aligned under the selection, above it when there's no room below, inside the bottom of the selection when neither fits; hidden while dragging, moving and pulling; buttons and tooltips", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell);
  let o = await select(shell);
  expect(o.toolbar!.x + o.toolbar!.width).toBe(600);
  expect(o.toolbar!.y).toBe(508);
  expect(o.buttons.filter((b) => !b.id.startsWith("size") && !b.id.startsWith("color")).map((b) => [b.id, b.name])).toEqual([
    ["rect", "矩形（R）"],
    ["ellipse", "椭圆（O）"],
    ["arrow", "箭头（A）"],
    ["pen", "画笔（B）"],
    ["mosaic", "马赛克（M）"],
    ["text", "文字：在图片上添加文字（T）"],
    ["note", "图钉：单击放置标记并填写批注（C）"],
    ["overall", "整体意见：不指定位置（N）"],
    ["undo", "撤销（Ctrl Z）"],
    ["cancel", "取消截图（Esc）"],
    ["done", "完成并复制到剪贴板（Enter 或双击选区）"],
  ]);
  // Against the bottom of the screen: placed above
  o = await run(shell, [{ op: "right" }, { op: "drag", from: [300, 400], to: [700, 700] }]);
  expect(o.toolbar!.y + o.toolbar!.height).toBe(392);
  // Whole monitor: placed inside the bottom of the selection
  o = await run(shell, [{ op: "right" }, { op: "down", x: 640, y: 360 }, { op: "up" }]);
  expect(o.sel).toEqual({ x: 0, y: 0, width: 1280, height: 720 });
  expect(o.toolbar!.y + o.toolbar!.height).toBe(712);
  expect(o.toolbar!.x + o.toolbar!.width).toBe(1276); // kept 4 inside the screen
  // A selection against the left edge and narrower than the toolbar: the toolbar is kept inside the screen and doesn't stick out on the left
  o = await run(shell, [{ op: "right" }, { op: "drag", from: [0, 100], to: [100, 200] }]);
  expect(o.toolbar!.x).toBe(4);
});

test("Sub-toolbar: only when a drawing tool is picked; three thicknesses (none for Pin), six colors (none for Pixelate); Text has font sizes; each tool remembers its own step", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell);
  let o = await select(shell);
  expect(o.subbar).toBeNull();
  const ids = (l: Layer) => l.buttons.filter((b) => b.id.startsWith("size") || b.id.startsWith("color")).map((b) => (b.name ? `${b.id}:${b.name}` : b.id));
  const colors = ["color-ff6a3d:橙色", "color-ff4d6d:红色", "color-ffc233:黄色", "color-3ddc84:绿色", "color-5b8cff:蓝色", "color-b07cff:紫色"];
  o = await run(shell, [{ op: "click", id: "rect" }]);
  expect(ids(o)).toEqual(["size-0:粗细 2", "size-1:粗细 4", "size-2:粗细 6", ...colors]);
  expect(o.size).toBe(2);
  // With the toolbar below, the sub-toolbar sits 6 below it
  expect(o.subbar!.y).toBe(o.toolbar!.y + o.toolbar!.height + 6);
  o = await run(shell, [{ op: "click", id: "mosaic" }]);
  expect(ids(o)).toEqual(["size-0:粗细 20", "size-1:粗细 32", "size-2:粗细 56"]);
  expect(o.size).toBe(32);
  o = await run(shell, [{ op: "click", id: "text" }]);
  expect(ids(o)).toEqual(["size-0:字号 14", "size-1:字号 18", "size-2:字号 24", ...colors]);
  expect(o.size).toBe(18);
  o = await run(shell, [{ op: "click", id: "note" }]);
  expect(ids(o)).toEqual(colors);
  // Rectangle remembers 6, Arrow is still the default 2; back to Rectangle it is 6 again
  o = await run(shell, [{ op: "click", id: "rect" }, { op: "click", id: "size-2" }, { op: "click", id: "arrow" }]);
  expect(o.size).toBe(2);
  o = await run(shell, [{ op: "click", id: "rect" }]);
  expect(o.size).toBe(6);
  // With the toolbar above, the sub-toolbar sits above it
  o = await run(shell, [{ op: "right", x: 100, y: 100 }, { op: "drag", from: [300, 400], to: [700, 700] }, { op: "key", key: "R" }]);
  expect(o.subbar!.y + o.subbar!.height).toBe(o.toolbar!.y - 6);
});

test("Clicking a tool picks it or puts it down; a tool key always picks; thickness doesn't affect drawn marks; color follows the setting, a picked color is remembered for the run, a changed setting wins", async ({
  shell,
}) => {
  presetPrefs(shell, { markColor: "#3ddc84" });
  await shell.launch();
  await open(shell);
  await select(shell);
  let o = await run(shell, [{ op: "click", id: "arrow" }]);
  expect(o.tool).toBe("arrow");
  expect(o.buttons.find((b) => b.id === "arrow")!.on).toBe(true);
  expect(o.color).toBe("3ddc84");
  o = await run(shell, [{ op: "click", id: "arrow" }]);
  expect(o.tool).toBe("none");
  o = await run(shell, [{ op: "key", key: "A" }, { op: "key", key: "A" }]);
  expect(o.tool).toBe("arrow");
  o = await run(shell, [{ op: "drag", from: [250, 250], to: [400, 300] }, { op: "key", key: "Escape" }, { op: "click", id: "size-2" }, { op: "click", id: "color-b07cff" }]);
  expect(o.marks[0]).toMatchObject({ kind: "arrow", size: 2, color: "3ddc84" });
  expect([o.size, o.color]).toEqual([6, "b07cff"]);
  await run(shell, [{ op: "key", key: "Escape" }]); // no note written: one press cancels
  await closed(shell);
  // Next time: still purple (remembered for this run)
  await open(shell);
  expect((await layer(shell)).color).toBe("b07cff");
  await run(shell, [{ op: "key", key: "Escape" }]);
  // Mark color changed in settings: the new one is used
  await pickMarkColor(shell, "#5b8cff");
  await open(shell);
  expect((await layer(shell)).color).toBe("5b8cff");
});

test("An invalid mark color setting: orange is used", async ({ shell }) => {
  presetPrefs(shell, { markColor: "blue" });
  await shell.launch();
  await open(shell);
  expect((await layer(shell)).color).toBe("ff6a3d");
});

// ---------- 5. How each mark is drawn ----------

test("Rectangle, ellipse, arrow, pen: the note box pops up after drawing; Shift draws a square / circle, never beyond the selection; dragging outside clamps at the box edge; too small ones aren't kept", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell);
  await select(shell);
  let o = await run(shell, [{ op: "key", key: "R" }, { op: "drag", from: [250, 250], to: [350, 300], shift: true }]);
  expect(o.marks[0]).toMatchObject({ kind: "rect", points: [[250, 250], [350, 350]], size: 2 });
  expect(o.note!.title).toBe("批注 1");
  // A square near the bottom-right of the selection: the side is clamped into the selection
  o = await run(shell, [{ op: "key", key: "Escape" }, { op: "key", key: "O" }, { op: "drag", from: [550, 450], to: [700, 480], shift: true }]);
  expect(o.marks[1]).toMatchObject({ kind: "ellipse", points: [[550, 450], [600, 500]] });
  // Dragged outside the selection: clamped at the selection edge
  o = await run(shell, [{ op: "key", key: "Escape" }, { op: "key", key: "A" }, { op: "drag", from: [300, 400], to: [900, 900] }]);
  expect(o.marks[2]).toMatchObject({ kind: "arrow", points: [[300, 400], [600, 500]] });
  o = await run(shell, [
    { op: "key", key: "Escape" },
    { op: "key", key: "B" },
    { op: "drag", from: [220, 220], to: [260, 240], steps: 4 },
  ]);
  expect(o.marks[3].kind).toBe("pen");
  expect(o.marks[3].points.length).toBe(5);
  expect(o.note).not.toBeNull();
  // Too small: a box narrower than 4, an arrow shorter than 8, a pen click without moving: none are kept and no note box pops up
  o = await run(shell, [
    { op: "key", key: "Escape" },
    { op: "key", key: "R" },
    { op: "drag", from: [400, 220], to: [403, 300] },
    { op: "key", key: "A" },
    { op: "drag", from: [400, 220], to: [405, 225] },
    { op: "key", key: "B" },
    { op: "down", x: 450, y: 220 },
    { op: "up" },
  ]);
  expect(o.marks.length).toBe(4);
  expect(o.note).toBeNull();
  expect(o.captured).toBe(false);
});

test("Pixelate: no note box, no color; in the composited image the painted area is the average color of 12×12 physical pixel blocks (at 100%)", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell);
  await select(shell);
  const o = await run(shell, [{ op: "key", key: "M" }, { op: "drag", from: [240, 246], to: [300, 246] }]);
  expect(o.marks[0]).toMatchObject({ kind: "mosaic", size: 32 });
  expect(o.note).toBeNull();
  await run(shell, [{ op: "key", key: "Enter" }]);
  // physical pixel 246, 246 falls in the 240–251 block: average B = 245, G = 245, R = 0; the unpainted area is as it was
  const r = await result(shell, [
    [46, 46],
    [100, 150],
  ]);
  expect(r.pixels).toEqual([hex(0, 245, 245), color(300, 350)]);
});

// The block used to be a fixed 12 physical pixels: at 150% it was 8 on screen and at 200% it was 6, so a pixelated email address or phone number was still readable
for (const scale of [1.5, 2]) {
  test(`At ${scale * 100}% scale a pixelate block is still 12 on screen (${12 * scale} physical pixels)`, async ({ shell }) => {
    await shell.launch();
    await open(shell, { monitors: [{ x: OFF, y: OFF, width: 1280 * scale, height: 720 * scale, scale }] });
    await select(shell);
    await run(shell, [{ op: "key", key: "M" }, { op: "drag", from: [240, 246], to: [400, 246] }, { op: "key", key: "Enter" }]);
    // Sample the painted row (DIP 240–400) pixel by pixel and count how long each run of the same color is; the runs at both ends are incomplete and don't count
    const y = 46 * scale;
    const xs = Array.from({ length: 160 * scale }, (_, i) => 40 * scale + i);
    const r = await result(shell, xs.map((x) => [x, y]));
    const runs: number[] = [];
    r.pixels!.forEach((p, i) => (i > 0 && p === r.pixels![i - 1] ? runs[runs.length - 1]++ : runs.push(1)));
    expect(runs.length).toBeGreaterThan(10);
    expect(new Set(runs.slice(1, -1))).toEqual(new Set([12 * scale]));
  });
}

// The pointer used to be an arrow while pixelating, so the width that would be painted wasn't visible.
// The circle's size, position and how visible it is on various backgrounds are tested in xUnit (ToolCursorTests)
test("The Pixelate pointer is a circle the size of the brush and follows thickness changes; switching tools by key or clicking a thickness changes the pointer at once without the mouse moving", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell, { cursor: [OFF + 400, OFF + 350] });
  await select(shell);
  // The mouse rests inside the box: pressing M shows the circle at once (it used to need a mouse move)
  let o = await run(shell, [{ op: "key", key: "M" }]);
  expect(o.cursor).toBe("brush-32");
  o = await run(shell, [{ op: "click", id: "size-2" }]);
  expect(o.cursor).toBe("brush-56");
  o = await run(shell, [{ op: "key", key: "R" }]);
  expect(o.cursor).toBe("tool");
  o = await run(shell, [{ op: "key", key: "M" }]);
  expect(o.cursor).toBe("brush-56");
  // Outside the box it is still an arrow; back inside it is the circle
  expect((await run(shell, [{ op: "move", x: 100, y: 100 }])).cursor).toBe("arrow");
  expect((await run(shell, [{ op: "move", x: 300, y: 300 }])).cursor).toBe("brush-56");
});

test("Text: a click opens the input box, Enter breaks the line, Esc / clicking elsewhere / switching tool / right-click finish it; empty text isn't kept; text opens no note box and has no number", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell);
  await select(shell);
  let o = await run(shell, [{ op: "key", key: "T" }, { op: "down", x: 300, y: 300 }, { op: "up" }]);
  expect(o.text).toMatchObject({ text: "", size: 18, color: "ff6a3d" });
  expect(o.captured).toBe(false);
  // While the input box is open letters are text, not tool keys; Enter breaks the line
  o = await run(shell, [{ op: "type", text: "ab" }, { op: "key", key: "R" }, { op: "key", key: "Enter" }, { op: "type", text: "cd" }]);
  expect(o.tool).toBe("text");
  expect(o.results[1]).toEqual({ handled: false, by: "none" });
  expect(o.text!.text).toBe("ab\r\ncd");
  o = await run(shell, [{ op: "key", key: "Escape" }]);
  expect(o.open).toBe(true); // Esc means done writing, not cancelling the capture
  expect(o.marks[0]).toMatchObject({ kind: "text", text: "ab\r\ncd", size: 18, number: 0 });
  // The text's top-left corner is where the click landed (the same after compositing as while typing)
  expect(Math.abs(o.marks[0].points[0][0] - 300)).toBeLessThanOrEqual(3);
  expect(Math.abs(o.marks[0].points[0][1] - 300)).toBeLessThanOrEqual(3);
  expect(o.note).toBeNull();
  // Clicking elsewhere = done (that click does nothing else); right-click = done; switching tool = done
  o = await run(shell, [{ op: "down", x: 400, y: 250 }, { op: "up" }, { op: "type", text: "x" }, { op: "down", x: 500, y: 400 }, { op: "up" }]);
  expect(o.marks.map((m) => m.text)).toEqual(["ab\r\ncd", "x"]);
  expect(o.text).toBeNull();
  // Right-click on the canvas (not on the text box itself: that is the input box's own menu)
  o = await run(shell, [{ op: "down", x: 400, y: 450 }, { op: "up" }, { op: "type", text: "y" }, { op: "right", x: 500, y: 300 }]);
  expect(o.text).toBeNull();
  o = await run(shell, [{ op: "down", x: 250, y: 450 }, { op: "up" }, { op: "type", text: "z" }, { op: "click", id: "rect" }]);
  expect(o.marks.map((m) => m.text)).toEqual(["ab\r\ncd", "x", "y", "z"]);
  expect(o.tool).toBe("rect");
  // Empty or whitespace-only text isn't kept
  o = await run(shell, [{ op: "key", key: "T" }, { op: "down", x: 300, y: 400 }, { op: "up" }, { op: "type", text: "   " }, { op: "key", key: "Escape" }]);
  expect(o.marks.length).toBe(4);
  // Clicking text does nothing (it is not a number)
  o = await run(shell, [{ op: "click", id: "text" }, { op: "down", x: 302, y: 305 }, { op: "up" }]);
  expect(o.note).toBeNull();
  expect(o.text).toBeNull();
});

test("Clicking a color or font size while typing: the text in the input box changes at once", async ({ shell }) => {
  await shell.launch();
  await open(shell);
  await select(shell);
  const o = await run(shell, [
    { op: "key", key: "T" },
    { op: "down", x: 300, y: 300 },
    { op: "up" },
    { op: "type", text: "字" },
    { op: "click", id: "color-3ddc84" },
    { op: "click", id: "size-2" },
  ]);
  expect(o.text).toMatchObject({ text: "字", size: 24, color: "3ddc84" });
});

test("Pin: a click drops a numbered point and opens the note box, and only Save makes it count (Esc, Cancel and empty text remove it); afterwards the toolbar and Finish can be clicked", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell);
  await select(shell);
  let o = await run(shell, [{ op: "key", key: "C" }, { op: "down", x: 300, y: 300 }, { op: "up" }]);
  expect(o.marks[0]).toMatchObject({ kind: "note", pending: 1, number: 0, badge: [300, 300] });
  expect(o.note).toMatchObject({ title: "批注 1", text: "", saveEnabled: false, placeholder: true });
  expect(o.captured).toBe(false);
  o = await run(shell, [{ op: "key", key: "Escape" }]);
  expect(o.marks).toEqual([]);
  o = await run(shell, [{ op: "down", x: 300, y: 300 }, { op: "up" }, { op: "click", id: "note-cancel" }]);
  expect(o.marks).toEqual([]);
  o = await run(shell, [{ op: "down", x: 300, y: 300 }, { op: "up" }, { op: "key", key: "Enter" }]);
  expect(o.marks).toEqual([]);
  // A greyed-out Save does nothing when clicked
  o = await run(shell, [{ op: "down", x: 300, y: 300 }, { op: "up" }, { op: "click", id: "note-save" }]);
  expect(o.note).not.toBeNull();
  o = await run(shell, [{ op: "type", text: "这里加个按钮" }, { op: "click", id: "note-save" }]);
  expect(o.marks[0]).toMatchObject({ kind: "note", number: 1, note: "这里加个按钮" });
  expect(o.locked).toBe(true);
  // The mouse isn't captured: clicking Finish on the toolbar responds (the overlay once kept hold of the mouse and froze on the first mouse use)
  o = await run(shell, [{ op: "click", id: "done" }]);
  expect(o.open).toBe(false);
  expect((await result(shell)).shown[0].title).toBe("批注图片\n已添加到剪贴板");
});

test("Overall comment: opened by N or the button, titled Overall Comment, leaves no number on the canvas; writing it locks the selection; reopening brings back the text and category; with no marks, undo clears it", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell);
  await select(shell);
  let o = await run(shell, [{ op: "key", key: "N" }]);
  expect(o.note).toMatchObject({ title: "整体意见（不指定位置）", overall: true });
  expect(o.buttons.find((b) => b.id === "overall")!.on).toBe(true);
  o = await run(shell, [{ op: "type", text: "整体偏暗" }, { op: "key", key: "D4", alt: true }, { op: "key", key: "Enter" }]);
  expect([o.overall, o.overallCategory, o.locked, o.marks.length]).toEqual(["整体偏暗", "question", true, 0]);
  o = await run(shell, [{ op: "click", id: "overall" }]);
  expect(o.note).toMatchObject({ text: "整体偏暗", category: "question" });
  o = await run(shell, [{ op: "key", key: "Escape" }, { op: "key", key: "Z", ctrl: true }]);
  expect([o.overall, o.locked]).toEqual(["", false]);
});

test("Numbers: only notes with text get one, in drawing order, renumbered after cancel, undo and clearing; placed at the top-left / tail / stroke start, at least 10 from the selection edge; clicking one edits that note", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell);
  await select(shell);
  // The first box touches the top-left of the selection: the number is clamped 10 into the selection
  let o = await run(shell, [
    { op: "key", key: "R" },
    { op: "drag", from: [200, 200], to: [300, 260] },
    { op: "type", text: "一" },
    { op: "key", key: "Enter" },
    { op: "key", key: "O" },
    { op: "drag", from: [450, 220], to: [550, 260] },
    { op: "key", key: "Escape" }, // no note written: the ellipse stays and has no number
    { op: "key", key: "A" },
    { op: "drag", from: [400, 400], to: [500, 300] },
  ]);
  expect(o.note!.title).toBe("批注 2"); // preview number = existing numbers + 1
  expect(o.marks[2]).toMatchObject({ pending: 2, badge: [400, 400] }); // an arrow's number is at its tail
  o = await run(shell, [{ op: "type", text: "二" }, { op: "key", key: "Enter" }, { op: "key", key: "B" }, { op: "drag", from: [300, 450], to: [380, 480] }]);
  o = await run(shell, [{ op: "type", text: "三" }, { op: "key", key: "Enter" }]);
  expect(o.marks.map((m) => [m.kind, m.number])).toEqual([
    ["rect", 1],
    ["ellipse", 0],
    ["arrow", 2],
    ["pen", 3],
  ]);
  expect(o.marks[0].badge).toEqual([210, 210]);
  expect(o.marks[1].badge).toBeNull();
  expect(o.marks[3].badge).toEqual([300, 450]); // the pen's is at the start of the stroke
  // Click number 1: hand cursor, brings back the text; save it emptied: the box stays, the number goes, and later ones move up
  o = await run(shell, [{ op: "move", x: 212, y: 212 }]);
  expect(o.cursor).toBe("hand");
  o = await run(shell, [{ op: "down", x: 212, y: 212 }, { op: "up" }]);
  expect(o.note).toMatchObject({ title: "批注 1", text: "一" });
  o = await run(shell, [{ op: "type", text: "", replace: true }, { op: "key", key: "Enter" }]);
  expect(o.marks.map((m) => [m.kind, m.number])).toEqual([
    ["rect", 0],
    ["ellipse", 0],
    ["arrow", 1],
    ["pen", 2],
  ]);
  // Undo removes the last one: numbers are reassigned; adding one more, the new number is 2
  o = await run(shell, [{ op: "key", key: "Z", ctrl: true }]);
  expect(o.marks.map((m) => m.number)).toEqual([0, 0, 1]);
  o = await run(shell, [{ op: "key", key: "C" }, { op: "down", x: 550, y: 450 }, { op: "up" }, { op: "type", text: "四" }, { op: "key", key: "Enter" }]);
  expect(o.marks.map((m) => m.number)).toEqual([0, 0, 1, 2]);
});

test("One note, several marks: with the note box open, the Pin tool and boxes keep adding marks under the same number (the title shows the count); Alt+Z removes the last; the text for AI lists the places (ADR-0009)", async ({
  shell,
}) => {
  await shell.launch();
  await shell.ask("setCaptureSettings", { notesInImage: false });
  await open(shell);
  await select(shell);
  // The first mark sits against the right edge of the selection: the note box goes to its right, outside the selection, so the next click
  // isn't covered (in real use the mouse moves out of the box and keeps clicking)
  let o = await run(shell, [{ op: "key", key: "C" }, { op: "down", x: 580, y: 250 }, { op: "up" }]);
  expect(o.note).toMatchObject({ title: "批注 1", placeholder: true });
  expect(o.note!.box.x).toBeGreaterThan(590);
  o = await run(shell, [{ op: "down", x: 450, y: 250 }, { op: "up" }, { op: "down", x: 300, y: 250 }, { op: "up" }]);
  expect(o.note!.title).toBe("批注 1 · 3 处");
  expect(o.marks.map((m) => [m.kind, m.pending, m.lead])).toEqual([
    ["note", 1, -1],
    ["note", 1, 0],
    ["note", 1, 0],
  ]);
  expect(o.captured).toBe(false);
  // Switch to Rectangle on the toolbar: the note box stays open and a dragged box is added too; Alt+Z removes it
  o = await run(shell, [{ op: "click", id: "rect" }, { op: "drag", from: [250, 400], to: [350, 450] }]);
  expect(o.note!.title).toBe("批注 1 · 4 处");
  o = await run(shell, [{ op: "key", key: "Z", alt: true }]);
  expect([o.note!.title, o.marks.length]).toEqual(["批注 1 · 3 处", 3]);
  o = await run(shell, [{ op: "type", text: "这三个按钮都改成圆角" }, { op: "key", key: "Enter" }]);
  expect(o.marks.map((m) => [m.number, m.lead, m.badge])).toEqual([
    [1, -1, [580, 250]],
    [1, 0, [450, 250]],
    [1, 0, [300, 250]],
  ]);
  // Click the second mark's number: it edits this note
  o = await run(shell, [{ op: "down", x: 450, y: 250 }, { op: "up" }]);
  expect(o.note).toMatchObject({ title: "批注 1 · 3 处", text: "这三个按钮都改成圆角" });
  o = await run(shell, [{ op: "key", key: "Escape" }, { op: "key", key: "Enter" }]);
  const r = await result(shell);
  expect(r.clipboard!.text).toContain("标了几处的批注，意见对每一处都适用。");
  expect(r.clipboard!.text).toMatch(/\n1\. 修改 · 3 处：位置 [^；]+；位置 [^；]+；位置 [^；]+：这三个按钮都改成圆角\r\n/);
  expect(r.shown[0].title).toBe("批注图片\n已添加到剪贴板");
});

test("Clicking a mark to change its color: with the note box open it selects that mark and a swatch changes only it; with no box open, clicking the line selects it, 1–6 change it and Esc puts it down first; the text for AI gives each mark's color when they differ", async ({
  shell,
}) => {
  await shell.launch();
  await shell.ask("setCaptureSettings", { notesInImage: false });
  await open(shell);
  await select(shell);
  // The first mark sits against the right edge of the selection: the note box goes outside the selection, so the next click isn't covered
  let o = await run(shell, [{ op: "key", key: "C" }, { op: "down", x: 580, y: 250 }, { op: "up" }, { op: "down", x: 450, y: 250 }, { op: "up" }]);
  expect([o.note!.title, o.picked]).toEqual(["批注 1 · 2 处", -1]);
  const pen = o.color;
  // The mouse over the second mark gives a hand cursor; a click selects it, and a swatch click changes that one
  o = await run(shell, [{ op: "move", x: 452, y: 251 }]);
  expect(o.cursor).toBe("hand");
  o = await run(shell, [{ op: "down", x: 452, y: 251 }, { op: "up" }]);
  expect([o.picked, o.note!.title, o.subbar === null]).toEqual([1, "批注 1 · 2 处", false]);
  o = await run(shell, [{ op: "click", id: "color-ffc233" }]);
  expect(o.marks.map((m) => m.color)).toEqual([pen, "ffc233"]);
  expect([o.color, o.picked, o.note === null]).toEqual([pen, 1, false]);
  o = await run(shell, [{ op: "type", text: "这处改成圆角，黄色那处去掉" }, { op: "key", key: "Enter" }]);
  expect([o.note, o.picked]).toEqual([null, -1]);

  // A box with no note written: clicking its edge selects it (select only, no note box), 5 turns it blue; Esc puts it down first without cancelling the capture
  o = await run(shell, [{ op: "key", key: "R" }, { op: "drag", from: [250, 350], to: [350, 450] }, { op: "key", key: "Escape" }, { op: "move", x: 350, y: 400 }]);
  expect(o.cursor).toBe("hand");
  o = await run(shell, [{ op: "down", x: 350, y: 400 }, { op: "up" }, { op: "key", key: "D5" }]);
  expect([o.picked, o.marks[2].color, o.note]).toEqual([2, "5b8cff", null]);
  o = await run(shell, [{ op: "key", key: "Escape" }]);
  expect([o.picked, o.open]).toEqual([-1, true]);

  await run(shell, [{ op: "key", key: "Enter" }]);
  const r = await result(shell);
  expect(r.clipboard!.text).toMatch(/\n1\. 修改 · 2 处：（橙色）位置 [^；]+；（黄色）位置 [^；]+：这处改成圆角，黄色那处去掉\r\n/);
});

// ---------- 6. Note box ----------

test("Note box: right of the mark, left if there's no room on the right, below if neither fits; the overall comment sits by the toolbar; stays on screen as typing makes it taller", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell);
  await run(shell, [{ op: "down", x: 640, y: 360 }, { op: "up" }]); // the whole monitor
  let o = await run(shell, [{ op: "key", key: "R" }, { op: "drag", from: [100, 100], to: [200, 200] }]);
  expect([o.note!.box.x, o.note!.box.y]).toEqual([220, 88]);
  o = await run(shell, [{ op: "key", key: "Escape" }, { op: "drag", from: [1100, 100], to: [1200, 200] }]);
  expect(o.note!.box.x + o.note!.box.width).toBe(1080);
  o = await run(shell, [{ op: "key", key: "Escape" }, { op: "drag", from: [100, 300], to: [1200, 400] }]);
  expect(o.note!.box.y).toBe(420);
  // Near the bottom of the screen: type many lines, and the whole box stays on screen
  o = await run(shell, [{ op: "key", key: "Escape" }, { op: "drag", from: [100, 600], to: [1200, 700] }]);
  for (let i = 0; i < 8; i++) o = await run(shell, [{ op: "type", text: `第 ${i} 行` }, { op: "key", key: "Enter", shift: true }]);
  expect(o.note!.box.y + o.note!.box.height).toBeLessThanOrEqual(712);
  expect(o.note!.box.y).toBeGreaterThanOrEqual(8);
});

test("Note box: category defaults to the setting and follows the previous note, Alt+1–4 or a click changes it; Enter / Ctrl+Enter / Save / clicking outside save, Shift+Enter breaks the line; Esc / right-click / Cancel write nothing", async ({
  shell,
}) => {
  presetPrefs(shell, { defaultCategory: "question" });
  await shell.launch();
  await open(shell);
  await select(shell);
  let o = await run(shell, [{ op: "key", key: "R" }, { op: "drag", from: [250, 250], to: [350, 350] }]);
  expect(o.note!.category).toBe("question");
  o = await run(shell, [{ op: "key", key: "D2", alt: true }]);
  expect(o.note!.category).toBe("remove");
  o = await run(shell, [{ op: "click", id: "category-add" }]);
  expect(o.note!.category).toBe("add");
  o = await run(shell, [{ op: "type", text: "第一行" }, { op: "key", key: "Enter", shift: true }, { op: "type", text: "第二行" }, { op: "key", key: "Enter", ctrl: true }]);
  expect(o.marks[0]).toMatchObject({ note: "第一行\r\n第二行", category: "add", number: 1 });
  // The next note starts from "Add"; clicking outside = save (that click doesn't start drawing)
  o = await run(shell, [{ op: "drag", from: [400, 250], to: [500, 350] }]);
  expect(o.note!.category).toBe("add");
  o = await run(shell, [{ op: "type", text: "二" }, { op: "down", x: 800, y: 600 }, { op: "up" }]);
  expect(o.marks[1]).toMatchObject({ note: "二", number: 2 });
  expect(o.sel).toEqual({ x: 200, y: 200, width: 400, height: 300 });
  // Editing an old note: Esc, right-click and Cancel all keep the original text
  o = await run(shell, [{ op: "click", id: "rect" }, { op: "down", x: 400, y: 250 }, { op: "up" }, { op: "type", text: "改" }, { op: "key", key: "Escape" }]);
  o = await run(shell, [{ op: "down", x: 400, y: 250 }, { op: "up" }, { op: "type", text: "改" }, { op: "right" }]);
  o = await run(shell, [{ op: "down", x: 400, y: 250 }, { op: "up" }, { op: "type", text: "改" }, { op: "click", id: "note-cancel" }]);
  expect(o.marks[1].note).toBe("二");
  // Esc after drawing a box: the box stays, with no note (a screenshot can have drawings without text)
  o = await run(shell, [{ op: "key", key: "O" }, { op: "drag", from: [450, 400], to: [550, 480] }, { op: "type", text: "不要" }, { op: "key", key: "Escape" }]);
  expect(o.marks[2]).toMatchObject({ kind: "ellipse", note: "", number: 0 });
});

// ---------- 7. Keyboard and mouse ----------

test("Esc: with no note one press cancels; with notes the first press only warns (above the toolbar row) and a second within 3 seconds cancels, otherwise the warning goes away; × and Alt+F4 behave the same", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell);
  await select(shell);
  await run(shell, [{ op: "key", key: "Escape" }]);
  await closed(shell);
  await open(shell);
  await select(shell);
  let o = await run(shell, [{ op: "key", key: "N" }, { op: "type", text: "意见" }, { op: "key", key: "Enter" }, { op: "key", key: "R" }, { op: "key", key: "Escape" }]);
  expect(o.open).toBe(true);
  expect(o.warn!.text).toBe("批注尚未复制：再次按 Esc 或单击 × 将放弃，按 Enter 完成");
  // Toolbar below the selection, sub-toolbar below the toolbar: the warning sits above the whole group
  expect(o.warn!.box.y + o.warn!.box.height).toBeLessThanOrEqual(o.toolbar!.y - 8);
  await waitFor("the warning to disappear after 3 seconds", async () => (await layer(shell)).warn === null, 5000);
  o = await run(shell, [{ op: "click", id: "cancel" }]);
  expect(o.open).toBe(true);
  o = await run(shell, [{ op: "click", id: "cancel" }]);
  expect(o.open).toBe(false);
  await open(shell);
  await select(shell);
  o = await run(shell, [{ op: "key", key: "N" }, { op: "type", text: "意见" }, { op: "key", key: "F4", alt: true }]);
  expect(o.open).toBe(true);
  expect(o.warn).not.toBeNull();
  o = await run(shell, [{ op: "key", key: "F4", alt: true }]);
  expect(o.open).toBe(false);
});

test("Enter and Ctrl+C finish; nothing happens without a selection; arrow keys move 1 pixel, Shift moves 10, clamped to the screen; at 150% they move physical pixels", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell);
  let o = await run(shell, [{ op: "key", key: "Enter" }, { op: "key", key: "C", ctrl: true }]);
  expect(o.open).toBe(true);
  expect(o.results).toEqual([{ handled: true, by: "overlay" }, { handled: true, by: "overlay" }]);
  await select(shell);
  o = await run(shell, [{ op: "key", key: "Right" }, { op: "key", key: "Down", shift: true }, { op: "key", key: "Left", shift: true }, { op: "key", key: "Up" }]);
  expect(o.sel).toEqual({ x: 191, y: 209, width: 400, height: 300 });
  for (let i = 0; i < 25; i++) await run(shell, [{ op: "key", key: "Up", shift: true }]);
  expect((await layer(shell)).sel!.y).toBe(0);
  o = await run(shell, [{ op: "key", key: "C", ctrl: true }]);
  expect(o.open).toBe(false);
  expect((await result(shell)).image).toEqual({ width: 400, height: 300 });
  await open(shell, { monitors: [{ x: OFF, y: OFF, width: 1920, height: 1080, scale: 1.5 }] });
  await select(shell, [100, 100], [300, 200]);
  o = await run(shell, [{ op: "key", key: "Right" }, { op: "key", key: "Right" }, { op: "key", key: "Right" }]);
  expect(o.sel!.x * 1.5).toBeCloseTo(153, 6);
});

test("Tool keys R O A B M T C N: need a selection first; Ctrl combinations don't count; Shift held still counts; other keys (Tab, Space, Delete, Backspace, F5) aren't handled and are passed back to the system", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell);
  let o = await run(shell, [{ op: "key", key: "R" }]);
  expect([o.tool, o.results[0]]).toEqual(["none", { handled: false, by: "none" }]);
  await select(shell);
  for (const [key, tool] of [
    ["R", "rect"],
    ["O", "ellipse"],
    ["A", "arrow"],
    ["B", "pen"],
    ["M", "mosaic"],
    ["T", "text"],
    ["C", "note"],
  ])
    expect((await run(shell, [{ op: "key", key }])).tool).toBe(tool);
  expect((await run(shell, [{ op: "key", key: "R", shift: true }])).tool).toBe("rect");
  o = await run(shell, [{ op: "key", key: "O", ctrl: true }]);
  expect([o.tool, o.results[0]]).toEqual(["rect", { handled: false, by: "none" }]);
  o = await run(shell, ["Tab", "Space", "Delete", "Back", "F5", "Home"].map((key) => ({ op: "key", key })));
  expect(o.results.every((r) => (r as { handled: boolean }).handled === false)).toBe(true);
  expect(o.open).toBe(true);
});

test("Right-click: discards the note box, finishes the text box, re-selects when nothing is drawn (other monitors too), cancels with no selection, and does nothing after drawing", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell, { monitors: TWO });
  await select(shell);
  let o = await run(shell, [{ op: "key", key: "R" }, { op: "right" }]);
  expect([o.sel, o.tool, o.owner]).toEqual([null, "none", false]);
  // No selection: right-click cancels at once
  o = await run(shell, [{ op: "right" }]);
  expect(o.open).toBe(false);
  // With a note written: a right-click on another monitor also warns first instead of dropping everything at once
  await open(shell, { monitors: TWO });
  await select(shell);
  await run(shell, [{ op: "key", key: "N" }, { op: "type", text: "意见" }, { op: "key", key: "Enter" }]);
  o = await run(shell, [{ op: "right", x: 100, y: 100 }], 1);
  expect(o.open).toBe(true);
  expect(o.all[0].warn).not.toBeNull();
  await waitFor("the keyboard to go back to the first layer", async () => (await layer(shell, 0)).active);
  // A selection but locked: right-click does nothing
  o = await run(shell, [{ op: "right", x: 300, y: 300 }]);
  expect([o.open, o.sel]).toEqual([true, { x: 200, y: 200, width: 400, height: 300 }]);
});

test("Double-click inside the box = finish (whatever tool is picked); the empty number point the first click dropped is discarded; a double-click outside the box doesn't count", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell);
  await select(shell);
  let o = await run(shell, [{ op: "dblclick", x: 700, y: 600 }]);
  expect(o.open).toBe(true);
  o = await run(shell, [{ op: "key", key: "C" }, { op: "dblclick", x: 300, y: 300 }]);
  expect(o.open).toBe(false);
  const r = await result(shell);
  expect(r.shown[0].title).toBe("截图\n已添加到剪贴板");
});

test("Undo (button or Ctrl+Z): with the note box open it only cancels the box; otherwise it removes the last mark and renumbers; with no marks it clears the overall comment", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell);
  await select(shell);
  let o = await run(shell, [
    { op: "key", key: "R" },
    { op: "drag", from: [250, 250], to: [300, 300] },
    { op: "type", text: "一" },
    { op: "key", key: "Enter" },
    { op: "drag", from: [350, 250], to: [400, 300] },
    { op: "type", text: "二" },
    { op: "key", key: "Enter" },
    { op: "key", key: "N" },
    { op: "type", text: "整体" },
    { op: "key", key: "Enter" },
  ]);
  // Undo while editing note 1: only closes the note box, both boxes stay
  o = await run(shell, [{ op: "down", x: 252, y: 252 }, { op: "up" }]);
  expect(o.note!.title).toBe("批注 1");
  o = await run(shell, [{ op: "click", id: "undo" }]);
  expect([o.note, o.marks.length]).toEqual([null, 2]);
  o = await run(shell, [{ op: "click", id: "undo" }]);
  expect(o.marks.map((m) => m.number)).toEqual([1]);
  o = await run(shell, [{ op: "key", key: "Z", ctrl: true }, { op: "key", key: "Z", ctrl: true }]);
  expect([o.marks.length, o.overall]).toEqual([0, ""]);
});

test("The mouse never gets stuck: after every kind of operation it is released; losing the capture mid-drag counts as a release", async ({ shell }) => {
  await shell.launch();
  await open(shell);
  const check = async (ops: Op[]) => {
    const o = await run(shell, ops);
    expect(o.captured, JSON.stringify(ops)).toBe(false);
    expect(o.op, JSON.stringify(ops)).toBe("none");
    return o;
  };
  await check([{ op: "drag", from: [200, 200], to: [600, 500] }]);
  await check([{ op: "drag", from: [400, 350], to: [410, 360] }]); // move
  await check([{ op: "drag", from: [610, 510], to: [620, 520] }]); // pull
  // Rectangle, ellipse, arrow and pen pop up the note box when drawn (Esc writes nothing); Pixelate doesn't
  for (const key of ["R", "O", "A", "B"]) await check([{ op: "key", key }, { op: "drag", from: [300, 300], to: [350, 350] }, { op: "key", key: "Escape" }]);
  await check([{ op: "key", key: "M" }, { op: "drag", from: [300, 300], to: [350, 350] }]);
  await check([{ op: "key", key: "T" }, { op: "down", x: 300, y: 400 }, { op: "up" }, { op: "key", key: "Escape" }]);
  await check([{ op: "key", key: "C" }, { op: "down", x: 450, y: 400 }, { op: "up" }, { op: "type", text: "a" }, { op: "key", key: "Enter" }]);
  // The capture is taken away mid-drag (Alt+Tab, a system popup): it counts as a release, and later mouse moves don't drag the mark along
  let o = await run(shell, [{ op: "key", key: "R" }, { op: "drag", from: [500, 250], to: [550, 300], hold: true }, { op: "losecapture" }]);
  expect([o.captured, o.op]).toEqual([false, "none"]);
  const before = o.marks.length;
  o = await run(shell, [{ op: "move", x: 590, y: 480 }]);
  expect(o.marks.length).toBe(before);
  expect(o.drawing).toBeNull();
  // Every button on the toolbar can be clicked
  for (const id of ["ellipse", "arrow", "pen", "mosaic", "text", "note", "rect"]) expect((await run(shell, [{ op: "click", id }])).tool).toBe(id);
  o = await run(shell, [{ op: "click", id: "done" }]);
  expect(o.open).toBe(false);
});

// ---------- 8. Finish and compositing ----------

test("Compositing: with no notes the image is the selection in physical pixels (no dimming or handles in it); marks are drawn into it; the clipboard gets a bitmap (Bgr32) and a PNG, no text", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell);
  await select(shell);
  await run(shell, [{ op: "key", key: "R" }, { op: "drag", from: [250, 250], to: [400, 350] }, { op: "key", key: "Escape" }, { op: "key", key: "Enter" }]);
  const r = await result(shell, [
    [0, 0],
    [399, 299],
    [50, 100],
    [100, 100],
  ]);
  expect(r.image).toEqual({ width: 400, height: 300 });
  expect(r.pixels).toEqual([color(200, 200), color(599, 499), "ff6a3d", color(300, 300)]);
  expect(r.clipboard).toEqual({
    formats: ["Bitmap", "PNG"],
    text: null,
    png: { bytes: expect.any(Number), signature: true, width: 400, height: 300 },
    bitmap: { width: 400, height: 300, format: "Bgr32" },
  });
  expect(r.shown).toEqual([{ kind: "toast", title: "截图\n已添加到剪贴板", detail: "", path: null, error: null }]); // just one line, no second line
});

test("Compositing: with notes a notes area is added below the image (padded with #141416), at least 420 wide; a small selection is enlarged by a whole multiple; the clipboard gets the image only", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell);
  await select(shell, [200, 200], [300, 260]);
  await run(shell, [{ op: "key", key: "C" }, { op: "down", x: 250, y: 230 }, { op: "up" }, { op: "type", text: "改成蓝色" }, { op: "key", key: "Enter" }, { op: "key", key: "Enter" }]);
  const r = await result(shell, [[0, 0]]);
  // a 100 × 60 selection is enlarged 4 times (420 / 100 = 4)
  expect(r.image!.width).toBe(420);
  expect(r.image!.height).toBeGreaterThan(240);
  expect(r.clipboard!.formats).toEqual(["Bitmap", "PNG"]);
  expect(r.clipboard!.text).toBeNull();
  expect(r.shown[0]).toMatchObject({ kind: "toast", title: "批注图片\n已添加到剪贴板", detail: "" });
  expect(r.saved && existsSync(r.saved)).toBe(true);
});

test("With \"Include notes in the image\" off: no notes area in the image, and the clipboard also gets text for AI (category · position: text, the overall comment, the screenshot file, the line appended every time)", async ({
  shell,
}) => {
  presetPrefs(shell, { promptExtra: "改完跑一遍测试" });
  await shell.launch();
  await shell.ask("setCaptureSettings", { notesInImage: false });
  await open(shell, { monitors: [{ x: OFF, y: OFF, width: 1920, height: 1080, scale: 1.5 }] });
  await select(shell, [100, 100], [500, 400]);
  await run(shell, [
    { op: "key", key: "R" },
    { op: "drag", from: [150, 150], to: [250, 200] },
    { op: "type", text: "改成蓝色" },
    { op: "key", key: "Enter" },
    { op: "key", key: "A" },
    { op: "drag", from: [300, 300], to: [400, 250] },
    { op: "key", key: "D2", alt: true },
    { op: "type", text: "删掉" },
    { op: "key", key: "Enter" },
    { op: "key", key: "C" },
    { op: "down", x: 450, y: 350 },
    { op: "up" },
    { op: "type", text: "这是什么" },
    { op: "key", key: "D4", alt: true },
    { op: "key", key: "Enter" },
    { op: "key", key: "N" },
    { op: "type", text: "整体偏暗" },
    { op: "key", key: "Enter" },
    { op: "key", key: "Enter" },
  ]);
  const r = await result(shell);
  expect(r.image).toEqual({ width: 600, height: 450 });
  expect(r.clipboard!.formats).toEqual(["Bitmap", "PNG", "UnicodeText"]);
  expect(r.clipboard!.text).toBe(
    [
      "请按这张截图上的批注修改。图上的序号与下列批注一一对应，坐标为截图中的像素位置（左上角为 0, 0）：",
      "1. 修改 · 区域 画面左上（横 13%–38%、纵 17%–33%），x=75 y=75 宽=150 高=75 px：改成蓝色",
      "2. 删除 · 箭头 从画面中央（横 50%、纵 67%）指向画面右侧居中（横 75%、纵 50%），从 (300, 300) 到 (450, 225) px：删掉",
      "3. 疑问 · 位置 画面右下（横 88%、纵 83%），x=525 y=375 px：这是什么",
      "整体意见 · 疑问：整体偏暗", // the category continues from the previous note (Question)
      "",
      `截图文件：${r.saved}（600×450）`,
      "",
      "改完跑一遍测试",
    ].join("\r\n"),
  );
  expect(r.shown[0]).toMatchObject({
    title: "批注图片\n已添加到剪贴板", // the notes aren't drawn into the image: the second-line warning would be lost
    detail: "批注未附在图片中（「在图片中附加批注」已关闭），Codex、Claude Code 粘贴时仅接收图片，批注可能丢失",
  });
});

test("Only an overall comment: the toast is still \"image with notes copied to the clipboard\", and the text for AI has a different opening", async ({
  shell,
}) => {
  await shell.launch();
  await shell.ask("setCaptureSettings", { notesInImage: false });
  await open(shell);
  await select(shell);
  await run(shell, [{ op: "key", key: "N" }, { op: "type", text: "整体偏暗" }, { op: "key", key: "Enter" }, { op: "key", key: "Enter" }]);
  const r = await result(shell);
  expect(r.shown[0].title).toBe("批注图片\n已添加到剪贴板");
  expect(r.clipboard!.text!.split("\r\n")).toEqual(["请参照这张截图，按以下整体意见修改：", "整体意见 · 修改：整体偏暗", "", `截图文件：${r.saved}（400×300）`]);
});

test("UI language is English: the capture overlay's buttons and note box, the text for AI and the finish toast are all English (ADR-0001)", async ({
  shell,
}) => {
  presetPrefs(shell, { language: "en" });
  await shell.launch();
  await shell.ask("setCaptureSettings", { notesInImage: false });
  await open(shell);
  await select(shell);
  let o = await run(shell, [{ op: "key", key: "R" }]);
  const name = (id: string) => o.buttons.find((b) => b.id === id)?.name;
  expect([name("rect"), name("undo"), name("done")]).toEqual(["Rectangle (R)", "Undo (Ctrl Z)", "Finish and copy to the clipboard (Enter, or double-click the selection)"]);
  o = await run(shell, [{ op: "drag", from: [250, 250], to: [350, 300] }]); // the default selection is (200, 200)–(600, 500)
  expect(o.note).toMatchObject({ title: "Note 1", placeholder: true });
  expect(name("category-question")).toBe("Question"); // the category buttons are in the note box
  await run(shell, [{ op: "type", text: "make it blue" }, { op: "key", key: "Enter" }, { op: "key", key: "Enter" }]);
  const r = await result(shell);
  expect(r.clipboard!.text!.split("\r\n")).toEqual([
    "Please make the changes described by the notes on this screenshot. The numbers on the image correspond one-to-one to the notes below; coordinates are pixel positions in the screenshot ((0, 0) is the top left):",
    expect.stringMatching(/^1\. Change · Region: [a-z ]+ of the frame \(x \d+%–\d+%, y \d+%–\d+%\), x=\d+ y=\d+ w=\d+ h=\d+ px: make it blue$/),
    "",
    `Screenshot file: ${r.saved} (400×300)`,
  ]);
  expect(r.shown[0]).toMatchObject({
    title: "Image with notes copied to clipboard",
    detail: "The notes aren't included in the image (“Include notes in the image” is off). Codex and Claude Code only take the image when pasting, so the notes may be lost",
  });
});

// ---------- 9. Saved files and the clipboard ----------

test("Saved file: by default in captures under the app data folder as capture-YYYY-MM-DD_HH-MM-SS.png, a same-second repeat gets -2; a folder chosen in settings is created if missing", async ({
  shell,
}) => {
  await shell.launch();
  const names: string[] = [];
  for (let i = 0; i < 2; i++) {
    await open(shell);
    await select(shell);
    await run(shell, [{ op: "key", key: "Enter" }]);
    names.push((await result(shell)).saved!);
  }
  expect(names[0].startsWith(join(shell.temp, "captures"))).toBe(true);
  expect(basename(names[0])).toMatch(/^capture-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}(-2)?\.png$/);
  expect(names[1]).not.toBe(names[0]);
  const folder = join(shell.temp, "我的截图", "新建");
  await shell.ask("setCaptureSettings", { folder });
  await open(shell);
  await select(shell);
  await run(shell, [{ op: "key", key: "Enter" }]);
  const saved = (await result(shell)).saved!;
  expect(saved.startsWith(folder)).toBe(true);
  expect(existsSync(saved)).toBe(true);
});

test("Two captures within the same second: the second gets -2 and doesn't overwrite the first", async ({ shell }) => {
  await shell.launch();
  const dir = join(shell.temp, "captures");
  mkdirSync(dir, { recursive: true });
  // First occupy the names for this second and the next few: whichever second it is saved in, the name collides
  const stamp = (d: Date) => {
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
  };
  const now = Date.now();
  for (let i = 0; i < 6; i++) writeFileSync(join(dir, `capture-${stamp(new Date(now + i * 1000))}.png`), "x");
  await open(shell);
  await select(shell);
  await run(shell, [{ op: "key", key: "Enter" }]);
  expect(basename((await result(shell)).saved!)).toMatch(/-2\.png$/);
});

test("Saving to the archive fails (the folder can't be created): the clipboard still gets the image, the toast says the image wasn't saved and where to change that; the text for AI gives no path that doesn't exist", async ({
  shell,
}) => {
  await shell.launch();
  shell.allowLogErrors(); // the log line for a failed save is an ERROR
  const blocker = join(shell.temp, "是个文件");
  writeFileSync(blocker, "x");
  await shell.ask("setCaptureSettings", { folder: join(blocker, "截图"), notesInImage: false });
  await open(shell);
  await select(shell);
  await run(shell, [{ op: "key", key: "N" }, { op: "type", text: "意见" }, { op: "key", key: "Enter" }, { op: "key", key: "Enter" }]);
  const r = await result(shell);
  expect(r.saved).toBeNull();
  expect(r.clipboard!.formats).toContain("PNG");
  expect(r.clipboard!.text!.split("\r\n").at(-1)).toBe("截图（400×300）");
  expect(r.shown).toEqual([
    {
      kind: "error",
      title: "已复制截图和整体意见，但截图文件未能保存",
      detail: "批注未附在图片中（「在图片中附加批注」已关闭），Codex、Claude Code 粘贴时仅接收图片，批注可能丢失。可在「设置\u00a0→ 截图批注\u00a0→ 截图保存位置」中更改文件夹。", // the spaces before the arrows are non-breaking spaces (written in the message, so that "→" doesn't wrap to the start of the next line)
      path: null,
      error: expect.any(String),
    },
  ]);
});

// .NET itself retries putting data on the clipboard 10 times, waiting 100 ms each (ClipboardCore in dotnet/winforms, shared by WPF),
// so the outside only tries once more. The outside used to wrap another 11 attempts, and with the clipboard held for good
// the UI froze for ten-odd seconds before saying the copy had failed
test("Clipboard held by another program: one more try that succeeds counts as success; if it is still held the toast says so and tells the user where the image is saved; the outside doesn't retry a dozen times", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell, { clipboardFailures: 1 });
  await select(shell);
  await run(shell, [{ op: "key", key: "Enter" }]);
  let r = await result(shell);
  expect(r.clipboardAttempts).toBe(2);
  expect(r.shown[0].kind).toBe("toast");
  shell.allowLogErrors(); // the log line for a failed clipboard write is an ERROR
  await open(shell, { clipboardFailures: 100 });
  await select(shell);
  await run(shell, [{ op: "key", key: "Enter" }]);
  r = await result(shell);
  expect(r.clipboardAttempts).toBe(2);
  expect(r.clipboard).toBeNull();
  expect(r.shown).toEqual([
    {
      kind: "error",
      title: "无法将截图放入剪贴板",
      detail: "剪贴板可能正被其他程序（如远程桌面、剪贴板工具）占用。截图已保存，单击下方路径可在文件夹中显示：",
      path: r.saved,
      error: "Test hook: clipboard is busy",
    },
  ]);
  expect(existsSync(r.saved!)).toBe(true);
});

// The toast and the clipboard write used to share one try: an error in the toast window reported "copy failed" though the image had already been placed
test("The finish toast window can't be created: only logged, the image on the clipboard is still placed, and no \"copy failed\" is reported", async ({
  shell,
}) => {
  await shell.launch();
  shell.allowLogErrors(); // the log line for a toast that can't be shown is an ERROR
  await open(shell, { toastFails: true });
  await select(shell);
  await run(shell, [{ op: "key", key: "Enter" }]);
  await closed(shell);
  const r = await result(shell);
  expect(r.clipboard?.png?.signature).toBe(true);
  expect(r.shown.map((s) => `${s.kind}:${s.title}`)).toEqual(["toast:截图\n已添加到剪贴板"]);
  expect(r.windows).toEqual([]);
  await waitFor("the log line", () => shell.log().some((l) => l.includes("Screen Capture: the notice could not be shown (截图 已添加到剪贴板: ")));
  expect(shell.log().some((l) => l.includes("Test hook: toast window failed"))).toBe(true);
});

test("Captures older than 30 days in the default folder are cleaned up (the older Chinese file names are recognized too); other files and a folder the user chose are not cleaned", async ({
  shell,
}) => {
  await shell.launch();
  const dir = join(shell.temp, "captures");
  mkdirSync(dir, { recursive: true });
  const old = join(dir, "capture-2020-01-01_00-00-00.png");
  const oldName = join(dir, "截图批注 2020-01-01 00-00-00.png");
  const recent = join(dir, "capture-2099-01-01_00-00-00.png");
  const other = join(dir, "别的.png");
  for (const f of [old, oldName, recent, other]) writeFileSync(f, "x");
  const ago = (days: number) => new Date(Date.now() - days * 86_400_000);
  utimesSync(old, ago(31), ago(31));
  utimesSync(oldName, ago(31), ago(31));
  utimesSync(recent, ago(29), ago(29));
  utimesSync(other, ago(400), ago(400));
  // A folder the user chose: old screenshots in it are not cleaned
  const mine = join(shell.temp, "mine");
  mkdirSync(mine);
  const mineOld = join(mine, "capture-2020-01-01_00-00-00.png");
  writeFileSync(mineOld, "x");
  utimesSync(mineOld, ago(100), ago(100));
  await shell.ask("setCaptureSettings", { folder: mine });
  await open(shell);
  await select(shell);
  await run(shell, [{ op: "key", key: "Enter" }]);
  expect(existsSync(mineOld)).toBe(true);
  await shell.ask("setCaptureSettings", { folder: "" });
  await open(shell);
  await select(shell);
  await run(shell, [{ op: "key", key: "Enter" }]);
  expect(readdirSync(dir).includes(basename(old))).toBe(false);
  expect(readdirSync(dir).includes(basename(oldName))).toBe(false);
  expect(existsSync(recent)).toBe(true);
  expect(existsSync(other)).toBe(true);
});

// ---------- 10. Regression cases ----------

test("Clicking Overall comment with the note box open saves the note being written first (no text lost, no number left for a note without text); clicking it again closes it", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell);
  await select(shell);
  let o = await run(shell, [{ op: "key", key: "R" }, { op: "drag", from: [250, 250], to: [350, 350] }, { op: "type", text: "没保存的字" }, { op: "click", id: "overall" }]);
  expect(o.marks[0]).toMatchObject({ note: "没保存的字", number: 1, pending: 0 });
  expect(o.note).toMatchObject({ overall: true, title: "整体意见（不指定位置）" });
  // A newly drawn box with nothing written, then Overall comment: the box stays and the preview number is taken back
  o = await run(shell, [{ op: "key", key: "Escape" }, { op: "drag", from: [400, 250], to: [500, 350] }, { op: "click", id: "overall" }]);
  expect(o.marks[1]).toMatchObject({ note: "", number: 0, pending: 0, badge: null });
  // Click again while the overall comment is open: done writing, closes
  o = await run(shell, [{ op: "type", text: "整体" }, { op: "click", id: "overall" }]);
  expect([o.note, o.overall]).toEqual([null, "整体"]);
});

test("Clicking Undo while the text box is open: it undoes the text being written and leaves earlier drawings alone; clicking Overall comment: the text is finished first, then the overall comment opens", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell);
  await select(shell);
  let o = await run(shell, [
    { op: "key", key: "R" },
    { op: "drag", from: [250, 250], to: [350, 350] },
    { op: "key", key: "Escape" },
    { op: "key", key: "T" },
    { op: "down", x: 400, y: 400 },
    { op: "up" },
    { op: "type", text: "不要了" },
    { op: "click", id: "undo" },
  ]);
  expect(o.text).toBeNull();
  expect(o.marks.map((m) => m.kind)).toEqual(["rect"]);
  o = await run(shell, [{ op: "down", x: 400, y: 400 }, { op: "up" }, { op: "type", text: "留着" }, { op: "click", id: "overall" }]);
  expect(o.text).toBeNull();
  expect(o.marks.map((m) => m.text)).toEqual(["", "留着"]);
  expect(o.note!.overall).toBe(true);
});

test("Ctrl+Shift+Z is not undo (the overlay has no redo; it used to undo one more mark that couldn't be brought back)", async ({ shell }) => {
  await shell.launch();
  await open(shell);
  await select(shell);
  const o = await run(shell, [
    { op: "key", key: "R" },
    { op: "drag", from: [250, 250], to: [300, 300] },
    { op: "key", key: "Escape" },
    { op: "drag", from: [350, 250], to: [400, 300] },
    { op: "key", key: "Escape" },
    { op: "key", key: "Z", ctrl: true, shift: true },
  ]);
  expect(o.results.at(-1)).toEqual({ handled: false, by: "none" });
  expect(o.marks.length).toBe(2);
});

test("Multiple monitors: with an empty overall-comment box or text box open on one monitor, selecting on another monitor closes both boxes instead of leaving them on the dark monitor", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell, { monitors: TWO });
  await select(shell);
  await run(shell, [{ op: "key", key: "N" }]);
  let b = await run(shell, [{ op: "drag", from: [100, 100], to: [500, 400] }], 1);
  expect(b.owner).toBe(true);
  expect(b.all[0].note).toBeNull();
  await select(shell);
  await run(shell, [{ op: "key", key: "T" }, { op: "down", x: 300, y: 300 }, { op: "up" }]);
  b = await run(shell, [{ op: "drag", from: [100, 100], to: [500, 400] }], 1);
  expect(b.all[0].text).toBeNull();
  // Back on the first monitor a click re-selects, rather than being swallowed by that box first
  const a = await run(shell, [{ op: "drag", from: [200, 200], to: [600, 500] }]);
  expect(a.sel).toEqual({ x: 200, y: 200, width: 400, height: 300 });
});

test("Unfinished text in the text box counts as drawing: the selection locks, another monitor can't take over and Alt+F4 warns first; whitespace only doesn't count", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell, { monitors: TWO });
  await select(shell);
  let o = await run(shell, [{ op: "key", key: "T" }, { op: "down", x: 300, y: 300 }, { op: "up" }, { op: "type", text: "还没写好" }]);
  expect(o.locked).toBe(true);
  let b = await run(shell, [{ op: "drag", from: [100, 100], to: [500, 400] }], 1);
  expect(b.sel).toBeNull();
  expect(b.all[0].text).toMatchObject({ text: "还没写好" });
  // With the text box open Esc belongs to the input box (finish writing), while Alt+F4 reaches the overlay first: with unfinished text, it warns first
  o = await run(shell, [{ op: "key", key: "F4", alt: true }]);
  expect(o.open).toBe(true);
  expect(o.warn).not.toBeNull();
  o = await run(shell, [{ op: "type", replace: true, text: "  " }]);
  expect(o.locked).toBe(false);
  b = await run(shell, [{ op: "drag", from: [100, 100], to: [500, 400] }], 1);
  expect(b.owner).toBe(true);
  expect(b.all[0].text).toBeNull();
  expect(b.all[0].marks).toEqual([]);
});

test("When a small selection is enlarged for compositing, pixelate stays blocky (nearest neighbor), not smeared into a gradient", async ({ shell }) => {
  await shell.launch();
  await open(shell);
  // A 100 × 60 selection plus a note: enlarged 4 times, the image is 420 wide and the screenshot is centered (10 empty on the left)
  await select(shell, [200, 200], [300, 260]);
  await run(shell, [
    { op: "key", key: "M" },
    { op: "drag", from: [210, 230], to: [290, 230] },
    { op: "key", key: "C" },
    { op: "down", x: 290, y: 210 },
    { op: "up" },
    { op: "type", text: "打码" },
    { op: "key", key: "Enter" },
    { op: "key", key: "Enter" },
  ]);
  // Physical pixels 203 and 204 belong to two blocks (192–203, 204–215); row 230 is in the 228–239 block; after enlarging they are x 25 / 26 on the image
  const r = await result(shell, [
    [25, 120],
    [26, 120],
  ]);
  expect(r.image!.width).toBe(420);
  expect(r.pixels).toEqual([hex(0, 233, 197), hex(0, 233, 209)]);
});

test("Cleaning old captures: one that can't be deleted (read-only) doesn't stop the later ones from being cleaned", async ({ shell }) => {
  await shell.launch();
  const dir = join(shell.temp, "captures");
  mkdirSync(dir, { recursive: true });
  const stuck = join(dir, "capture-2020-01-01_00-00-00.png");
  const next = join(dir, "capture-2020-01-02_00-00-00.png");
  for (const f of [stuck, next]) {
    writeFileSync(f, "x");
    utimesSync(f, new Date(2020, 0, 1), new Date(2020, 0, 1));
  }
  chmodSync(stuck, 0o444);
  try {
    await open(shell);
    await select(shell);
    await run(shell, [{ op: "key", key: "Enter" }]);
    expect(existsSync(next)).toBe(false);
    expect(existsSync(stuck)).toBe(true);
  } finally {
    chmodSync(stuck, 0o666);
  }
});

test("A right-click during a left-button drag doesn't count (the selection used to be cleared and the finished box landed with no selection, so no toolbar appeared and Enter couldn't finish)", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell);
  let o = await run(shell, [{ op: "drag", from: [200, 200], to: [600, 500], hold: true }, { op: "right" }, { op: "up" }]);
  expect(o.sel).toEqual({ x: 200, y: 200, width: 400, height: 300 });
  o = await run(shell, [{ op: "key", key: "R" }, { op: "drag", from: [250, 250], to: [350, 350], hold: true }, { op: "right" }, { op: "up" }]);
  expect(o.sel).toEqual({ x: 200, y: 200, width: 400, height: 300 });
  expect(o.marks.map((m) => m.kind)).toEqual(["rect"]);
  expect(o.toolbar).not.toBeNull();
});

test("Mouse over the toolbar, sub-toolbar and note box: the cursor is an arrow, not the pen icon or four-way arrow from the canvas", async ({ shell }) => {
  await shell.launch();
  await open(shell);
  await select(shell);
  let o = await run(shell, [{ op: "key", key: "R" }, { op: "move", x: 400, y: 350 }]);
  expect(o.cursor).toBe("tool");
  const center = (b: Box) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  const at = async (p: { x: number; y: number }) => (await run(shell, [{ op: "cursorAt", ...p }])).results[0];
  expect(await at(center(o.toolbar!))).toBe("arrow");
  expect(await at({ x: o.subbar!.x + 4, y: o.subbar!.y + 4 })).toBe("arrow");
  o = await run(shell, [{ op: "drag", from: [250, 250], to: [350, 350] }, { op: "move", x: 300, y: 300 }]);
  expect(await at({ x: o.note!.box.x + 6, y: o.note!.box.y + 6 })).toBe("arrow");
  // On the canvas it is still decided by position
  expect(await at({ x: 450, y: 450 })).toBe("tool");
});

test("After a right-click re-select: with the mouse still, the window under it is highlighted at once (as when just opened)", async ({ shell }) => {
  await shell.launch();
  await open(shell, { windows: [{ x: OFF + 100, y: OFF + 100, width: 400, height: 300 }], cursor: [OFF + 150, OFF + 150] });
  expect((await layer(shell)).hover).toEqual({ x: 100, y: 100, width: 400, height: 300 });
  await select(shell, [600, 400], [900, 600]);
  const o = await run(shell, [{ op: "right", x: 700, y: 500 }]);
  expect(o.sel).toBeNull();
  expect(o.hover).toEqual({ x: 100, y: 100, width: 400, height: 300 });
});

test("Magnifier against the screen edge: the crosshair still marks the pixel under the cursor, and the part beyond the screen is left empty", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell);
  for (const [x, y] of [
    [2, 1],
    [1278, 718],
    [640, 360],
  ]) {
    const o = await run(shell, [{ op: "move", x, y }]);
    expect(o.magnifier!.center, `${x}, ${y}`).toBe(color(x, y));
  }
});

test("Finish and error toasts are excluded from a screen grab: capturing a second time in a row doesn't catch the previous toast; after an error toast has been clicked, Esc closes it", async ({
  shell,
}) => {
  await shell.launch();
  await open(shell);
  await select(shell);
  await run(shell, [{ op: "key", key: "Enter" }]);
  expect((await result(shell)).windows).toEqual([{ kind: "toast", excluded: true }]);
  shell.allowLogErrors(); // a failed save is an ERROR
  const blocker = join(shell.temp, "是个文件");
  writeFileSync(blocker, "x");
  await shell.ask("setCaptureSettings", { folder: join(blocker, "截图") });
  await open(shell);
  await select(shell);
  await run(shell, [{ op: "key", key: "Enter" }]);
  expect((await result(shell)).windows).toContainEqual({ kind: "error", excluded: true });
  expect(await shell.ask("debugCaptureErrorKey", { key: "Escape" })).toEqual({ open: false });
});

test("An unhandled error on the UI thread while the capture overlay is open: the error window still appears, Continue returns to the overlay, and the capture isn't torn down", async ({
  shell,
}) => {
  shell.allowLogErrors();
  await shell.launch();
  await open(shell);
  await select(shell);
  const crash = () => shell.nativeWindows().some((w) => w.buttons.includes("复制诊断信息"));
  await shell.callHost("debugThrow", { where: "ui" });
  await waitFor("the error window to appear", crash);
  shell.clickNative("继续使用");
  await waitFor("the error window to close", () => !crash());
  const o = await run(shell, [{ op: "key", key: "R" }, { op: "drag", from: [250, 250], to: [350, 350] }]);
  expect(o.open).toBe(true);
  expect(o.marks.map((m) => m.kind)).toEqual(["rect"]);
});
