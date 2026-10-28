// The shell half of getting files in: command-line arguments, an autostart colliding with a running instance,
// a moved project passed over by a second process, a library entry on a drive that isn't plugged in, and a real drag from File Explorer
// (CDP drag events; the UI receives real File objects).
// The UI half is in tests/e2e/add-materials.spec.ts

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEAD_SHARE, expect, test, type Shell } from "./harness";

const toast = (shell: Shell) => shell.page.locator(".toast");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const row = (shell: Shell, name: string) =>
  shell.page.locator(".lib-row", { has: shell.page.locator(".lib-name", { hasText: new RegExp(`^${escape(name)}$`) }) });

/** A folder outside the project (on the same drive, so the page needn't reload) with a few images in it */
function outside(shell: Shell, name: string, files: string[]) {
  const dir = join(shell.temp, name);
  for (const f of files) {
    mkdirSync(join(dir, f, ".."), { recursive: true });
    copyFileSync(join(shell.project, "assets", "hero.png"), join(dir, f));
  }
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A drive letter that doesn't exist where the test runs (searched from Z back to H): stands in for an unplugged USB drive */
function absentDrive() {
  const letter = [..."ZYXWVUTSRQPONMLKJIH"].find((c) => !existsSync(`${c}:\\`));
  if (!letter) throw new Error("No free drive letter found");
  return `${letter}:\\`;
}

/**
 * Drive letters for tests that plug a drive in: searched from H upwards, the opposite end from absentDrive (Z downwards), so a drive mapped here
 * is never the one another test treats as unplugged. Two such tests must not run at the same time (they could pick the same letter): see the describe below
 */
function freeLetter() {
  const letter = [..."HIJKLMNOPQRSTUVWXYZ"].find((c) => !existsSync(`${c}:\\`));
  if (!letter) throw new Error("No free drive letter found");
  return letter;
}

/** Plugs a drive in: the letter becomes a working drive showing this folder (subst; it is per login session and needs no rights) */
function plugIn(letter: string, dir: string) {
  const r = spawnSync("subst", [`${letter}:`, dir], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`subst ${letter}: failed: ${r.stdout}${r.stderr}`);
}

/** Pulls it out again; harmless when it isn't plugged in */
function unplug(letter: string) {
  spawnSync("subst", [`${letter}:`, "/d"], { stdio: "ignore" });
}

test("A library entry on an unplugged drive: the app starts as usual, that entry says its drive is not connected, other files show as usual", async ({
  shell,
}) => {
  const offline = join(absentDrive(), "U 盘上的", "片子");
  shell.setLibrary([shell.project, offline]);
  await shell.launch();
  await expect(row(shell, "片子")).toContainText("所在磁盘未连接");
  await expect(shell.page).toHaveTitle("hero.png");
  await expect(shell.page.locator(".zoom-media")).toBeVisible();
});

test("A library entry on an unreachable network drive: startup, the library and other files don't wait for it (the system timeout takes tens of seconds), and that entry says its drive is not connected", async ({
  shell,
}) => {
  shell.setLibrary([shell.project, join(DEAD_SHARE, "片子")]);
  const t0 = Date.now();
  await shell.launch();
  await expect(shell.page).toHaveTitle("hero.png");
  await expect(shell.page.locator(".zoom-media")).toBeVisible();
  expect(Date.now() - t0).toBeLessThan(8000);
  await expect(row(shell, "片子")).toContainText("所在磁盘未连接");
});

test("Paths added on an unreachable network drive (command line, opened from outside, dropped in): the UI stays usable while checking and says not found afterwards", async ({
  shell,
}) => {
  /** How long the shell takes to answer one bridge call: while the UI thread is stuck it has to wait for the check to finish */
  const answerMs = async () => {
    const t = Date.now();
    await shell.ask("windowState");
    return Date.now() - t;
  };
  const notFound = (name: string) => expect(toast(shell)).toContainText(`找不到文件或文件夹：${join(DEAD_SHARE, name)}`, { timeout: 15_000 });
  const t0 = Date.now();
  await shell.launch({ args: [join(DEAD_SHARE, "启动带的.png")] });
  await expect(shell.page).toHaveTitle("hero.png");
  expect(Date.now() - t0).toBeLessThan(8000);
  await notFound("启动带的.png");
  expect(await shell.second([join(DEAD_SHARE, "转过来的.png")])).toBe(0);
  expect(await answerMs()).toBeLessThan(1500);
  await notFound("转过来的.png");
  // Files dropped in or chosen in a dialog go through libraryAdd: the shell replies only after the check finishes, while other calls are still answered meanwhile
  const adding = shell.ask<{ added: string[]; skipped: string[] }>("libraryAdd", { paths: [join(DEAD_SHARE, "拖进来的.png")] });
  expect(await answerMs()).toBeLessThan(1500);
  expect(await adding).toMatchObject({ added: [], skipped: [`找不到文件或文件夹：${join(DEAD_SHARE, "拖进来的.png")}`] });
  await expect(row(shell, "hero.png")).toBeVisible();
});

test("Relative paths on the command line: resolved against the current folder of the process that was started (the first process and a handed-over one alike)", async ({
  shell,
}) => {
  const dir = outside(shell, "相对的", ["r1.png", "子/r2.png"]);
  await shell.launch({ args: ["r1.png"], cwd: dir });
  await expect(shell.page).toHaveTitle("r1.png");
  expect(await shell.second(["r2.png"], { cwd: join(dir, "子") })).toBe(0);
  await expect(shell.page).toHaveTitle("r2.png");
});

test("An autostart colliding with a running instance (another --tray): exits silently, the hidden window stays hidden, and the path it carries isn't handed over", async ({
  shell,
}) => {
  await shell.launch();
  await shell.page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect.poll(() => shell.windowShown()).toBe(false);
  const dir = outside(shell, "外面的", ["t.png"]);
  expect(await shell.second(["--tray", join(dir, "t.png")])).toBe(0);
  await shell.page.waitForTimeout(800);
  expect(shell.windowShown()).toBe(false);
  expect(shell.alive()).toBe(true);
  await expect(row(shell, "t.png")).toHaveCount(0);
});

test("A folder and a .txt on the command line: the project appears, the first file in it opens, and once the UI has loaded it says .txt isn't supported", async ({
  shell,
}) => {
  const dir = outside(shell, "带进来的", ["a.png", "子/b.png"]);
  writeFileSync(join(dir, "说明.txt"), "x");
  await shell.launch({ args: [dir, join(dir, "说明.txt")] });
  await expect(shell.page.locator(".lib-row.is-project", { hasText: "带进来的" })).toBeVisible();
  await expect(shell.page).toHaveTitle("b.png");
  await expect(toast(shell)).toContainText("不支持此文件类型（.txt）：说明.txt");
});

test("Opening a moved project from outside while the app runs (a second process hands it over): says it was recognized and the library entry is replaced in place", async ({
  shell,
}) => {
  const to = join(shell.temp, "挪过去", "project");
  mkdirSync(join(shell.temp, "挪过去"));
  renameSync(shell.project, to);
  await shell.launch();
  await expect(row(shell, "project")).toContainText("找不到");
  expect(await shell.second([to])).toBe(0);
  await expect(toast(shell)).toContainText(`已识别：「project」已移动到 ${to}`);
  await expect(row(shell, "hero.png")).toBeVisible();
});

test("A dropped item that isn't a local file (an image dragged out of a web page): the shell gets no path, the UI says so, and the library is unchanged", async ({
  shell,
}) => {
  await shell.launch();
  await expect(shell.page).toHaveTitle("hero.png");
  await shell.page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(["x"], "网页里的图.png", { type: "image/png" }));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await expect(toast(shell)).toContainText("不是本机文件");
  await expect(row(shell, "网页里的图.png")).toHaveCount(0);
});

