// Item formats: SVG (sized as written and drawn enlarged), TIFF / HEIC converted to PNG by the shell
// (with instructions when a system extension is missing), MKV.
// The test files are in fixtures/formats (not kept in the test project because other tests count the items in it);
// the ones needed are copied into this test's project

import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type App } from "./harness";

const FORMATS = fileURLToPath(new URL("./fixtures/formats/", import.meta.url));

/**
 * Puts these test files into the project's formats folder and selects the first one on open.
 * These tests are about the formats themselves: More formats is on
 */
function put(app: App, ...names: string[]) {
  const dir = join(app.project, "formats");
  mkdirSync(dir, { recursive: true });
  for (const n of names) copyFileSync(join(FORMATS, n), join(dir, n));
  app.host.expanded = [dir];
  app.host.selected = join(dir, names[0]);
  app.host.prefs = { ...app.host.prefs, moreFormats: true };
}

type NotesFile = { material: { width?: number; height?: number }; annotations: { body: string; snapshot?: string }[] };
/** A new item's notes file; empty until the first save reaches disk (expect.poll does not retry a callback that throws) */
const notes = (app: App, file: string): NotesFile => {
  const path = join(app.project, ".sniptoss", "annotations", file);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as NotesFile) : { material: {}, annotations: [] };
};
const media = (app: App) => app.media();
const at = (box: { x: number; y: number; width: number; height: number }, fx: number, fy: number) =>
  [box.x + box.width * fx, box.y + box.height * fy] as const;

/** Draws a box, types text, saves, and returns the saved note */
async function rectNote(app: App, file: string, body: string) {
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("r");
  const box = await media(app);
  await app.page.mouse.move(...at(box, 0.25, 0.25));
  await app.page.mouse.down();
  await app.page.mouse.move(...at(box, 0.5, 0.5), { steps: 6 });
  await app.page.mouse.up();
  await app.page.locator(".composer-text").fill(body);
  await app.page.locator(".composer-text").press("Enter");
  await expect(app.page.locator(".composer")).toHaveCount(0);
  await expect.poll(() => notes(app, file).annotations.some((a) => a.body === body && a.snapshot)).toBe(true);
  return { file: notes(app, file), note: notes(app, file).annotations.find((a) => a.body === body)! };
}

/** The color of one point in a snapshot (the PNG is decoded in the page) */
async function pixel(app: App, png: string, x: number, y: number) {
  const data = readFileSync(join(app.project, ".sniptoss", png)).toString("base64");
  return app.page.evaluate(
    async (q) => {
      const img = new Image();
      img.src = `data:image/png;base64,${q.data}`;
      await img.decode();
      const c = document.createElement("canvas");
      [c.width, c.height] = [img.naturalWidth, img.naturalHeight];
      const g = c.getContext("2d")!;
      g.drawImage(img, 0, 0);
      return [...g.getImageData(q.x, q.y, 1, 1).data];
    },
    { data, x, y },
  );
}

