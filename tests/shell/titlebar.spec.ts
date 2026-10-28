// What the title bar and the three window buttons do on a real window: really maximizing / minimizing / full screen, the UI area not being
// clipped by the top edge of the screen, which path × and WM_CLOSE (Alt+F4) take, and the window title on the taskbar.
// The UI-side parts (buttons, tooltips, drag area) are in tests/e2e/titlebar.spec.ts.
// None of it moves the real mouse or keyboard: buttons are clicked over CDP, restoring uses ShowWindow, closing sends WM_CLOSE

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, waitFor, type Shell } from "./harness";

const winBtn = (shell: Shell, i: number) => shell.page.locator(".win-btns .win-btn").nth(i);
const info = (shell: Shell) => shell.windowInfo();
const settings = (shell: Shell) => JSON.parse(readFileSync(join(shell.temp, "settings.json"), "utf8"));
/** Waits for the window to settle (it is still being positioned just after launch) and records how it looks: two reads 300 ms apart must match */
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

test("Maximize button: the window really maximizes with the UI starting at the top of the work area; minimize and restore from the taskbar keeps the Restore button; another click returns to the original size", async ({
  shell,
}) => {
  await shell.launch();
  const before = await settled(shell);
  const max = winBtn(shell, 1);
  await expect(max).toHaveAttribute("aria-label", "最大化");
  await max.click();
  const zoomed = await waitFor("the window to maximize", () => info(shell)?.zoomed && info(shell));
  expect(zoomed.client.y).toBe(zoomed.work.top);
  expect(zoomed.client.x).toBe(zoomed.work.left);
  await expect(max).toHaveAttribute("aria-label", "还原");
  await expect(shell.page.locator(".win-resize")).toHaveCount(0);
  // Minimize then restore: WebView2's size doesn't change and there is no resize event, so the button relies entirely on the state
  // returned by the minimize step (it used to return "not maximized", and after restoring the button stayed on "Maximize")
  await winBtn(shell, 0).click();
  await waitFor("the window to minimize", () => info(shell)?.iconic);
  shell.restoreWindow();
  await waitFor("the window to restore to maximized", () => info(shell)?.zoomed && !info(shell)?.iconic);
  await expect(max).toHaveAttribute("aria-label", "还原");
  await expect(shell.page.locator(".win-resize")).toHaveCount(0);
  await max.click();
  await waitFor("the window to return to normal size", () => info(shell) && !info(shell)!.zoomed);
  expect(info(shell)!.rect).toEqual(before.rect);
  await expect(max).toHaveAttribute("aria-label", "最大化");
  await expect(shell.page.locator(".win-resize")).toHaveCount(3);
});

test("Resizing from the top edge: an edge name the shell does not know is rejected with the reason; while maximized each of the three real edges returns at once and the window stays maximized", async ({
  shell,
}) => {
  await shell.launch();
  await settled(shell);
  // Only top, topleft and topright are real edges (the UI forwards just those); anything else is refused, whatever the window state.
  // The error is an expected one (bad argument): logged at INFO, the window is not touched
  for (const edge of ["left", "bottom", "bottomright", "TOP", ""]) {
    await expect(shell.ask("windowResize", { edge })).rejects.toThrow(`Invalid window edge: ${edge}`);
  }
  expect(info(shell)!.zoomed).toBe(false);

  // While maximized a valid edge does nothing: it must not enter the system's resize loop (that holds the shell's thread until the mouse is released).
  // A valid edge is never sent while the window is in its normal state, for the same reason
  await shell.callHost("window", { action: "maximize" });
  await waitFor("the window to maximize", () => info(shell)?.zoomed);
  const maximized = info(shell)!;
  for (const edge of ["top", "topleft", "topright"]) {
    const sent = Date.now();
    await shell.ask("windowResize", { edge });
    expect(Date.now() - sent).toBeLessThan(1000);
    expect(info(shell)).toMatchObject({ zoomed: true, iconic: false, rect: maximized.rect });
  }
  // The shell still answers and an invalid edge is still refused while maximized
  await expect(shell.ask("windowResize", { edge: "left" })).rejects.toThrow("Invalid window edge: left");
  await expect(winBtn(shell, 1)).toHaveAttribute("aria-label", "还原");
});

