// Edge cases that only show in the real shell: special characters in file names through the virtual host, long paths over 260 characters,
// network paths (UNC), folders that can't be written to, huge images, 4K video, 2-hour video, HEVC / ProRes, and an open file being deleted.
// Each one runs through "the file shows → draw a note → the note and snapshot are really written to disk".

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { userInfo } from "node:os";
import { basename, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { CLI, expect, test, type Shell } from "./harness";
import { stripedPng } from "../e2e/png";

/** Puts an image under root (relative path separated by /) and returns the absolute path */
function placeImage(shell: Shell, root: string, rel: string) {
  const file = join(root, ...rel.split("/"));
  mkdirSync(join(file, ".."), { recursive: true });
  copyFileSync(join(shell.project, "assets", "hero.png"), file);
  return file;
}

/** At startup the library holds only root and the command line passes file (added to the library and jumped to); waits until it shows */
async function open(shell: Shell, root: string, file: string, prefs: Record<string, unknown> = {}) {
  shell.setLibrary([root]);
  const settings = JSON.parse(readFileSync(join(shell.temp, "settings.json"), "utf8"));
  writeFileSync(join(shell.temp, "settings.json"), JSON.stringify({ ...settings, Prefs: { ...settings.Prefs, ...prefs } }));
  await shell.launch({ args: [file] });
  await expect(shell.page).toHaveTitle(basename(file));
  await expect
    .poll(
      () =>
        shell.page.evaluate(() => {
          const video = document.querySelector<HTMLVideoElement>(".stage video");
          if (video) return video.readyState >= 2 && video.videoWidth > 0;
          return [...document.images].some((i) => i.closest(".stage") && i.complete && i.naturalWidth > 0);
        }),
      { timeout: 30_000 },
    )
    .toBe(true);
}

/** Seeks the video to t seconds and waits for the frame */
async function seek(shell: Shell, t: number) {
  await shell.page.evaluate(
    (seconds) =>
      new Promise<void>((resolve) => {
        const v = document.querySelector<HTMLVideoElement>(".stage video")!;
        v.pause();
        v.addEventListener("seeked", () => resolve(), { once: true });
        v.currentTime = seconds;
      }),
    t,
  );
}

/** Generates a test video with ffmpeg (too big for the repo); returns false if there is no ffmpeg */
function makeVideo(out: string, args: string[]) {
  mkdirSync(join(out, ".."), { recursive: true });
  return spawnSync("ffmpeg", ["-v", "error", "-y", ...args, out], { encoding: "utf8" }).status === 0;
}

/** Picks the Rectangle tool (R), drags a box in the middle of the canvas, types the comment and saves */
async function drawRect(shell: Shell, body: string) {
  const { page } = shell;
  await page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("r");
  const box = (await page.locator(".annot-input").boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 5 });
  await page.mouse.up();
  await page.locator(".composer-text").fill(body);
  await page.keyboard.press("Control+Enter");
}

interface Saved {
  name: string;
  material: { path: string };
  annotations: { body: string; snapshot?: string; anchor: { time?: { start: number } } }[];
}

/** All notes files in home's notes folder */
function savedFiles(home: string): Saved[] {
  const dir = join(home, ".sniptoss", "annotations");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((name) => ({ name, ...JSON.parse(readFileSync(join(dir, name), "utf8")) }));
}

/** Draws a note and waits until it is written to home together with its snapshot; returns the saved file */
async function annotateAndCheck(shell: Shell, home: string, file: string, body: string) {
  await drawRect(shell, body);
  const rel = relative(home, file).replaceAll("\\", "/");
  await expect
    .poll(
      () =>
        savedFiles(home)
          .find((f) => f.material.path === rel)
          ?.annotations.map((a) => a.body),
      { timeout: 15_000 },
    )
    .toEqual([body]);
  const saved = savedFiles(home).find((f) => f.material.path === rel)!;
  const shot = saved.annotations[0].snapshot;
  expect(shot, "the note carries a snapshot").toBeTruthy();
  await expect.poll(() => existsSync(join(home, ".sniptoss", ...shot!.split("/")))).toBe(true);
  await expect
    .poll(() => existsSync(join(home, ".sniptoss", "REVIEW.md")) && readFileSync(join(home, ".sniptoss", "REVIEW.md"), "utf8"))
    .toContain(body);
  return saved;
}