test("Opening a network path from outside while the app runs (a drive first used after the page loaded): the page reloads once and then opens it; another file on the same drive doesn't reload again", async ({
  shell,
}) => {
  const local = outside(shell, "网络上的", ["n1.png", "n2.png"]);
  const unc = `\\\\localhost\\${local[0].toLowerCase()}$${local.slice(2)}`;
  test.skip(!existsSync(unc), "\\\\localhost\\c$ is not reachable here");
  await shell.launch();
  await expect(shell.page).toHaveTitle("hero.png");
  const loadedAt = await shell.page.evaluate(() => performance.timeOrigin);
  expect(await shell.second([join(unc, "n1.png"), join(unc, "没有这个.png")])).toBe(0);
  const page = await shell.connect();
  await expect(page).toHaveTitle("n1.png");
  expect(await page.evaluate(() => performance.timeOrigin)).not.toBe(loadedAt);
  await expect(page.locator(".toast")).toContainText("找不到文件或文件夹");
  const reloadedAt = await page.evaluate(() => performance.timeOrigin);
  expect(await shell.second([join(unc, "n2.png")])).toBe(0);
  await expect(page).toHaveTitle("n2.png");
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(reloadedAt);
});

test("Another process holds the single-instance lock but can't be reached (hung): waits at most 5 seconds, then opens its own window and logs a line", async ({
  shell,
}) => {
  // Compute the lock name (as SingleInstance.IdFor does: the first 16 hex digits of the SHA-256 of the lowercased settings file path),
  // then start another process that holds it and never opens the pipe
  const id = createHash("sha256").update(join(shell.temp, "settings.json").toLowerCase(), "utf8").digest("hex").toUpperCase().slice(0, 16);
  const holder = spawn("pwsh", ["-NoProfile", "-Command", `$m = [Threading.Mutex]::new($true, 'Local\\SnipToss-${id}'); Start-Sleep 60`], { stdio: "ignore" });
  try {
    await new Promise((r) => setTimeout(r, 1500)); // pwsh starts and takes the lock
    const started = Date.now();
    await shell.launch();
    expect(Date.now() - started).toBeGreaterThan(4000);
    expect(shell.log().some((l) => l.includes("Could not reach the window that is already open"))).toBe(true);
    await expect(shell.page).toHaveTitle("hero.png");
  } finally {
    holder.kill();
  }
});

