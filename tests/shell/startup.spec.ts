// When the UI doesn't start: the window shows a native notice page (Restart, Exit, Open Log Folder) instead of a blank window,
// and no "you can keep using the app" error window pops up. Otherwise, with the UI files missing or the script not running,
// the user would only see an empty dark window

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, ROOT, test, waitFor, type Shell } from "./harness";

/** The notice page (native content swapped into the main window): title, body, buttons */
const problemPage = (shell: Shell) => shell.nativeWindows().find((w) => w.texts.includes("无法打开超级批注界面"));

/**
 * The background colour of each button on the notice page, by button name, read from a picture of the window (PrintWindow, so it works while the
 * window is covered): a point just inside the left edge of the button, clear of its label. The default (blue) button is the only one that is filled
 * with the accent colour
 */
function buttonColors(shell: Shell) {
  const page = problemPage(shell)!;
  const main = shell.windowInfo()!;
  const png = join(shell.temp, "notice-page.png");
  const shot = spawnSync("pwsh", ["-NoProfile", "-File", join(ROOT, "scripts", "capture-window.ps1"), "-Out", png, "-ProcessId", String(shell.proc!.pid)], {
    encoding: "utf8",
  });
  expect(shot.status, shot.stderr).toBe(0);
  // The picture is the window rectangle; scale in case it was taken at another DPI than the coordinates were read at
  const scale = readFileSync(png).readUInt32BE(16) / (main.rect.right - main.rect.left);
  // Only the page's own buttons: the system title bar (Minimize, Maximize, Close) is above the client area
  const own = page.buttons.flatMap((name, i) => {
    const rect = page.buttonRects[i];
    return rect && rect.top >= main.client.y ? [{ name, rect }] : [];
  });
  const points = own.map(({ rect: r }) => [Math.round((r.left + 6 - main.rect.left) * scale), Math.round(((r.top + r.bottom) / 2 - main.rect.top) * scale)]);
  const read = spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-Command",
      `Add-Type -AssemblyName System.Drawing; $bmp = [System.Drawing.Bitmap]::new('${png}'); ` +
        `@(${points.map(([x, y]) => `"$($bmp.GetPixel(${x}, ${y}).R),$($bmp.GetPixel(${x}, ${y}).G),$($bmp.GetPixel(${x}, ${y}).B)"`).join(",")}) | ConvertTo-Json -Compress; $bmp.Dispose()`,
    ],
    { encoding: "utf8" },
  );
  expect(read.status, read.stderr).toBe(0);
  const colors = ([] as string[]).concat(JSON.parse(read.stdout)).map((c) => c.split(",").map(Number) as [number, number, number]);
  return Object.fromEntries(own.map((b, i) => [b.name, colors[i]]));
}

test("Notice page after an initialization failure: Restart is the default (accent-filled) button; Open Log Folder, Copy Diagnostics and Exit are plain", async ({ shell }) => {
  shell.allowLogErrors();
  await shell.launch({ withoutUi: true });
  await waitFor("the notice page to appear", () => problemPage(shell));
  await new Promise((r) => setTimeout(r, 300)); // let painting finish
  const colors = buttonColors(shell);
  expect(Object.keys(colors).sort()).toEqual(["复制诊断信息", "打开日志文件夹", "退出", "重启"].sort());
  expect(colors["重启"]).toEqual([0x38, 0x6b, 0xe0]); // NativeUi.AccentFill
  for (const plain of ["打开日志文件夹", "复制诊断信息", "退出"]) expect(colors[plain], plain).toEqual([0x2c, 0x2c, 0x31]); // NativeUi.ButtonBg
});