test("File names with # % & + spaces, emoji and Chinese: shown through the virtual host, with the note and snapshot written", async ({ shell }) => {
  const root = join(shell.temp, "项目 #1 50%");
  const file = placeImage(shell, root, "图 & 稿/封面 #2 100% + 'a' [终版] 🎨;=,~@.png");
  await open(shell, root, file);
  await annotateAndCheck(shell, root, file, "标题往上挪");
});

test("Long path over 260 characters: shown, with the note and snapshot written", async ({ shell }) => {
  const root = join(shell.temp, "long");
  const deep = Array.from({ length: 8 }, (_, i) => `第${i + 1}层-${"很长的文件夹名字".repeat(3)}`).join("/");
  const file = placeImage(shell, root, `${deep}/最终稿.png`);
  expect(file.length).toBeGreaterThan(260);
  await open(shell, root, file);
  await annotateAndCheck(shell, root, file, "长路径里的意见");
});

test("File path relative to the project is very long (notes file name over 255 characters): still written, readable from the command line and the UI", async ({
  shell,
}) => {
  const root = join(shell.temp, "deep");
  const deep = Array.from({ length: 6 }, (_, i) => `level-${i + 1}-${"x".repeat(40)}`).join("/");
  const file = placeImage(shell, root, `${deep}/shot.png`);
  expect(relative(root, file).length).toBeGreaterThan(255);
  await open(shell, root, file);
  const saved = await annotateAndCheck(shell, root, file, "深层文件的意见");
  expect(saved.name.length).toBeLessThanOrEqual(255);
  // The command line that agents use can read it too (Node reading a long path)
  const r = spawnSync(process.execPath, [CLI, "list", "--root", root], { encoding: "utf8" });
  expect(r.stdout + r.stderr).toContain("深层文件的意见");
});

test("Network path (a UNC path such as \\\\localhost\\c$): shown, with the note and snapshot written", async ({ shell }) => {
  const local = join(shell.temp, "unc-project");
  placeImage(shell, local, "assets/net.png");
  const unc = `\\\\localhost\\${local[0].toLowerCase()}$${local.slice(2)}`;
  test.skip(!existsSync(unc), "\\\\localhost\\c$ is not reachable here");
  const file = join(unc, "assets", "net.png");
  await open(shell, unc, file);
  await annotateAndCheck(shell, unc, file, "网络盘上的意见");
});

test("Folder that can't be written to (no write permission): the file shows as usual; saving a note says why it failed and keeps the typed text", async ({
  shell,
}) => {
  const root = join(shell.temp, "readonly");
  const file = placeImage(shell, root, "locked.png");
  const user = `${process.env.USERDOMAIN ?? ""}\\${userInfo().username}`.replace(/^\\/, "");
  // Deny only "create files, create subfolders, delete things inside": the W in icacls includes SYNCHRONIZE, and denying it makes even reading impossible
  const deny = spawnSync("icacls", [root, "/deny", `${user}:(CI)(WD,AD,DC)`], { encoding: "utf8" });
  expect(deny.status, deny.stdout + deny.stderr).toBe(0);
  shell.allowLogErrors();
  try {
    await open(shell, root, file);
    await drawRect(shell, "只读文件夹里的意见");
    // Plain language that names the folder (it used to be the system's original text: on English Windows just "Access to the path … is denied")
    await expect(shell.page.locator(".toast")).toContainText(`保存失败，最近的更改未保存：无法写入「${root}」：没有写入权限`);
    await expect(shell.page.locator(".composer-text")).toHaveValue("只读文件夹里的意见");
    expect(savedFiles(root)).toEqual([]);
  } finally {
    spawnSync("icacls", [root, "/remove:d", user]);
  }
});