test("An SVG with only a viewBox is sized by the viewBox (24×24) but drawn enlarged on a checkerboard; 100% is one-to-one with the original and the snapshot renders with the checkerboard", async ({ app }) => {
  put(app, "icon.svg");
  await app.open();
  await expect(app.page).toHaveTitle("icon.svg");
  await expect(app.page.locator(".zoom-media")).toHaveClass(/is-transparent/);
  await expect(app.page.locator(".stage-header")).toContainText("24×24");
  // Drawn enlarged: the layout size in the canvas area is 2048 square (not 24 square scaled up afterwards, which would be blurry)
  const layout = await app.page.locator(".zoom-media").evaluate((el: HTMLElement) => [el.offsetWidth, el.offsetHeight]);
  expect(layout).toEqual([2048, 2048]);
  // The zoom percentage refers to the original: at 100% it is 24 pixels on screen
  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("Shift+0");
  await expect(app.page.locator(".zoom-label")).toContainText("100%");
  await expect.poll(async () => Math.round((await media(app)).width)).toBe(24);
  await app.page.keyboard.press("Shift+1");

  const { file, note } = await rectNote(app, "formats__icon.svg.json", "图标线条加粗");
  expect(file.material).toMatchObject({ width: 24, height: 24 });
  // The snapshot is scaled from the drawn size to the longest edge in Settings (1600 by default);
  // transparent areas get a checkerboard (cell size 1600 / 64 = 25).
  // Inside the box (snapshot 400–800) nothing is dimmed: cell 18 in row 18 is gray and cell 19 is white
  const head = readFileSync(join(app.project, ".sniptoss", note.snapshot!));
  expect([head.readUInt32BE(16), head.readUInt32BE(20)]).toEqual([1600, 1600]);
  expect((await pixel(app, note.snapshot!, 18 * 25 + 2, 18 * 25 + 2)).slice(0, 3)).toEqual([220, 220, 220]);
  expect((await pixel(app, note.snapshot!, 19 * 25 + 2, 18 * 25 + 2)).slice(0, 3)).toEqual([255, 255, 255]);
  await expect.poll(() => app.review()).toContain("24×24");
});

test("An SVG with a width and height is sized as written (400×200)", async ({ app }) => {
  put(app, "banner.svg");
  await app.open();
  await expect(app.page).toHaveTitle("banner.svg");
  await expect(app.page.locator(".stage-header")).toContainText("400×200");
  const { file } = await rectNote(app, "formats__banner.svg.json", "圆往右挪");
  expect(file.material).toMatchObject({ width: 400, height: 200 });
});

test("A TIFF is converted to PNG by the shell before display, notes are written as usual and sized by the original image", async ({ app }) => {
  put(app, "photo.tif");
  await app.open();
  await expect(app.page).toHaveTitle("photo.tif");
  await expect(app.page.locator(".zoom-media")).toHaveAttribute("src", /photo\.tif\.png/);
  expect(app.host.calls.filter((c) => c.method === "decodeImage")).toHaveLength(1);
  await expect(app.page.locator(".stage-header")).toContainText("320×240");
  // An opaque image gets no checkerboard
  await expect(app.page.locator(".zoom-media")).not.toHaveClass(/is-transparent/);
  const { file } = await rectNote(app, "formats__photo.tif.json", "左下角太红");
  expect(file.material).toMatchObject({ width: 320, height: 240 });
});

test("HEIC without the HEIF Image Extensions: the canvas says what is missing, the button opens the Microsoft Store, and the drawing tools are grayed out", async ({ app }) => {
  app.host.decodeProblem = "heif";
  put(app, "photo.heic");
  await app.open();
  await expect(app.page).toHaveTitle("photo.heic");
  const alert = app.page.getByRole("alert");
  await expect(alert).toContainText("无法打开这张图片");
  await expect(alert).toContainText("HEIF 图像扩展");
  await alert.getByRole("button", { name: "获取 HEIF 图像扩展" }).click();
  await expect.poll(() => app.host.opened).toEqual(["https://apps.microsoft.com/detail/9pmmsr1cgpwg"]);
  await expect(alert.getByRole("button", { name: "在资源管理器中显示" })).toBeVisible();
  await expect(app.page.locator(`.hdr-tools .tool-btn[aria-label="矩形"]`)).toBeDisabled();
});

test("A HEIC that is recognized but cannot be decoded says the HEVC Video Extensions are also needed (or the file may be damaged), and the button goes to their page", async ({ app }) => {
  app.host.decodeProblem = "hevc";
  put(app, "photo.heic");
  await app.open();
  const alert = app.page.getByRole("alert");
  await expect(alert).toContainText("HEVC 视频扩展");
  await expect(alert).toContainText("文件可能已损坏");
  await alert.getByRole("button", { name: "获取 HEVC 视频扩展" }).click();
  await expect.poll(() => app.host.opened).toEqual(["https://apps.microsoft.com/detail/9nmzlz57r3t7"]);
});