test("Notice page when the UI's browser process is ended (no exception to copy): Restart is the default button, Exit and Open Log Folder are plain", async ({ shell }) => {
  shell.allowLogErrors();
  await shell.launch();
  const r = spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -like '*${shell.temp}*' -and $_.CommandLine -notlike '*--type=*' } | ForEach-Object ProcessId`,
    ],
    { encoding: "utf8" },
  );
  spawnSync("taskkill", ["/PID", String(Number(r.stdout.trim().split(/\s+/)[0])), "/T", "/F"], { stdio: "ignore" });
  await waitFor("the notice page to appear", () => problemPage(shell));
  await new Promise((done) => setTimeout(done, 300)); // let painting finish
  const colors = buttonColors(shell);
  expect(Object.keys(colors).sort()).toEqual(["打开日志文件夹", "退出", "重启"].sort());
  expect(colors["重启"]).toEqual([0x38, 0x6b, 0xe0]);
  for (const plain of ["打开日志文件夹", "退出"]) expect(colors[plain], plain).toEqual([0x2c, 0x2c, 0x31]);
});

test("UI files fail to load (404): the notice page replaces the UI, it is logged, no error window", async ({ shell }) => {
  shell.allowLogErrors();
  await shell.launch();
  await shell.page.evaluate(() => (location.href = "/no-such-page.html"));
  await waitFor("the log to record that the UI files failed to load", () => shell.log().some((l) => l.includes("The interface files couldn't be loaded")));
  expect(shell.alive()).toBe(true);
  // Only the main window (the notice page is shown inside it), no separate error window
  expect(shell.windows()).toHaveLength(1);
});

test("UI folder missing (incomplete install, antivirus quarantine): the notice page names the folder, no error window", async ({ shell }) => {
  shell.allowLogErrors();
  await shell.launch({ withoutUi: true });
  const page = await waitFor("the notice page to appear", () => problemPage(shell));
  // The details used to be only WebView2's "The system cannot find the path specified.", which doesn't say which path
  expect(page.texts.some((t) => /^DirectoryNotFoundException: UI folder not found: .*\\app\\ui$/.test(t))).toBe(true);
  expect(page.buttons).toEqual(expect.arrayContaining(["打开日志文件夹", "复制诊断信息", "退出", "重启"]));
  expect(shell.windows()).toHaveLength(1);
  expect(shell.log().some((l) => l.includes("[ERROR] UI initialization failed"))).toBe(true);
  // The system title bar is back (close, minimize, drag): the top of the client area sits one title bar below the top of the window.
  // It used to be flush with the window's top edge, so the notice page had no close button
  const info = shell.windowInfo()!;
  expect(info.client.y - info.rect.top).toBeGreaterThan(20);
});

test("WebView2 data folder can't be created (file in the way): notice page with the reason, no WebView2 error box", async ({ shell }) => {
  shell.allowLogErrors();
  writeFileSync(join(shell.temp, "WebView2"), "");
  await shell.launch({ connect: false });
  const page = await waitFor("the notice page to appear", () => problemPage(shell), 10_000);
  expect(page.texts.some((t) => t.startsWith("IOException: ") && t.includes("WebView2"))).toBe(true);
  expect(page.buttons).toEqual(expect.arrayContaining(["打开日志文件夹", "复制诊断信息", "退出", "重启"]));
  expect(shell.windows()).toHaveLength(1);
  expect(shell.log().some((l) => l.includes("[ERROR] UI initialization failed"))).toBe(true);
  // WebView2's browser process used to start anyway and show its own "We couldn't create the data directory"; now it isn't started at all
  const r = spawnSync(
    "pwsh",
    ["-NoProfile", "-Command", `@(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -like '*${shell.temp}*' }).Count`],
    { encoding: "utf8" },
  );
  expect(r.stdout.trim()).toBe("0");
});

test("Page loaded but never reports ready within 30 seconds (the UI script didn't run): the notice page replaces the UI", async ({ shell }) => {
  test.setTimeout(120_000);
  shell.allowLogErrors();
  await shell.launch();
  // A file that isn't the UI, at the app's own address: it loads fine but has no UI script, so no ready is sent
  const css = await shell.page.evaluate(() => document.querySelector<HTMLLinkElement>('link[rel="stylesheet"]')!.href);
  await shell.page.evaluate((u) => (location.href = u), css);
  await waitFor("the log to record that loading didn't finish in 30 seconds", () => shell.log().some((l) => l.includes("didn't finish loading within 30 seconds")), 60_000);
  expect(shell.alive()).toBe(true);
  expect(shell.windows()).toHaveLength(1);
});

test("UI process crashes 3 times in a minute: stops reloading, shows the notice page, and the log says so", async ({ shell }) => {
  test.setTimeout(90_000);
  shell.allowLogErrors();
  await shell.launch();
  for (let i = 1; i <= 3; i++) {
    const cdp = await shell.page.context().newCDPSession(shell.page);
    void cdp.send("Page.crash").catch(() => {}); // the process is gone, so this command gets no reply (on a reconnected session not even "detached" arrives; don't wait for it)
    await waitFor(`the log to record crash number ${i}`, () => shell.log().filter((l) => l.includes("RenderProcessExited")).length === i);
    if (i < 3) await shell.connect();
  }
  await waitFor("the log to say it stopped", () => shell.log().some((l) => l.includes("[ERROR] The interface crashed several times within a minute")));
  const page = await waitFor("the notice page to appear", () => problemPage(shell));
  expect(page.buttons).toEqual(expect.arrayContaining(["打开日志文件夹", "退出", "重启"]));
  expect(page.buttons).not.toContain("复制诊断信息"); // there is no exception to copy
  expect(shell.alive()).toBe(true);
  expect(shell.windows()).toHaveLength(1);
});

test("The UI's browser process is ended: the notice page replaces the UI, the log says so, the app stays running", async ({ shell }) => {
  shell.allowLogErrors();
  await shell.launch();
  // This test instance's browser process: its command line has its WebView2 data folder and no --type= (all child processes have one)
  const r = spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -like '*${shell.temp}*' -and $_.CommandLine -notlike '*--type=*' } | ForEach-Object ProcessId`,
    ],
    { encoding: "utf8" },
  );
  const pid = Number(r.stdout.trim().split(/\s+/)[0]);
  expect(pid).toBeGreaterThan(0);
  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  await waitFor("the log to say the browser process exited", () => shell.log().some((l) => l.includes("[ERROR] The interface's browser process quit unexpectedly")));
  const page = await waitFor("the notice page to appear", () => problemPage(shell));
  expect(page.buttons).toEqual(expect.arrayContaining(["退出", "重启"]));
  expect(shell.alive()).toBe(true);
});