test("Additional formats (SVG, TIFF, HEIC, ICO, JFIF, APNG, MKV): all show in the real shell, notes record the original image size and the snapshot is written", async ({
  shell,
}) => {
  test.setTimeout(120_000);
  const root = join(shell.temp, "formats");
  mkdirSync(root);
  const fixtures = fileURLToPath(new URL("../e2e/fixtures/formats/", import.meta.url));
  for (const name of ["icon.svg", "photo.tif", "photo.heic", "rotated.heic", "favicon.ico", "anim.apng", "clip.mkv"]) copyFileSync(join(fixtures, name), join(root, name));
  copyFileSync(join(shell.project, "assets", "poster.jpg"), join(root, "poster.jfif"));
  // Original image size: SVG by its viewBox, TIFF / HEIC after turning upright (rotated.heic is stored landscape with irot)
  const expected: Record<string, [number, number] | undefined> = {
    "icon.svg": [24, 24],
    "photo.tif": [320, 240],
    "photo.heic": [320, 240],
    "rotated.heic": [240, 320],
    "favicon.ico": undefined,
    "anim.apng": [64, 48],
    "poster.jfif": [360, 450],
    "clip.mkv": [320, 180],
  };
  await open(shell, root, join(root, "icon.svg"), { moreFormats: true });
  for (const [name, size] of Object.entries(expected)) {
    if (name !== "icon.svg") await shell.page.locator(".lib-row", { hasText: name }).click();
    await expect(shell.page).toHaveTitle(name);
    // Shown, or (HEIC, when the HEIF / HEVC extension isn't installed where the test runs) says which one is missing
    await expect
      .poll(
        () =>
          shell.page.evaluate(() => {
            if (document.querySelector(".stage [role=alert]")) return "alert";
            const video = document.querySelector<HTMLVideoElement>(".stage video");
            if (video) return video.readyState >= 2 && video.videoWidth > 0 ? "shown" : "";
            return [...document.images].some((i) => i.closest(".stage") && i.complete && i.naturalWidth > 0) ? "shown" : "";
          }),
        { timeout: 30_000, message: `${name} is shown` },
      )
      .toMatch(name.endsWith(".heic") ? /^(shown|alert)$/ : /^shown$/);
    if (await shell.page.locator(".stage [role=alert]").count()) {
      await expect(shell.page.locator(".stage [role=alert]")).toContainText(/HEIF|HEVC/);
      continue;
    }
    const saved = await annotateAndCheck(shell, root, join(root, name), `${name} 的意见`);
    const material = saved.material as { width?: number; height?: number };
    if (size) expect([material.width, material.height], `original size of ${name}`).toEqual(size);
  }
});

test("Huge image (20,000 × 15,000, 300 million pixels): shown; snapshots set to the original size can be saved too (the canvas has a limit, so it is scaled to it)", async ({
  shell,
}) => {
  test.setTimeout(120_000);
  const root = join(shell.temp, "huge");
  mkdirSync(root);
  const file = join(root, "poster-20000x15000.png");
  writeFileSync(file, stripedPng(20_000, 15_000));
  await open(shell, root, file, { snapshotMax: 0 });
  const saved = await annotateAndCheck(shell, root, file, "超大图的意见");
  const shot = join(root, ".sniptoss", ...saved.annotations[0].snapshot!.split("/"));
  expect(readFileSync(shot).length, "the snapshot is not empty").toBeGreaterThan(1000);
});

test("4K video (3840 × 2160, moov at the end of the file): plays; seek near the end and draw a note, the time and snapshot are right", async ({
  shell,
}) => {
  test.setTimeout(120_000);
  const root = join(shell.temp, "video4k");
  const file = join(root, "4k.mp4");
  const made = makeVideo(file, [
    "-f",
    "lavfi",
    "-i",
    "testsrc2=s=3840x2160:r=30:d=20",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-crf",
    "40",
    "-pix_fmt",
    "yuv420p",
  ]);
  test.skip(!made, "no ffmpeg, can't generate the test video");
  await open(shell, root, file);
  expect(await shell.page.evaluate(() => document.querySelector<HTMLVideoElement>(".stage video")!.videoWidth)).toBe(3840);
  await seek(shell, 18.5);
  const saved = await annotateAndCheck(shell, root, file, "4K 最后几秒的意见");
  expect(saved.annotations[0].anchor.time?.start).toBeCloseTo(18.5, 1);
});