test("An MKV is listed and plays (when the frame rate cannot be read it is estimated during playback)", async ({ app }) => {
  put(app, "clip.mkv");
  await app.open();
  await expect(app.page).toHaveTitle("clip.mkv");
  await expect.poll(() => app.page.locator("video").evaluate((v: HTMLVideoElement) => [v.videoWidth, v.videoHeight])).toEqual([320, 180]);
  await expect(app.page.locator(".stage-header")).toContainText("320×180");
});

test("The newly recognized formats are all listed; unsupported ones such as PSD are still only counted at the end of the folder", async ({ app }) => {
  put(app, "icon.svg", "banner.svg", "photo.tif", "photo.heic", "clip.mkv");
  copyFileSync(join(FORMATS, "icon.svg"), join(app.project, "formats", "draft.psd"));
  await app.open();
  for (const name of ["icon.svg", "banner.svg", "photo.tif", "photo.heic", "clip.mkv"])
    await expect(app.page.locator(".lib-row", { hasText: name })).toHaveCount(1);
  await expect(app.page.locator(".lib-row", { hasText: "draft.psd" })).toHaveCount(0);
  await expect(app.page.locator(".lib-note")).toContainText("另有 1 个文件暂不支持：psd");
});

test("More formats is off by default: the folder leaves out TIFF, HEIC and MKV and says how to show them; turning it on in Settings lists them, off hides them again", async ({
  app,
}) => {
  put(app, "icon.svg", "photo.tif", "photo.heic", "clip.mkv");
  app.host.prefs = { ...app.host.prefs, moreFormats: false };
  await app.open();
  const row = (name: string) => app.page.locator(".lib-row", { hasText: name });
  await expect(row("icon.svg")).toHaveCount(1);
  for (const name of ["photo.tif", "photo.heic", "clip.mkv"]) await expect(row(name)).toHaveCount(0);
  const note = app.page.locator(".lib-note span", { hasText: "更多格式" });
  await expect(note).toHaveText("另有 3 个文件需开启「更多格式」：heic、mkv、tif");
  await expect(note).toHaveAttribute("title", "可在「设置 → 高级 → 更多格式」中开启");

  await app.page.locator(".stage").click({ position: { x: 5, y: 5 } });
  await app.page.keyboard.press("Control+,");
  await app.page.locator(".settings-tab", { hasText: "高级" }).click();
  const more = app.page.locator(".set-row", { hasText: "更多格式" });
  await expect(more).toContainText("tiff heic ico apng jfif mkv");
  await expect(app.page.locator(".set-row", { hasText: "png jpg webp gif svg bmp avif" })).toHaveCount(1);
  await more.getByRole("switch").click();
  for (const name of ["photo.tif", "photo.heic", "clip.mkv"]) await expect(row(name)).toHaveCount(1);
  await expect(app.page.locator(".lib-note")).toHaveCount(0);
  await expect.poll(() => app.host.prefs?.moreFormats).toBe(true);

  await more.getByRole("switch").click();
  await expect(row("photo.tif")).toHaveCount(0);
  await expect(note).toBeVisible();
  // Back to the default: not written into the settings file
  await expect.poll(() => app.host.prefs?.moreFormats).toBeUndefined();
});

test("More formats off: a TIFF added on its own is still listed and annotatable", async ({ app }) => {
  const dir = join(app.temp, "loose");
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(FORMATS, "photo.tif"), join(dir, "photo.tif"));
  app.host.entries.push({ path: join(dir, "photo.tif"), pinned: false });
  app.host.selected = join(dir, "photo.tif");
  await app.open();
  await expect(app.page).toHaveTitle("photo.tif");
  await expect(app.page.locator(".zoom-media")).toHaveAttribute("src", /photo\.tif\.png/);
});
