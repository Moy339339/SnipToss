// Performance budget: npm run perf.
// Measured on real-shell test instances (tests/shell/harness.ts); prints a table at the end and fails when over budget. Must pass before a release.
//   hot start to a usable UI ≤ 1.0 s, cold start ≤ 2.0 s
//   capture hotkey to the capture overlay appearing ≤ 200 ms
//   scrolling a library of 20,000 files and a notes panel of 1000 notes drops no frames
// "Cold start" here means a fresh WebView2 data folder (first launch after install); the first launch after boot
// (when the system file cache is cold too) can't be measured, so the numbers come out optimistic.

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Locator } from "@playwright/test";
import { expect, test, waitFor, type Shell } from "../shell/harness";

const BUDGET = { cold: 2000, hot: 1000, capture: 200 };
/** Scrolling: a frame longer than this counts as dropped (a 60 Hz frame is 16.7 ms, plus some margin) */
const DROPPED_MS = 34;
/** At most this share of frames may be dropped */
const DROPPED_RATIO = 0.03;

/** A 1×1 PNG (takes little space when there are many files) */
const PIXEL = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64");

const report: string[] = [];
test.afterAll(() => console.log(`\nPerformance budget\n${report.join("\n")}\n`));

/** All of the test instance's WebView2 child processes have exited (otherwise starting again right away waits a few extra seconds) */
function webviewGone(shell: Shell) {
  const r = spawnSync(
    "pwsh",
    [
      "-NoProfile",
      "-Command",
      `(Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -like '*${shell.temp.replaceAll("'", "''")}*' }).Count`,
    ],
    { encoding: "utf8" },
  );
  return r.stdout.trim() === "0" || r.stdout.trim() === "";
}

/** In the page, scrolls the container matching selector by step pixels per frame for ms milliseconds, and returns the interval of each frame */
async function scrollFrames(shell: Shell, selector: string, ms = 2000, step = 60): Promise<{ frames: number[]; scrollable: number }> {
  return shell.page.evaluate(
    ({ selector: scroller, ms: duration, step: pixels }) =>
      new Promise<{ frames: number[]; scrollable: number }>((resolve) => {
        const el = document.querySelector(scroller) as HTMLElement;
        const scrollable = el.scrollHeight - el.clientHeight;
        const frames: number[] = [];
        let last = performance.now();
        const end = last + duration;
        let dir = 1;
        const tick = (now: number) => {
          frames.push(now - last);
          last = now;
          if (el.scrollTop + pixels > scrollable) dir = -1;
          else if (el.scrollTop - pixels < 0) dir = 1;
          el.scrollTop += dir * pixels;
          if (now < end) requestAnimationFrame(tick);
          else resolve({ frames: frames.slice(1), scrollable });
        };
        requestAnimationFrame(tick);
      }),
    { selector, ms, step },
  );
}

function frameStats(frames: number[]) {
  const sorted = [...frames].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const dropped = frames.filter((f) => f > DROPPED_MS).length;
  return { p95: Math.round(p95 * 10) / 10, dropped, ratio: dropped / Math.max(1, frames.length), worst: Math.round(sorted.at(-1) ?? 0) };
}

test("Startup: cold start (fresh data folder) ≤ 2 s, hot start ≤ 1 s", async ({ shell }) => {
  test.setTimeout(120_000);
  await shell.launch();
  const cold = (await waitFor("the cold start time to be recorded", () => shell.perf()["Process start → UI ready"]))[0];
  await shell.callHost("window", { action: "quit" });
  await waitFor("the process to exit", () => !shell.alive());
  await waitFor("the WebView2 child processes to exit", () => webviewGone(shell), 20_000);
  await shell.launch();
  const hot = (
    await waitFor(
      "the hot start time to be recorded",
      () => (shell.perf()["Process start → UI ready"]?.length ?? 0) >= 2 && shell.perf()["Process start → UI ready"],
    )
  )[1];
  report.push(`Cold start ${cold} ms (budget ${BUDGET.cold})`, `Hot start ${hot} ms (budget ${BUDGET.hot})`);
  expect(cold).toBeLessThanOrEqual(BUDGET.cold);
  expect(hot).toBeLessThanOrEqual(BUDGET.hot);
});

