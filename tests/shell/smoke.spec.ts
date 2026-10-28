// Real-shell smoke tests (docs/adr/0004-testing-layers.md, layer 4): npm run e2e:shell.
// Only what needs the real shell to show: virtual host mapping, the Bridge really reading and writing the disk, file watching,
// single-instance handoff, the tray, reload after the UI process crashes.
// The UI's own behavior is tested in tests/e2e (mock host).

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { CLI, expect, ROOT, test, waitFor, type Shell } from "./harness";

const card = (shell: Shell, id: string) => shell.page.locator(`[data-annot$="|${id}"]`);

/** An agent writing back through the command line (the same one .sniptoss/sniptoss.cmd calls) */
function agent(shell: Shell, ...args: string[]) {
  const r = spawnSync(process.execPath, [CLI, ...args, "--root", shell.project], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`Command line failed: ${r.stderr || r.stdout}`);
}

/** Clicks an item in the "⋯" menu on the right of a card */
async function cardMenu(shell: Shell, id: string, item: string) {
  // "⋯" can only be clicked while hovered. When two test instances run in parallel and the other window pops up on top, the system sends
  // mouse messages to this window by the real cursor position and the hover is lost.
  // When Playwright retries it only checks what covers the click point and doesn't hover again, so it would wait until the timeout:
  // hover again on every retry
  await expect(async () => {
    await card(shell, id).hover();
    await card(shell, id).locator('.act[title^="更多"]').click({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  await shell.page.getByRole("menuitem", { name: item }).click();
}

/**
 * Moves the project folder (like renaming it in File Explorer). Right after the UI opens a file it reads the file in the background
 * for a moment (computing the fingerprint, reading the video's frame rate), and for those few dozen milliseconds the system won't let
 * the folder containing it be moved (File Explorer says "in use"; Retry works). What this catches is a handle held for good:
 * it fails only if the folder still can't be moved after 3 seconds
 */
async function renameWhenFree(from: string, to: string) {
  const end = Date.now() + 3000;
  for (;;) {
    try {
      return renameSync(from, to);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EPERM" || Date.now() > end) throw e;
      await new Promise((r) => setTimeout(r, 50));
    }
  }
}

/** An image outside the library (on the same drive as the project, so the page needn't reload) */
function outsideImage(shell: Shell) {
  const dir = join(shell.temp, "outside");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "one.png");
  copyFileSync(join(shell.project, "assets", "hero.png"), file);
  return file;
}

test("Startup: the UI loads, files are listed, an image really shows through the virtual host, the notes panel reads the notes on disk", async ({
  shell,
}) => {
  await shell.launch();
  const { page } = shell;
  await expect(page.locator(".lib-row", { hasText: "hero.png" })).toBeVisible();
  await expect(page.locator(".lib-row", { hasText: "clip.mp4" })).toBeVisible();
  await expect(page).toHaveTitle("hero.png");
  await expect
    .poll(() => page.evaluate(() => [...document.images].some((i) => i.src.includes("hero.png") && i.complete && i.naturalWidth > 0)))
    .toBe(true);
  await expect(card(shell, "k3f9a2")).toContainText("标题字太细了");
  expect(shell.log().some((l) => l.includes("[INFO] Starting"))).toBe(true);
});

test("Marking a note as done in the notes panel: the shell really writes the notes file and REVIEW.md", async ({ shell }) => {
  await shell.launch();
  await cardMenu(shell, "k3f9a2", "标记为已改");
  await expect.poll(() => shell.annotations("assets__hero.png.json").find((a) => a.id === "k3f9a2")?.status).toBe("resolved");
  const review = join(shell.project, ".sniptoss", "REVIEW.md");
  // REVIEW.md is written in the queue after the notes change (not awaited): wait for it to be written, then check the content
  const text = () => (existsSync(review) ? readFileSync(review, "utf8") : "");
  await expect.poll(text).toMatch(/^# 待处理批注（\d+ 条）/);
  await expect.poll(text).not.toContain("标题字太细了");
});

test("An agent writes back through the command line: the shell's file watcher notifies the UI and the UI syncs by itself", async ({ shell }) => {
  await shell.launch();
  agent(shell, "resolve", "k3f9a2", "-m", "改好了");
  await expect(card(shell, "k3f9a2")).toHaveClass(/status-resolved/);
  await expect(shell.page.locator(".toast")).toContainText("外部更新");
});

test("Write race: the UI changes the same file while an agent writes back, and both changes survive (ADR-0005)", async ({ shell }) => {
  await shell.launch();
  await card(shell, "done01").hover();
  await card(shell, "done01").locator('.act[title^="更多"]').click();
  const reopen = shell.page.getByRole("menuitem", { name: "重新打开" });
  await expect(reopen).toBeVisible();
  agent(shell, "resolve", "k3f9a2", "-m", "改好了");
  await reopen.click(); // before the UI receives the sync notification (300 ms debounce)
  await expect
    .poll(() =>
      shell
        .annotations("assets__hero.png.json")
        .map((a) => `${a.id}:${a.status}:${a.replies.length}`)
        .sort(),
    )
    .toEqual(["done01:open:1", "k3f9a2:resolved:1"]);
  await expect(card(shell, "k3f9a2")).toHaveClass(/status-resolved/);
  await expect(card(shell, "done01")).toHaveClass(/status-open/);
});

test("Video: really plays through the virtual host (the range requests that seeking needs are handled by WebView2)", async ({ shell }) => {
  await shell.launch();
  await shell.page.locator(".lib-row", { hasText: "clip.mp4" }).click();
  await expect(shell.page).toHaveTitle("clip.mp4");
  await shell.page.evaluate(() => document.querySelector("video")!.play());
  await expect.poll(() => shell.page.evaluate(() => document.querySelector("video")!.currentTime)).toBeGreaterThan(0.2);
  await shell.page.evaluate(() => {
    const v = document.querySelector("video")!;
    v.pause();
    v.currentTime = 1.5;
  });
  await expect.poll(() => shell.page.evaluate(() => document.querySelector("video")!.seeking)).toBe(false);
  expect(await shell.page.evaluate(() => document.querySelector("video")!.currentTime)).toBeCloseTo(1.5, 1);
});

test("Single instance: opening another file hands it to the open window, which adds it to the library and jumps to it; the second process exits by itself", async ({
  shell,
}) => {
  await shell.launch();
  const file = outsideImage(shell);
  expect(await shell.second([file])).toBe(0);
  await expect(shell.page.locator(".lib-row", { hasText: "one.png" })).toBeVisible();
  await expect(shell.page).toHaveTitle("one.png");
  expect(shell.alive()).toBe(true);
});

test("Several processes started at once (multi-select in File Explorer, right-click, open): one window, all files added to the library", async ({
  shell,
}) => {
  const dir = join(shell.temp, "outside");
  mkdirSync(dir, { recursive: true });
  const files = ["a.png", "b.png", "c.png"].map((n) => {
    copyFileSync(join(shell.project, "assets", "hero.png"), join(dir, n));
    return join(dir, n);
  });
  const first = shell.launch({ args: [files[0]] });
  await new Promise((r) => setTimeout(r, 150)); // the first one takes the single-instance lock; the others arrive before its window is built
  const codes = await Promise.all(files.slice(1).map((f) => shell.second([f])));
  await first;
  expect(codes).toEqual([0, 0]);
  for (const n of ["a.png", "b.png", "c.png"]) await expect(shell.page.locator(".lib-row", { hasText: n })).toBeVisible();
  expect(shell.alive()).toBe(true);
});

/**
 * Rounds of `count` processes (each given one new image) started in the same instant, none with a head start: whichever takes the single-instance lock
 * stays, the rest forward their path and exit 0. Between rounds the winner is ended and the library reset, so each round checks only its own files.
 * Cold starts are what make the handoff race show (a loser reaching the pipe before the winner listens, or before its window exists), hence several rounds
 */
async function startTogether(shell: Shell, count: number, rounds: number) {
  for (let round = 1; round <= rounds; round++) {
    if (shell.proc) {
      await shell.kill();
      shell.setLibrary([shell.project]);
    }
    const dir = join(shell.temp, `together-${count}-${round}`);
    mkdirSync(dir, { recursive: true });
    const files = Array.from({ length: count }, (_, i) => {
      const file = join(dir, `r${round}-p${String(i + 1).padStart(2, "0")}.png`);
      copyFileSync(join(shell.project, "assets", "hero.png"), file);
      return file;
    });
    const codes = await shell.launchMany(files.map((f) => [f]));
    // Exactly one process stays (launchMany waited for that), the others forwarded and exited cleanly
    expect(codes, `round ${round}`).toEqual(Array(count - 1).fill(0));
    expect(shell.alive()).toBe(true);
    expect(shell.windows(), `round ${round}`).toHaveLength(1); // one window, not one per process
    for (const file of files) {
      await expect(shell.page.locator(".lib-row", { hasText: basename(file) }), `round ${round}: ${basename(file)}`).toBeVisible();
    }
    expect(shell.log().filter((l) => l.includes("Could not reach the window that is already open"))).toEqual([]);
  }
}

test("Five processes started at the same moment, no head start for the first (five rounds): exactly one stays, one window, every file is in the library, the others exit 0", async ({
  shell,
}) => {
  test.setTimeout(150_000);
  await startTogether(shell, 5, 5);
});

test("Twenty processes started at the same moment, no head start for the first (three rounds): exactly one stays, one window, every file is in the library, the others exit 0", async ({
  shell,
}) => {
  test.setTimeout(150_000);
  await startTogether(shell, 20, 3);
});

test("The single-instance pipe is accessible only to the current user: its access list has no broad group and no other user, and has an allow entry for the current user", async ({
  shell,
}) => {
  await shell.launch();
  // The pipe is named after the product and a hash of the settings file path (Program.cs SingleInstance.IdFor)
  const id = createHash("sha256").update(join(shell.temp, "settings.json").toLowerCase(), "utf8").digest("hex").slice(0, 16).toUpperCase();
  const pipe = `SnipToss-${id}`;
  // Open the pipe asking for READ_CONTROL (plus WriteData, the only data right the server's inbound pipe grants: it is how the single-instance
  // client connects too) and read its DACL. This opens a connection and drops it without a word: the server treats that as "bring the window forward"
  const script = `
    $rights = [System.IO.Pipes.PipeAccessRights]::WriteData -bor [System.IO.Pipes.PipeAccessRights]::ReadPermissions
    $c = [System.IO.Pipes.NamedPipeClientStream]::new('.', '${pipe}', $rights, [System.IO.Pipes.PipeOptions]::None, [System.Security.Principal.TokenImpersonationLevel]::None, [System.IO.HandleInheritability]::None)
    $c.Connect(5000)
    $acl = [System.IO.Pipes.PipesAclExtensions]::GetAccessControl($c)
    @{ sddl = $acl.GetSecurityDescriptorSddlForm('Access'); user = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value } | ConvertTo-Json -Compress
  `;
  const r = spawnSync("pwsh", ["-NoProfile", "-Command", script], { encoding: "utf8" });
  expect(r.status, r.stderr).toBe(0);
  const { sddl, user } = JSON.parse(r.stdout) as { sddl: string; user: string };

  // "D:" followed by the entries (A;flags;rights;;;SID): a pipe with no DACL at all would be open to everyone
  expect(sddl).toMatch(/^D:/);
  const entries = [...sddl.matchAll(/\(([^)]*)\)/g)].map((m) => {
    const [type, , rights, , , sid] = m[1].split(";");
    return { type, rights, sid };
  });
  expect(entries.length).toBeGreaterThan(0);
  // Everyone, authenticated users, local users, interactive users, network, anonymous: none of them may appear, by SDDL alias or by SID
  const broad = ["WD", "AU", "BU", "IU", "NU", "AN", "S-1-1-0", "S-1-5-11", "S-1-5-32-545", "S-1-5-4", "S-1-5-2", "S-1-5-7"];
  expect(entries.filter((e) => broad.includes(e.sid))).toEqual([]);
  // The current user is allowed in; nobody but the current user, the system and administrators is named at all (newer .NET versions may add the last two)
  expect(entries.some((e) => e.type === "A" && e.sid === user)).toBe(true);
  expect(entries.filter((e) => ![user, "SY", "S-1-5-18", "BA", "S-1-5-32-544"].includes(e.sid))).toEqual([]);
});

test("Uninstalling while the app is running: the pre-uninstall cleanup (--uninstall-cleanup) first asks the open window to quit and waits for it", async ({
  shell,
}) => {
  // Test instances leave the registry alone, so the second half of the cleanup is refused as usual, logs an ERROR and exits 1 (setup.spec.ts);
  // asking the window to quit comes before that and still happens. Without it the app would keep running and the install folder couldn't be fully deleted
  shell.allowLogErrors();
  await shell.launch();
  const started = Date.now();
  expect(await shell.second(["--uninstall-cleanup"])).toBe(1);
  // The cleanup command returns only after the window has quit (the process-exit message arrives asynchronously on this side, so wait a moment)
  await expect.poll(() => shell.alive(), { timeout: 3000 }).toBe(false);
  expect(Date.now() - started).toBeLessThan(15_000);
  expect(shell.log().some((l) => l.includes("The uninstaller asked this window to quit"))).toBe(true);
  expect(shell.log().some((l) => l.includes("didn't quit in time"))).toBe(false);
});

test("A file passed on the command line can't be found: the UI says so once loaded (it used to be dropped silently)", async ({ shell }) => {
  await shell.launch({ args: [join(shell.temp, "没有这个.png")] });
  await expect(shell.page.locator(".toast")).toContainText("找不到");
});

// This checks whether the system shows the window: the page's visibilityState stays "visible" after the window is hidden
test("Closing the window hides it in the tray: the process keeps running; starting the app again brings the window back", async ({ shell }) => {
  await shell.launch();
  await expect.poll(() => shell.windowShown()).toBe(true);
  await shell.page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect.poll(() => shell.windowShown()).toBe(false);
  expect(shell.alive()).toBe(true);
  expect(await shell.second([])).toBe(0);
  await expect.poll(() => shell.windowShown()).toBe(true);
});

test("Opening a file from outside after an autostart (--tray): the window appears and, once the UI has loaded, jumps to the file", async ({
  shell,
}) => {
  await shell.launch({ tray: true });
  await waitFor("the startup line in the log", () => shell.log().some((l) => l.includes("[INFO] Starting") && l.includes(" · tray")));
  const file = outsideImage(shell);
  expect(await shell.second([file])).toBe(0);
  await shell.connect();
  await expect(shell.page).toHaveTitle("one.png");
  await expect(shell.page.locator(".lib-row", { hasText: "one.png" })).toBeVisible();
});

test("UI process crashed: the shell reloads it automatically and the library and the selected file come back", async ({ shell }) => {
  shell.allowLogErrors(); // the crash itself logs an [ERROR]
  await shell.launch();
  await shell.page.locator(".lib-row", { hasText: "clip.mp4" }).click();
  await expect(shell.page).toHaveTitle("clip.mp4");
  const cdp = await shell.page.context().newCDPSession(shell.page);
  await cdp.send("Page.crash").catch(() => {}); // the process is gone, so this command gets no reply
  await waitFor("the log to record the UI process exit", () => shell.log().some((l) => l.includes("RenderProcessExited")));
  await shell.connect();
  await expect(shell.page).toHaveTitle("clip.mp4");
  expect(shell.log().filter((l) => l.includes("[ERROR]") && !l.includes("RenderProcessExited"))).toEqual([]);
});

/**
 * Waits until all capture overlays are up: before capturing, the main window is hidden (on by default), then there is one overlay
 * per monitor. The overlays of several screens come up one after another, so they count as complete only when three counts in a row
 * (about 0.3 seconds) agree (counting as soon as the first overlay appeared gave different counts on two runs and failed now and then)
 */
function overlaysSettled(shell: Shell, what: string) {
  let last = -1;
  let same = 0;
  return waitFor(what, () => {
    const now = shell.windows();
    if (now.length === 0 || shell.windowShown()) return null;
    same = now.length === last ? same + 1 : 0;
    last = now.length;
    return same >= 2 ? now : null;
  });
}

// The capture overlay covers the whole screen for a second or two; only cancel, never finish, so the clipboard is untouched.
// Closing the window sends WM_CLOSE (what the system and other programs do when they close a window), without touching the keyboard
test("Capture overlay closed from outside (WM_CLOSE; Alt+F4 on the keyboard cancels, see capture.spec.ts): the session ends, the main window returns, and Screen Capture works again", async ({
  shell,
}) => {
  await shell.launch();
  const main = shell.windows();
  expect(main.length).toBe(1);
  await shell.callHost("captureStart");
  const settled = (what: string) => overlaysSettled(shell, what);
  const overlays = await settled("the capture overlays to appear");
  shell.windows(true);
  await waitFor("the main window to come back", () => shell.windowShown());
  // Start again: if the session hadn't been cleaned up, this would only try to "activate" the overlay window that is already closed,
  // and the capture overlay would never come up
  await shell.callHost("captureStart");
  const again = await settled("the capture overlays to appear again");
  expect(again.length).toBe(overlays.length);
  shell.windows(true);
  await waitFor("the main window to come back", () => shell.windowShown());
  expect(shell.log().some((l) => l.includes("an overlay was closed from outside"))).toBe(true);
});

test("Clicking Capture in the window: the main window hides first and a playing video stops with it instead of sounding in the background (same as hiding to the tray)", async ({
  shell,
}) => {
  await shell.launch();
  await shell.page.locator(".lib-row", { hasText: "clip.mp4" }).click();
  await expect(shell.page).toHaveTitle("clip.mp4");
  await expect.poll(() => shell.page.evaluate(() => document.querySelector("video")?.readyState ?? 0)).toBeGreaterThanOrEqual(2);
  await shell.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await shell.page.keyboard.press("Control+l"); // loop: so it doesn't play to the end and stop by itself before the overlay appears
  await shell.page.keyboard.press("Space");
  await expect.poll(() => shell.page.evaluate(() => !document.querySelector("video")!.paused)).toBe(true);
  await shell.callHost("captureStart");
  await overlaysSettled(shell, "the capture overlays to appear");
  await expect.poll(() => shell.page.evaluate(() => document.querySelector("video")!.paused)).toBe(true);
  shell.windows(true);
  await waitFor("the main window to come back", () => shell.windowShown());
});

// A 1×1 PNG: its size differs from the test file hero.png (640×360), so the width shows whether it was swapped
const ONE_PIXEL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

test("An agent changes a file: the UI swaps to the new one by itself (no F5, and no stale image from the cache)", async ({ shell }) => {
  await shell.launch();
  const width = () =>
    shell.page.evaluate(() => [...document.images].find((i) => i.src.includes("hero.png") && i.complete)?.naturalWidth ?? -1);
  await expect.poll(width).toBe(640);
  writeFileSync(join(shell.project, "assets", "hero.png"), ONE_PIXEL_PNG); // the agent overwrites it in place
  await expect.poll(width, { timeout: 10_000 }).toBe(1);
  await expect(card(shell, "k3f9a2")).toBeVisible(); // the notes are still there
});

test("While the app is open, the user can rename or move a project folder that has notes (File Explorer must not say \"in use\")", async ({
  shell,
}) => {
  await shell.launch();
  await expect(card(shell, "k3f9a2")).toBeVisible();
  await shell.page.locator(".lib-row", { hasText: "clip.mp4" }).click(); // the video has been opened too
  await renameWhenFree(join(shell.project, ".sniptoss"), join(shell.project, ".sniptoss-x"));
  await renameWhenFree(join(shell.project, ".sniptoss-x"), join(shell.project, ".sniptoss"));
  await renameWhenFree(shell.project, `${shell.project}-moved`);
  await renameWhenFree(`${shell.project}-moved`, shell.project);
});

test("Project folder briefly missing (drive disconnected, or moved away and back): not treated as the notes being deleted; once back, notes work as before and watching resumes", async ({
  shell,
}) => {
  await shell.launch();
  await expect(card(shell, "k3f9a2")).toBeVisible();
  // Toasts disappear after a few seconds: record everything that showed in the meantime
  await shell.page.evaluate(() => {
    const seen: string[] = ((window as unknown as { __toasts: string[] }).__toasts = []);
    new MutationObserver(() => document.querySelectorAll(".toast").forEach((t) => seen.push(t.textContent ?? ""))).observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  });
  const away = `${shell.project}-away`;
  await renameWhenFree(shell.project, away);
  await new Promise((r) => setTimeout(r, 2500)); // the notes folder is checked once a second
  await renameWhenFree(away, shell.project);
  await expect(card(shell, "k3f9a2")).toBeVisible({ timeout: 15_000 }); // found again by the library's full background scan (at least every 10 seconds)
  await new Promise((r) => setTimeout(r, 2500));
  const toasts = await shell.page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts);
  expect(toasts.filter((t) => t.includes("外部更新"))).toEqual([]);
  agent(shell, "resolve", "k3f9a2", "-m", "改好了"); // watching resumes once it is back
  await expect(card(shell, "k3f9a2")).toHaveClass(/status-resolved/);
});
test("An agent writes back notes while the window is hidden in the tray: when it is brought back the UI is already up to date, no F5", async ({
  shell,
}) => {
  await shell.launch();
  await expect(card(shell, "k3f9a2")).toBeVisible();
  shell.windows(true);
  await waitFor("the window to hide", () => !shell.windowShown());
  agent(shell, "resolve", "k3f9a2", "-m", "改好了");
  await new Promise((r) => setTimeout(r, 1500));
  expect(await shell.second([])).toBe(0);
  await expect(card(shell, "k3f9a2")).toHaveClass(/status-resolved/);
});

test("An agent writes notes into a project for the first time (no notes folder yet): the UI syncs too", async ({ shell }) => {
  rmSync(join(shell.project, ".sniptoss"), { recursive: true });
  await shell.launch();
  await expect(card(shell, "k3f9a2")).toHaveCount(0);
  cpSync(join(ROOT, "tests", "e2e", "fixtures", "project", ".sniptoss"), join(shell.project, ".sniptoss"), { recursive: true });
  await expect(card(shell, "k3f9a2")).toBeVisible();
});

test("Maximize → minimize → quit: the next launch is maximized again (it used to be saved as not maximized)", async ({ shell }) => {
  await shell.launch();
  await shell.callHost("window", { action: "maximize" });
  await shell.callHost("window", { action: "minimize" });
  await new Promise((r) => setTimeout(r, 500));
  await shell.callHost("window", { action: "quit" });
  await waitFor("the process to exit", () => !shell.alive());
  const placement = JSON.parse(readFileSync(join(shell.temp, "settings.json"), "utf8")).Placement;
  expect(placement.Maximized).toBe(true);
});

type WinState = { maximized: boolean; fullscreen: boolean; topmost: boolean };

test("Window menu items and Reset Layout: the shell returns the right state, Always on Top is saved to settings and still on at the next launch", async ({
  shell,
}) => {
  await shell.launch();
  const act = (action: string) => shell.ask<WinState>("window", { action });
  expect(await act("maximize")).toMatchObject({ maximized: true, fullscreen: false });
  // In full screen the window doesn't count as maximized, and "maximize" does nothing; leaving full screen returns to the maximized state from before
  expect(await act("fullscreen")).toMatchObject({ maximized: false, fullscreen: true });
  expect(await act("maximize")).toMatchObject({ maximized: false, fullscreen: true });
  expect(await act("fullscreen")).toMatchObject({ maximized: true, fullscreen: false });
  // Reset layout: first leave full screen, back to the normal state
  await act("fullscreen");
  expect(await act("resetLayout")).toMatchObject({ maximized: false, fullscreen: false });
  const [, size] = shell.windows()[0].split(" ");
  const [w, h] = size.split("x").map(Number);
  expect(w).toBeGreaterThanOrEqual(960);
  expect(h).toBeGreaterThanOrEqual(600);
  expect(await act("topmost")).toMatchObject({ topmost: true });
  await expect(shell.ask("window", { action: "nope" })).rejects.toThrow("Unsupported window action");
  await act("quit");
  await waitFor("the process to exit", () => !shell.alive());
  const saved = JSON.parse(readFileSync(join(shell.temp, "settings.json"), "utf8"));
  expect(saved.Topmost).toBe(true);
  expect(saved.Placement.Maximized).toBe(false);
  await shell.launch();
  expect(await shell.ask<WinState>("windowState")).toMatchObject({ topmost: true });
});

test("File → Exit while the capture overlay is open: the capture session ends and the process exits cleanly", async ({ shell }) => {
  await shell.launch();
  await shell.callHost("captureStart");
  await overlaysSettled(shell, "the capture overlays to appear");
  await shell.callHost("window", { action: "quit" });
  await waitFor("the process to exit", () => !shell.alive());
  expect(shell.log().filter((l) => l.includes("[ERROR]"))).toEqual([]);
});

test("Test instances leave the registry alone: turning on the context menu is refused and the reason is logged", async ({ shell }) => {
  await shell.launch();
  await shell.callHost("setShellIntegration", { enable: true });
  await waitFor("the log to explain why", () => shell.log().some((l) => l.includes("Test instances don't change the context menu")));
});

test("The window may only show the app's own UI: navigating to another address is blocked and the UI stays", async ({ shell }) => {
  await shell.launch();
  const before = shell.page.url();
  await shell.page.evaluate(() => {
    location.href = "https://example.com/";
  });
  await waitFor("the log to record the blocked navigation", () => shell.log().some((l) => l.includes("Blocked navigation to another address: https://example.com/")));
  expect(shell.page.url()).toBe(before);
  await expect(shell.page.locator(".lib-row", { hasText: "hero.png" })).toBeVisible();
});

test("Opening a new window from the UI (window.open, a target=_blank link): never opens one, there is still one window and the UI is unchanged", async ({
  shell,
}) => {
  await shell.launch();
  await shell.page.evaluate(() => {
    window.open("https://example.com/");
    const a = Object.assign(document.createElement("a"), { href: "https://example.com/", target: "_blank" });
    document.body.append(a);
    a.click();
    a.remove();
  });
  await new Promise((r) => setTimeout(r, 1000));
  expect(shell.windows()).toHaveLength(1);
  await expect(shell.page.locator(".lib-row", { hasText: "hero.png" })).toBeVisible();
});