test("Opening maximized: minimize then restore from the taskbar keeps the Restore button; quitting while minimized reopens maximized", async ({ shell }) => {
  // Restored as maximized at startup, before "was it maximized before minimizing" starts being tracked (it was always treated as not maximized)
  const s = settings(shell);
  s.Placement = { Left: 120, Top: 80, Width: 1200, Height: 760, Maximized: true };
  writeFileSync(join(shell.temp, "settings.json"), JSON.stringify(s, null, 2));
  await shell.launch();
  await waitFor("the window to open maximized", () => info(shell)?.zoomed);
  const max = winBtn(shell, 1);
  await expect(max).toHaveAttribute("aria-label", "还原");
  await winBtn(shell, 0).click();
  await waitFor("the window to minimize", () => info(shell)?.iconic);
  shell.restoreWindow();
  await waitFor("the window to restore to maximized", () => info(shell)?.zoomed && !info(shell)?.iconic);
  await expect(max).toHaveAttribute("aria-label", "还原");
  await winBtn(shell, 0).click();
  await waitFor("the window to minimize", () => info(shell)?.iconic);
  await shell.callHost("window", { action: "quit" });
  await waitFor("the process to exit", () => !shell.alive());
  expect(settings(shell).Placement.Maximized).toBe(true);
});

test("F11 full screen: the window covers the whole monitor (taskbar included) with the title bar kept, the middle button is Exit Full Screen; F11 again returns to the original position and size", async ({
  shell,
}) => {
  await shell.launch();
  const before = await settled(shell);
  await shell.page.locator(".lib-list").focus();
  await shell.page.keyboard.press("F11");
  const full = await waitFor("the window to cover the monitor", () => {
    const i = info(shell);
    return (
      i &&
      i.rect.left <= i.monitor.left &&
      i.rect.top <= i.monitor.top &&
      i.rect.right >= i.monitor.right &&
      i.rect.bottom >= i.monitor.bottom &&
      i
    );
  });
  expect(full.client.y).toBe(full.monitor.top);
  await expect(shell.page.locator(".titlebar")).toBeVisible();
  await expect(winBtn(shell, 1)).toHaveAttribute("aria-label", "退出全屏");
  await expect(shell.page.locator(".win-resize")).toHaveCount(0);
  await shell.page.keyboard.press("F11");
  await expect(winBtn(shell, 1)).toHaveAttribute("aria-label", "最大化");
  await expect.poll(() => info(shell)?.rect).toEqual(before.rect);
});

test("Window title: with a file open it is \"file name - product name\", so the taskbar and Alt+Tab show which file is open; it follows the file", async ({
  shell,
}) => {
  await shell.launch();
  await shell.page.locator(".lib-row", { hasText: "hero.png" }).click();
  await expect(shell.page).toHaveTitle("hero.png");
  await expect.poll(() => info(shell)?.title).toBe("hero.png - 超级批注");
  await shell.page.locator(".lib-row", { hasText: "clip.mp4" }).click();
  await expect.poll(() => info(shell)?.title).toBe("clip.mp4 - 超级批注");
});

test("With \"keep in the tray when the window is closed\" off, clicking × exits the process and saves the window position first", async ({ shell }) => {
  await shell.launch();
  await shell.callHost("setCaptureSettings", { keepInTray: false });
  await waitFor("the settings to record not keeping in the tray", () => settings(shell).Capture?.KeepInTray === false);
  await winBtn(shell, 2)
    .click()
    .catch(() => {}); // the connection drops along with the window
  await waitFor("the process to exit", () => !shell.alive());
  // The settings file always has this item (Left is NaN when never saved): what to check is that a real number was saved
  const p = settings(shell).Placement;
  expect(typeof p.Left).toBe("number");
  expect(p.Width).toBeGreaterThanOrEqual(960);
});

test("WM_CLOSE (what Alt+F4 ends up sending): with keep-in-tray on, the window hides while the process stays and a playing video stops", async ({ shell }) => {
  await shell.launch();
  await shell.page.locator(".lib-row", { hasText: "clip.mp4" }).click();
  await expect.poll(() => shell.page.evaluate(() => document.querySelector("video")?.readyState ?? 0)).toBeGreaterThanOrEqual(2);
  await shell.page.evaluate(() => document.querySelector("video")!.play());
  await expect.poll(() => shell.page.evaluate(() => !document.querySelector("video")!.paused)).toBe(true);
  shell.windows(true);
  await expect.poll(() => shell.windowShown()).toBe(false);
  expect(shell.alive()).toBe(true);
  await expect.poll(() => shell.page.evaluate(() => document.querySelector("video")!.paused)).toBe(true);
});
