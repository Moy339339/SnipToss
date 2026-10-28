// Window position, size and state: remembering the position, falling back to the default layout when the saved one is out of reach,
// Reset Layout, saving once the window stops moving, and reopening from minimized back to the earlier state.
// The three window buttons and the title bar are in titlebar.spec.ts.
// None of it moves the real mouse or keyboard: windows are moved with SetWindowPos and closed with WM_CLOSE. Coordinates are written for
// 100% scaling (CI runs at 100%); multiple monitors with mixed scaling are checked by hand.
// Always on Top really covering other windows is checked by hand: when the test instance's window is in the background (another program is
// in front), the first Always on Top doesn't take effect, nor does calling SetWindowPos from outside, so it can't be tested reliably

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, waitFor, type Shell, type WindowInfo } from "./harness";

type Rect = WindowInfo["rect"];
const info = (shell: Shell) => shell.windowInfo();
const settings = (shell: Shell) => JSON.parse(readFileSync(join(shell.temp, "settings.json"), "utf8"));
function preset(shell: Shell, placement: object) {
  const s = settings(shell);
  s.Placement = placement;
  writeFileSync(join(shell.temp, "settings.json"), JSON.stringify(s, null, 2));
}
/** Waits for the window to settle (it is still being positioned just after launch): two reads 300 ms apart must match */
async function settled(shell: Shell) {
  let last = "";
  return waitFor("the window to settle", async () => {
    const now = info(shell);
    const same = now && JSON.stringify(now) === last;
    last = JSON.stringify(now);
    if (!same) await new Promise((r) => setTimeout(r, 300));
    return same && now;
  });
}
/**
 * The default layout (WindowPlacement.DefaultOn, at 100% scaling): 80% of the work area's width and 85% of its height,
 * at most 1920 × 1200, at least 960 × 600, centered
 */
function defaultRect(work: Rect): Rect {
  const w = work.right - work.left;
  const h = work.bottom - work.top;
  const width = Math.min(Math.max(Math.round(w * 0.8), 960), 1920);
  const height = Math.min(Math.max(Math.round(h * 0.85), 600), 1200);
  const left = Math.round(work.left + (w - width) / 2);
  const top = Math.round(work.top + (h - height) / 2);
  return { left, top, right: left + width, bottom: top + height };
}
/** Each edge within 1 pixel (rounding differs) */
function near(actual: Rect, expected: Rect) {
  for (const k of ["left", "top", "right", "bottom"] as const) expect(Math.abs(actual[k] - expected[k]), `${k}: ${actual[k]} ≠ ${expected[k]}`).toBeLessThanOrEqual(1);
}

test("First launch (no remembered position): centered in the work area of its screen, 80% wide and 85% high, at most 1920 × 1200", async ({ shell }) => {
  await shell.launch();
  const w = await settled(shell);
  near(w.rect, defaultRect(w.work));
});

test("The last position is out of reach (the title bar is on no screen, e.g. a second monitor was unplugged): uses the default layout", async ({ shell }) => {
  preset(shell, { Left: 100, Top: -300, Width: 1200, Height: 760, Maximized: false });
  await shell.launch();
  const w = await settled(shell);
  near(w.rect, defaultRect(w.work));
});

test("Remembered position and size: reopens where it was", async ({ shell }) => {
  preset(shell, { Left: 120, Top: 80, Width: 1200, Height: 760, Maximized: false });
  await shell.launch();
  const w = await settled(shell);
  near(w.rect, { left: 120, top: 80, right: 1320, bottom: 840 });
  expect(w.zoomed).toBe(false);
});

test("Remembered as maximized: reopens maximized, and restoring returns to the remembered position and size", async ({ shell }) => {
  preset(shell, { Left: 120, Top: 80, Width: 1200, Height: 760, Maximized: true });
  await shell.launch();
  await waitFor("the window to maximize", () => info(shell)?.zoomed);
  await expect(shell.page.locator(".win-btns .win-btn").nth(1)).toHaveAttribute("aria-label", "还原");
  await shell.ask("window", { action: "maximize" });
  await waitFor("the window to be restored", () => info(shell) && !info(shell)!.zoomed);
  near((await settled(shell)).rect, { left: 120, top: 80, right: 1320, bottom: 840 });
});