test("Capture hotkey to capture overlay ≤ 200 ms (median of 3; the first press after launch is included)", async ({ shell }) => {
  test.setTimeout(120_000);
  await shell.launch();
  for (let i = 0; i < 3; i++) {
    await shell.callHost("captureStart");
    await waitFor("the capture overlay appearance to be recorded", () => (shell.perf()["Hotkey → capture overlay shown"]?.length ?? 0) > i);
    await new Promise((r) => setTimeout(r, 300));
    shell.windows(true);
    await waitFor("the main window to come back", () => shell.windowShown());
  }
  const times = shell.perf()["Hotkey → capture overlay shown"];
  const median = [...times].sort((a, b) => a - b)[1];
  report.push(
    `Capture overlay appeared in ${times.join(" / ")} ms, median ${median} (budget ${BUDGET.capture}, the first press after launch counts too)`,
  );
  expect(median).toBeLessThanOrEqual(BUDGET.capture);
  // First press after launch: the overlay was warmed up while the UI was idle (CaptureSession.WarmUp);
  // otherwise building it and applying the template costs another 50–100 ms
  expect(times[0], "first press after launch").toBeLessThanOrEqual(BUDGET.capture);
});

test("Library with 20,000 files: scrolling drops no frames", async ({ shell }) => {
  test.setTimeout(240_000);
  const big = join(shell.temp, "big");
  mkdirSync(big);
  for (let i = 0; i < 20_000; i++) writeFileSync(join(big, `img-${String(i).padStart(5, "0")}.png`), PIXEL);
  shell.setLibrary([big]);
  const t0 = Date.now();
  await shell.launch();
  await expect(shell.page.locator(".lib-row", { hasText: "img-00000.png" })).toBeVisible({ timeout: 120_000 });
  const ready = Date.now() - t0;
  const rows = await shell.page.locator(".lib-row").count();
  const { frames, scrollable } = await scrollFrames(shell, ".lib-list");
  const s = frameStats(frames);
  report.push(
    `20,000-file library: launch to listed ${ready} ms, ${rows} rows in the DOM; scrolled ${frames.length} frames, p95 ${s.p95} ms, worst ${s.worst} ms, dropped ${s.dropped} (${(s.ratio * 100).toFixed(1)}%, budget ${DROPPED_RATIO * 100}%)`,
  );
  expect(scrollable).toBeGreaterThan(0);
  expect(s.ratio).toBeLessThanOrEqual(DROPPED_RATIO);
});

/** A project of 50 files with 20 notes each (1000 in all) as the only library entry; launches the app and waits until every note is listed */
async function launchWithThousandNotes(shell: Shell) {
  const proj = join(shell.temp, "many");
  const ann = join(proj, ".sniptoss", "annotations");
  mkdirSync(ann, { recursive: true });
  for (let m = 0; m < 50; m++) {
    const name = `shot-${String(m).padStart(2, "0")}.png`;
    writeFileSync(join(proj, name), PIXEL);
    const annotations = Array.from({ length: 20 }, (_, i) => ({
      id: `${String(m).padStart(2, "0")}${String(i).padStart(2, "0")}aa`,
      status: "open",
      category: "change",
      body: `第 ${m + 1} 张图的第 ${i + 1} 条意见：标题字再大一点，按钮颜色换成品牌蓝，右下角的水印去掉`,
      anchor: { shape: { type: "rect", x: 0.1, y: 0.1, w: 0.5, h: 0.3 } },
      author: "user",
      created_at: "2026-10-18T00:00:00Z",
      updated_at: "2099-01-01T00:00:00Z",
      replies: [],
    }));
    writeFileSync(
      join(ann, `${name}.json`),
      JSON.stringify({ schema: "sniptoss/4", material: { path: name, kind: "image", width: 1, height: 1 }, annotations }, null, 2),
    );
  }
  shell.setLibrary([proj]);
  const t0 = Date.now();
  await shell.launch();
  await expect(shell.page.locator(".card")).toHaveCount(1000, { timeout: 120_000 });
  return { proj, ready: Date.now() - t0 };
}