test("2-hour video: the duration and the note's time are written as h:mm:ss (1:59:00 used to be written as 119:00.000)", async ({ shell }) => {
  test.setTimeout(120_000);
  const root = join(shell.temp, "longvideo");
  const file = join(root, "2h.mp4");
  const made = makeVideo(file, [
    "-f",
    "lavfi",
    "-i",
    "color=c=0x335577:s=640x360:r=1:d=7200",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-g",
    "30",
    "-pix_fmt",
    "yuv420p",
  ]);
  test.skip(!made, "no ffmpeg, can't generate the test video");
  await open(shell, root, file);
  // Show the hours even below one hour: the width doesn't jump when passing the one-hour mark
  await expect(shell.page.locator(".timecode")).toHaveText("0:00:00.000 / 2:00:00.000");
  await seek(shell, 7140);
  await expect(shell.page.locator(".timecode")).toContainText("1:59:00.000");
  const saved = await annotateAndCheck(shell, root, file, "片尾字幕再快一点");
  expect(saved.annotations[0].anchor.time?.start).toBeCloseTo(7140, 0);
  expect(readFileSync(join(root, ".sniptoss", "REVIEW.md"), "utf8")).toContain("1:59:00.000");
});

test("An open file is deleted (the shell really checks the disk): its notes stay in the notes panel, marked as file not found, and REVIEW.md says so", async ({
  shell,
}) => {
  await shell.launch();
  await shell.page.locator(".lib-row", { hasText: "hero.png" }).click();
  await expect(shell.page).toHaveTitle("hero.png");
  rmSync(join(shell.project, "assets", "hero.png"));
  await expect(shell.page.locator(".group-head.is-missing", { hasText: "hero.png" })).toContainText("找不到素材");
  await expect(shell.page.locator('[data-annot$="|k3f9a2"]')).toBeVisible();
  const review = join(shell.project, ".sniptoss", "REVIEW.md");
  await expect.poll(() => existsSync(review) && readFileSync(review, "utf8")).toContain("未找到该文件");
});

for (const c of [
  { name: "HEVC（H.265）", file: "hevc.mp4", args: ["-c:v", "libx265", "-preset", "ultrafast", "-tag:v", "hvc1"] },
  { name: "ProRes", file: "prores.mov", args: ["-c:v", "prores_ks", "-profile:v", "0"] },
])
  test(`Codec the browser may not play (${c.name}): either it plays, or the canvas says the codec is unsupported, not a black screen`, async ({ shell }) => {
    test.setTimeout(120_000);
    const root = join(shell.temp, "codec");
    const file = join(root, c.file);
    const made = makeVideo(file, [
      "-f",
      "lavfi",
      "-i",
      "testsrc2=s=640x360:r=30:d=3",
      ...c.args,
      "-pix_fmt",
      c.file.endsWith(".mov") ? "yuv422p10le" : "yuv420p",
    ]);
    test.skip(!made, "no ffmpeg (or it was built without this encoder), can't generate the test video");
    shell.setLibrary([root]);
    await shell.launch({ args: [file] });
    await expect(shell.page).toHaveTitle(c.file);
    await expect
      .poll(
        () =>
          shell.page.evaluate(() => {
            const v = document.querySelector<HTMLVideoElement>(".stage video");
            if (v && v.readyState >= 2 && v.videoWidth > 0) return "plays";
            return document.querySelector('.stage [role="alert"]')?.textContent ?? "";
          }),
        { timeout: 20_000 },
      )
      .toMatch(/^plays$|不支持的编码/);
    // Record in the report which of the two it actually is here (HEVC depends on the system HEVC extension and GPU decoding)
    const how = await shell.page.evaluate(() => (document.querySelector('.stage [role="alert"]') ? "says the codec is unsupported" : "plays"));
    test.info().annotations.push({ type: "result", description: how });
  });