test("The remembered window is larger than the current screen (back to a laptop from a big external monitor, a lower resolution): shrinks to fit and doesn't extend off screen", async ({
  shell,
}) => {
  preset(shell, { Left: 100, Top: 100, Width: 6000, Height: 4000, Maximized: false });
  await shell.launch();
  const w = await settled(shell);
  expect(w.rect.left).toBeGreaterThanOrEqual(w.work.left);
  expect(w.rect.top).toBeGreaterThanOrEqual(w.work.top);
  expect(w.rect.right).toBeLessThanOrEqual(w.work.right);
  expect(w.rect.bottom).toBeLessThanOrEqual(w.work.bottom);
});

test("After moving or resizing and 2 seconds of stillness the position is saved: after the process is force-ended (Task Manager, a crash) it reopens where it was moved", async ({
  shell,
}) => {
  preset(shell, { Left: 120, Top: 80, Width: 1200, Height: 760, Maximized: false });
  await shell.launch();
  await settled(shell);
  shell.moveWindow(200, 150, 1100, 700);
  await waitFor(
    "the new position to be saved",
    () => {
      const p = settings(shell).Placement;
      return p.Left === 200 && p.Top === 150 && p.Width === 1100 && p.Height === 700;
    },
    6000,
  );
  await shell.kill();
  await shell.launch();
  near((await settled(shell)).rect, { left: 200, top: 150, right: 1300, bottom: 850 });
});

test("View → Reset Layout: from maximized, or moved to a corner and shrunk, returns to the default size, centered on its screen, and the position is saved", async ({
  shell,
}) => {
  preset(shell, { Left: 120, Top: 80, Width: 1200, Height: 760, Maximized: false });
  await shell.launch();
  await settled(shell);
  shell.moveWindow(40, 30, 980, 620);
  await shell.ask("window", { action: "maximize" });
  await waitFor("the window to maximize", () => info(shell)?.zoomed);
  expect(await shell.ask("window", { action: "resetLayout" })).toMatchObject({ maximized: false, fullscreen: false });
  const w = await settled(shell);
  expect(w.zoomed).toBe(false);
  near(w.rect, defaultRect(w.work));
  const p = settings(shell).Placement;
  near({ left: p.Left, top: p.Top, right: p.Left + p.Width, bottom: p.Top + p.Height }, w.rect);
  expect(p.Maximized).toBe(false);
});

test("Maximize then minimize, then open the app again from outside (the File Explorer context menu): the window returns maximized and the maximize button reads Restore", async ({
  shell,
}) => {
  await shell.launch();
  await shell.ask("window", { action: "maximize" });
  await waitFor("the window to maximize", () => info(shell)?.zoomed);
  await shell.ask("window", { action: "minimize" });
  await waitFor("the window to minimize", () => info(shell)?.iconic);
  expect(await shell.second([])).toBe(0);
  await waitFor("the window to appear", () => info(shell) && !info(shell)!.iconic);
  await new Promise((r) => setTimeout(r, 300));
  expect(info(shell)!.zoomed).toBe(true);
  await expect(shell.page.locator(".win-btns .win-btn").nth(1)).toHaveAttribute("aria-label", "还原");
});

test("Closing the window in full screen (hides to the tray): leaves full screen first, and what is saved is the position and size from before full screen", async ({
  shell,
}) => {
  preset(shell, { Left: 120, Top: 80, Width: 1200, Height: 760, Maximized: false });
  await shell.launch();
  await settled(shell);
  await shell.ask("window", { action: "fullscreen" });
  await waitFor("the window to cover the monitor", () => {
    const w = info(shell);
    return w && w.rect.right - w.rect.left === w.monitor.right - w.monitor.left;
  });
  shell.windows(true);
  await waitFor("the window to hide", () => !shell.windowShown());
  expect(settings(shell).Placement).toEqual({ Left: 120, Top: 80, Width: 1200, Height: 760, Maximized: false });
  expect(await shell.second([])).toBe(0);
  const w = await settled(shell);
  near(w.rect, { left: 120, top: 80, right: 1320, bottom: 840 });
  expect(await shell.ask("windowState")).toMatchObject({ fullscreen: false, maximized: false });
});