test("The window is hidden in the tray when the UI's browser process dies: the notice page shows up and the window brings itself back", async ({ shell }) => {
  shell.allowLogErrors();
  await shell.launch();
  shell.windows(true); // WM_CLOSE: keep-in-tray is on, so the window hides and the process stays
  await waitFor("the window to hide", () => !shell.windowShown());
  expect(shell.alive()).toBe(true);
  const r = spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-Command",
      `Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -like '*${shell.temp}*' -and $_.CommandLine -notlike '*--type=*' } | ForEach-Object ProcessId`,
    ],
    { encoding: "utf8" },
  );
  const pid = Number(r.stdout.trim().split(/\s+/)[0]);
  expect(pid).toBeGreaterThan(0);
  spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  // Nobody is looking at a hidden window, so the notice page has to bring it out itself; otherwise the app would sit in the tray, broken and unseen
  const page = await waitFor("the notice page to appear", () => problemPage(shell));
  expect(page.buttons).toEqual(expect.arrayContaining(["退出", "重启"]));
  await waitFor("the window to show itself", () => shell.windowShown());
  await waitFor("the window to be uncloaked", () => shell.windowInfo()?.cloaked === false);
  expect(shell.windowInfo()).toMatchObject({ iconic: false, cloaked: false });
  expect(shell.alive()).toBe(true);
});