test("Notes panel with 1000 notes (50 files × 20 notes, whole project): scrolling drops no frames", async ({ shell }) => {
  test.setTimeout(240_000);
  const { ready } = await launchWithThousandNotes(shell);
  const { frames, scrollable } = await scrollFrames(shell, ".panel-body");
  const s = frameStats(frames);
  report.push(
    `1000 notes: launch to all listed ${ready} ms; scrolled ${frames.length} frames, p95 ${s.p95} ms, worst ${s.worst} ms, dropped ${s.dropped} (${(s.ratio * 100).toFixed(1)}%, budget ${DROPPED_RATIO * 100}%)`,
  );
  expect(scrollable).toBeGreaterThan(0);
  expect(s.ratio).toBeLessThanOrEqual(DROPPED_RATIO);
});

/** How quickly the page answers a click: milliseconds from the click until two frames were painted after it, plus the gap between every frame from then on */
async function clickToPainted(target: Locator, watchMs = 800) {
  return target.evaluate(
    (el, watch) =>
      new Promise<{ ms: number; frames: number[] }>((resolve) => {
        const frames: number[] = [];
        let last = performance.now();
        let from = -1;
        let running = true;
        const loop = (now: number) => {
          frames.push(now - last);
          last = now;
          if (running) requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
        // Start from a frame boundary, so the click isn't measured from the middle of a frame
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            from = frames.length;
            const t0 = performance.now();
            (el as HTMLElement).click(); // React handles a click synchronously: the new DOM is committed when this returns
            requestAnimationFrame(() =>
              requestAnimationFrame(() => {
                const ms = performance.now() - t0;
                setTimeout(() => {
                  running = false;
                  resolve({ ms, frames: frames.slice(from) });
                }, watch);
              }),
            );
          }),
        );
      }),
    watchMs,
  );
}

/**
 * The interactions in the notes panel answer within this many milliseconds, and no frame while the shell writes is longer than LONG_FRAME_MS.
 * Switching back to the whole project builds the 1000 cards from nothing, which takes longer than toggling what is already there
 */
const REACTS_MS = 200;
const BUILDS_ALL_MS = 300;
const LONG_FRAME_MS = 100;

test("Notes panel with 1000 notes: Select All, switching the scope back and forth and marking one note done each answer within 200 ms (300 ms for building all the cards)", async ({ shell }) => {
  test.setTimeout(240_000);
  const { proj } = await launchWithThousandNotes(shell);
  const page = shell.page;
  const results: { what: string; ms: number; worst: number }[] = [];
  const check = async (what: string, target: Locator) => {
    const r = await clickToPainted(target);
    results.push({ what, ms: Math.round(r.ms), worst: Math.round(Math.max(0, ...r.frames)) });
    return r;
  };

  // 1. Select All: 1000 cards get their check mark
  await check("Select All", page.locator(".dock-all"));
  await expect(page.locator(".dock-all")).toHaveAttribute("aria-checked", "true");
  await expect(page.locator('.card .card-check[aria-checked="true"]')).toHaveCount(1000);
  await check("Clear all", page.locator(".dock-all"));
  await expect(page.locator('.card .card-check[aria-checked="true"]')).toHaveCount(0);

  // 2. The notes panel's scope: this image (20 notes) and the whole project (1000), three times over
  const thisOne = page.locator(".scope-switch .seg").nth(0);
  const project = page.locator(".scope-switch .seg").nth(1);
  for (let round = 1; round <= 3; round++) {
    await check(`Scope this image (${round})`, thisOne);
    await expect(page.locator(".card")).toHaveCount(20);
    await check(`Scope whole project (${round})`, project);
    await expect(page.locator(".card")).toHaveCount(1000);
  }

  // 3. Mark one note done through its ⋯ menu: the page reacts at once, while the shell writes the notes file and REVIEW.md
  const card = page.locator('[data-annot$="|0000aa"]');
  await card.hover();
  await card.locator('.act[title^="更多"]').click();
  const review = join(proj, ".sniptoss", "REVIEW.md");
  const reviewBefore = statSync(review, { throwIfNoEntry: false })?.mtimeMs ?? 0;
  const done = await check("Mark one note done", page.getByRole("menuitem", { name: "标记为已改" }));
  const statusOnDisk = () =>
    (JSON.parse(readFileSync(join(proj, ".sniptoss", "annotations", "shot-00.png.json"), "utf8")).annotations as { id: string; status: string }[]).find(
      (a) => a.id === "0000aa",
    )?.status;
  await expect.poll(statusOnDisk).toBe("resolved");
  await expect.poll(() => statSync(review, { throwIfNoEntry: false })?.mtimeMs ?? 0).toBeGreaterThan(reviewBefore);
  expect(done.frames.length).toBeGreaterThan(5); // the page kept drawing while the write went on

  report.push(
    `1000 notes, click to two frames painted / longest frame in the 0.8 s after (budget ${REACTS_MS} ms, ${BUILDS_ALL_MS} ms for building all 1000 cards; ${LONG_FRAME_MS} ms for the write): ${results.map((r) => `${r.what} ${r.ms} / ${r.worst} ms`).join("; ")}`,
  );
  for (const r of results) expect.soft(r.ms, `${r.what}: click to painted`).toBeLessThanOrEqual(r.what.startsWith("Scope whole") ? BUILDS_ALL_MS : REACTS_MS);
  expect.soft(results.at(-1)!.worst, "Mark one note done: longest frame while the shell writes").toBeLessThanOrEqual(LONG_FRAME_MS);
});