test("Dragging in from File Explorer (real drag events): the shell gets the file's real path, adds it to the library and opens it; a dragged folder becomes one project", async ({
  shell,
}) => {
  const dir = outside(shell, "拖进来的", ["d.png", "夹/e.png"]);
  await shell.launch();
  await expect(shell.page).toHaveTitle("hero.png"); // drag only after the first file has opened at startup (otherwise the startup jump may arrive late and switch the canvas back)
  const cdp = await shell.page.context().newCDPSession(shell.page);
  // Count the drop events the page receives: when the whole suite runs in parallel the CDP drag events occasionally don't reach the page
  // (never when run alone); if they didn't arrive, resend them, which is the test tool's issue. It is the app's problem only if they arrived and nothing was added
  await shell.page.evaluate(() => {
    const w = window as unknown as { __drops: number };
    w.__drops = 0;
    window.addEventListener("drop", () => void w.__drops++, true);
  });
  const drops = () => shell.page.evaluate(() => (window as unknown as { __drops: number }).__drops);
  const drop = async (path: string) => {
    const data = { items: [], files: [path], dragOperationsMask: 1 };
    const before = await drops();
    for (let attempt = 1; ; attempt++) {
      for (const type of ["dragEnter", "dragOver", "drop"] as const) await cdp.send("Input.dispatchDragEvent", { type, x: 600, y: 400, data });
      const arrived = await expect.poll(drops, { timeout: 2000 }).toBeGreaterThan(before).then(() => true, () => false);
      if (arrived) return;
      if (attempt === 3) throw new Error("The CDP drag events did not reach the page in three attempts");
      console.warn(`Drag events did not reach the page, attempt ${attempt + 1}`);
    }
  };
  await drop(join(dir, "d.png"));
  await expect(row(shell, "d.png")).toBeVisible();
  await expect(shell.page).toHaveTitle("d.png");
  await drop(join(dir, "夹"));
  await expect(shell.page).toHaveTitle("e.png");
  await expect(shell.page.locator(".lib-row", { hasText: "夹" }).first()).toBeVisible();
});