test("Dragging the library edge across its whole range with 20 files in the list drops no frames, and releasing outside the window ends the drag", async ({ shell }) => {
  test.setTimeout(120_000);
  const dir = join(shell.temp, "twenty");
  mkdirSync(dir);
  for (let i = 0; i < 20; i++) writeFileSync(join(dir, `img-${String(i).padStart(2, "0")}.png`), PIXEL);
  shell.setLibrary([dir]);
  await shell.launch();
  const page = shell.page;
  await expect(page.locator(".lib-row", { hasText: "img-19.png" })).toBeVisible();
  const sidebarWidth = async () => Math.round((await page.locator("aside.sidebar").boundingBox())!.width);
  const storedWidth = () => page.evaluate(() => JSON.parse(localStorage.getItem("sniptoss.panels") ?? "null")?.left?.width ?? null);
  expect(await sidebarWidth()).toBe(260);

  // Record every frame while the mouse goes narrowest, widest, narrowest again, about 2 seconds for each pass (the library re-lays out on every move)
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __running: boolean };
    w.__frames = [];
    w.__running = true;
    let last = performance.now();
    const loop = (now: number) => {
      w.__frames.push(now - last);
      last = now;
      if (w.__running) requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
  const sash = (await page.locator(".sash-left").boundingBox())!;
  const x0 = sash.x + sash.width / 2 - 260; // where the library's left edge would be: the sash is at x0 + width
  const y = sash.y + 300;
  await page.mouse.move(x0 + 260, y);
  await page.mouse.down();
  const sweep = async (from: number, to: number, steps: number) => {
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(x0 + from + ((to - from) * i) / steps, y);
      await page.waitForTimeout(2000 / steps); // paced like a hand, not a burst
    }
  };
  await sweep(260, 180, 15);
  expect(await sidebarWidth()).toBe(180);
  await sweep(180, 520, 60);
  expect(await sidebarWidth()).toBe(520);
  await sweep(520, 180, 60);
  expect(await sidebarWidth()).toBe(180);
  // Let go far outside the window, to the right of it: the width is the widest, not wherever the mouse was last inside
  await page.mouse.move(x0 + 520 + 900, y, { steps: 5 });
  await page.mouse.up();
  const frames = await page.evaluate(() => {
    const w = window as unknown as { __frames: number[]; __running: boolean };
    w.__running = false;
    return w.__frames.slice(1);
  });
  const s = frameStats(frames);
  report.push(
    `Library edge drag with 20 files: ${frames.length} frames, p95 ${s.p95} ms, worst ${s.worst} ms, dropped ${s.dropped} (${(s.ratio * 100).toFixed(1)}%, budget ${DROPPED_RATIO * 100}%)`,
  );
  expect(s.ratio).toBeLessThanOrEqual(DROPPED_RATIO);

  await expect.poll(sidebarWidth).toBe(520);
  expect(await storedWidth()).toBe(520);
  // The drag is over: moving the mouse back across the window changes nothing, and nothing was selected on the way
  await page.mouse.move(x0 + 300, y, { steps: 10 });
  await page.waitForTimeout(300);
  expect(await sidebarWidth()).toBe(520);
  expect(await storedWidth()).toBe(520);
  expect(await page.evaluate(() => String(getSelection()))).toBe("");
});