// These tests map a real drive letter (subst), so they run one after another on one worker: two of them could otherwise pick the same letter
test.describe("A drive plugged in", () => {
  test.describe.configure({ mode: "serial" });

  /**
   * The right-click command is `"SnipToss.exe" "%V"`, and for blank space at a drive root %V is `X:\`, so the command line File Explorer builds is
   * `"SnipToss.exe" "X:\"`. Windows reads a backslash before a quote as an escaped quote, so the program receives `X:"`. Putting that exact text
   * on the command line (verbatim) goes through the same parsing the right-click does
   */
  const explorerArg = (letter: string) => `"${letter}:\\"`;
  const libraryPaths = (shell: Shell) =>
    (JSON.parse(readFileSync(join(shell.temp, "settings.json"), "utf8")).Library as { Path: string }[]).map((e) => e.Path.toUpperCase());

  test("Opening from the blank space of a drive root the way File Explorer does (the program receives the drive letter, a colon and a stray quote): the drive is added and its file opens, with no invalid-path message", async ({
    shell,
  }) => {
    const letter = freeLetter();
    const disk = join(shell.temp, "disk");
    mkdirSync(disk);
    copyFileSync(join(shell.project, "assets", "hero.png"), join(disk, "盘根上的.png"));
    plugIn(letter, disk);
    try {
      await shell.launch({ args: [explorerArg(letter)], verbatim: true });
      // The system really holds the command line the right-click builds: program in quotes, then the drive root in quotes ending in a backslash
      const commandLine = spawnSync(
        "pwsh",
        ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${shell.proc!.pid}").CommandLine`],
        { encoding: "utf8" },
      ).stdout.trim();
      expect(commandLine).toMatch(/^".*SnipToss\.exe" "[H-Z]:\\"$/);
      await expect(shell.page).toHaveTitle("盘根上的.png");
      await expect(row(shell, "盘根上的.png")).toBeVisible();
      expect(libraryPaths(shell)).toContain(`${letter}:\\`);
      await expect(toast(shell)).toHaveCount(0); // it used to say the path was invalid
      expect(shell.log().filter((l) => l.includes("[WARN]") || l.includes("[ERROR]"))).toEqual([]);
    } finally {
      unplug(letter);
    }
  });

  test("Opening from the blank space of a drive root while the app is running (a second process with the same command line hands it over): the drive is added and its file opens, with no invalid-path message", async ({
    shell,
  }) => {
    const letter = freeLetter();
    const disk = join(shell.temp, "disk");
    mkdirSync(disk);
    copyFileSync(join(shell.project, "assets", "hero.png"), join(disk, "盘根上的.png"));
    plugIn(letter, disk);
    try {
      await shell.launch();
      await expect(shell.page).toHaveTitle("hero.png");
      const loadedAt = await shell.page.evaluate(() => performance.timeOrigin);
      expect(await shell.second([explorerArg(letter)], { verbatim: true })).toBe(0);
      // A drive letter not used before is mapped for the page, which then reloads once (WebView2 maps drives only for later navigations)
      const page = await shell.connect();
      await expect(page).toHaveTitle("盘根上的.png");
      expect(await page.evaluate(() => performance.timeOrigin)).not.toBe(loadedAt);
      await expect(row(shell, "盘根上的.png")).toBeVisible();
      expect(libraryPaths(shell)).toContain(`${letter}:\\`);
      await expect(toast(shell)).toHaveCount(0);
      expect(shell.log().filter((l) => l.includes("[WARN]") || l.includes("[ERROR]"))).toEqual([]);
    } finally {
      unplug(letter);
    }
  });

  test("A drive that shows up after launch: the entry that said its drive is not connected lists its files and the page reloads once; pulling the drive out says so again, and plugging it back in doesn't reload", async ({
    shell,
  }) => {
    // The background check of every entry runs every ten seconds or so, so each change takes up to about that long to show
    test.setTimeout(150_000);
    const letter = freeLetter();
    const disk = join(shell.temp, "disk");
    mkdirSync(join(disk, "片子"), { recursive: true });
    for (const n of ["晚到的1.png", "晚到的2.png"]) copyFileSync(join(shell.project, "assets", "hero.png"), join(disk, "片子", n));
    shell.setLibrary([shell.project, join(`${letter}:\\`, "片子")]);
    try {
      await shell.launch();
      await expect(row(shell, "片子")).toContainText("所在磁盘未连接");
      await expect(row(shell, "hero.png")).toBeVisible(); // the other entry shows as usual meanwhile
      const loadedAt = await shell.page.evaluate(() => performance.timeOrigin);

      plugIn(letter, disk);
      await expect(row(shell, "片子")).not.toContainText("所在磁盘未连接", { timeout: 30_000 });
      await expect(row(shell, "晚到的1.png")).toBeVisible();
      await expect(row(shell, "晚到的2.png")).toBeVisible();
      await expect(row(shell, "hero.png")).toBeVisible();
      const reloadedAt = await shell.page.evaluate(() => performance.timeOrigin);
      expect(reloadedAt).not.toBe(loadedAt); // the drive was mapped for the page after it loaded, so the page was reloaded (once, see below)

      unplug(letter);
      await expect(row(shell, "片子")).toContainText("所在磁盘未连接", { timeout: 30_000 });
      await expect(row(shell, "hero.png")).toBeVisible();

      plugIn(letter, disk);
      await expect(row(shell, "片子")).not.toContainText("所在磁盘未连接", { timeout: 30_000 });
      await expect(row(shell, "晚到的1.png")).toBeVisible();
      expect(await shell.page.evaluate(() => performance.timeOrigin)).toBe(reloadedAt);
    } finally {
      unplug(letter);
    }
  });
});
