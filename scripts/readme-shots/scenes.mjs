// The scenes of the README pictures. Each one starts a test instance with the real app, drives it through the real UI (or, for the capture overlay,
// through the test hooks of the shell-test build), and leaves raw footage in a work folder: PNG stills and PNG frames with their durations (frames.json).
// Turning the footage into the final pictures (stage, headline, window frame, animation encoding) is done elsewhere (design/readme-art).

import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { NOTES, PROJECT, PROJECT2, PROJECTS, Recorder, dismissToast, drawNote, ellipse, launch, pageShot, sleep, wait } from "./common.mjs";
import { renderClip, renderLanding, renderPoster, renderScreen } from "./sample.mjs";

const OFF = -20000;
const FAST = { steps: 10, type: 3, after: 300, between: 120 };
const SLOW = { steps: 14, type: 16, after: 500, between: 280 };

/** The sample project: two pictures (one carries a note that is already resolved, so the "where notes are stored" toast, which has a full path in it, never appears) and the clip */
export async function prepareProject(work) {
  rmSync(PROJECTS, { recursive: true, force: true });
  mkdirSync(join(PROJECT, "assets"), { recursive: true });
  mkdirSync(join(PROJECT, "video"), { recursive: true });
  const sample = join(work, "sample");
  await renderLanding(sample);
  copyFileSync(join(sample, "hero.png"), join(PROJECT, "assets", "hero.png"));
  copyFileSync(join(sample, "banner.png"), join(PROJECT, "assets", "banner.png"));
  await renderClip(join(PROJECT, "video", "pour.mp4"));
  await renderScreen(join(sample, "screen.png"));
  seedBanner();
  // The second sample project: an event poster and a wide flyer (the poster carries the resolved note, the flyer is the one that gets annotated)
  mkdirSync(join(PROJECT2, "assets"), { recursive: true });
  await renderPoster(sample);
  copyFileSync(join(sample, "poster.png"), join(PROJECT2, "assets", "poster.png"));
  copyFileSync(join(sample, "flyer.png"), join(PROJECT2, "assets", "flyer.png"));
  seedResolved(PROJECT2, "poster.png", 1200, 1500);
}

const seedBanner = () => seedResolved(PROJECT, "banner.png", 1600, 500);

/** A project with one resolved note on one of its pictures: with a note already there, the toast that says where notes are stored (with the full path) never appears */
function seedResolved(project, file, width, height) {
  const sha = createHash("sha256")
    .update(readFileSync(join(project, "assets", file)))
    .digest("hex");
  mkdirSync(join(project, ".sniptoss", "annotations"), { recursive: true });
  const at = "2026-10-20T02:00:00Z";
  writeFileSync(
    join(project, ".sniptoss", "annotations", `assets__${file}.json`),
    JSON.stringify(
      {
        schema: "sniptoss/5",
        material: { path: `assets/${file}`, kind: "image", sha256: sha, width, height },
        annotations: [
          {
            id: "b4nn3r",
            status: "resolved",
            category: "change",
            body: "Make the headline bold.",
            anchor: {},
            author: "user",
            created_at: at,
            updated_at: at,
            replies: [],
          },
        ],
      },
      null,
      2,
    ) + "\n",
  );
}

/** Every scene starts from the same state: only the resolved note on the banner */
function freshNotes() {
  rmSync(join(PROJECT, ".sniptoss"), { recursive: true, force: true });
  seedBanner();
}

const start = (ctx, locale, name, o = {}) =>
  launch(ctx.exe, {
    locale,
    dataDir: join(ctx.tmp, `${name}-${locale}`),
    library: [PROJECT],
    expanded: [join(PROJECT, "assets"), join(PROJECT, "video")],
    ...o,
  });

const open = async (page, name) => {
  await page.locator(".lib-row", { hasText: name }).click();
  await sleep(1500); // the picture loads and fits the window
};

// Marks on hero.png, as fractions of the picture
const TITLE = { tool: "r", marks: [{ from: [0.055, 0.235], to: [0.54, 0.44] }] };
const BUTTON = { tool: "a", marks: [{ from: [0.36, 0.8], to: [0.25, 0.68] }] };
const WATERMARK = { tool: "c", marks: [{ from: [0.88, 0.17] }], category: 2 };
// The coffee stream: one note, two places (the stream and the glass it falls into)
const HIGHLIGHTS = { tool: "b", marks: [{ points: ellipse(0.775, 0.4, 0.04, 0.2) }, { points: ellipse(0.75, 0.66, 0.1, 0.085) }] };

async function threeNotes(page, locale, pace) {
  const n = NOTES[locale === "zh-CN" ? "zh-CN" : "en"];
  await drawNote(page, { ...TITLE, text: n.title, pace });
  await drawNote(page, { ...BUTTON, text: n.button, pace });
  await drawNote(page, { ...WATERMARK, text: n.mark, pace });
  await dismissToast(page);
}

/** Scene 0: the main window with a different sample (the poster), so a picture of the whole window doesn't repeat the content of the feature pictures */
export async function hero(ctx, locale) {
  const dir = join(ctx.work, locale, "hero");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  rmSync(join(PROJECT2, ".sniptoss"), { recursive: true, force: true });
  seedResolved(PROJECT2, "poster.png", 1200, 1500);
  const inst = await launch(ctx.exe, {
    locale,
    dataDir: join(ctx.tmp, `hero-${locale}`),
    library: [PROJECT2],
    expanded: [join(PROJECT2, "assets")],
  });
  try {
    const { page } = inst;
    await open(page, "flyer.png");
    const n = NOTES[locale];
    await drawNote(page, { tool: "r", marks: [{ from: [0.14, 0.05], to: [0.86, 0.22] }], text: n.posterTitle, pace: FAST });
    await drawNote(page, { tool: "a", marks: [{ from: [0.72, 0.68], to: [0.62, 0.86] }], text: n.posterDate, pace: FAST });
    await drawNote(page, { tool: "c", marks: [{ from: [0.85, 0.9] }], category: 3, text: n.posterPin, pace: FAST });
    await dismissToast(page);
    await page.keyboard.press("v");
    await page.locator("[data-annot]").first().click();
    await page.mouse.move(10, 790);
    await sleep(900);
    await pageShot(page, join(dir, "main.png"), 2);
  } finally {
    await inst.close();
  }
}

/** Scene 1: the four tools and one note on several places, recorded as frames (the first three notes are the ones the stills use) */
export async function marking(ctx, locale) {
  const dir = join(ctx.work, locale, "marking");
  freshNotes();
  const inst = await start(ctx, locale, "marking");
  try {
    const { page } = inst;
    await open(page, "hero.png");
    await page.mouse.move(700, 420);
    const rec = new Recorder(page, dir);
    await rec.start();
    await sleep(900);
    const n = NOTES[locale];
    await drawNote(page, { ...TITLE, text: n.title, pace: SLOW });
    await drawNote(page, { ...BUTTON, text: n.button, pace: SLOW });
    await drawNote(page, { ...WATERMARK, text: n.mark, pace: SLOW });
    await drawNote(page, { ...HIGHLIGHTS, text: n.pen, pace: SLOW });
    await dismissToast(page);
    await page.keyboard.press("v");
    await page.locator("[data-annot]").first().click();
    await page.mouse.move(10, 790);
    await sleep(900);
    await rec.stop(3000);
  } finally {
    await inst.close();
  }
}

/** Scene 2: the stills of the main window (2× crisp), the REVIEW.md the app wrote, and the three images "Copy as Images" makes */
export async function stills(ctx, locale) {
  const dir = join(ctx.work, locale, "stills");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  freshNotes();
  const inst = await start(ctx, locale, "stills");
  try {
    const { page, ask } = inst;
    await open(page, "hero.png");
    await threeNotes(page, locale, FAST);
    await page.keyboard.press("v");
    await page.locator("[data-annot]").first().click();
    await page.mouse.move(10, 790);
    await sleep(900);
    await pageShot(page, join(dir, "main.png"), 2);
    // The annotated picture itself (marks and numbers included) and each note card, as the app draws them
    await pageShot(page, join(dir, "canvas.png"), 2, await page.locator("img.zoom-media").boundingBox());
    for (let i = 0; i < 3; i++) await pageShot(page, join(dir, `card-${i + 1}.png`), 2, await page.locator(".card").nth(i).boundingBox());

    const review = join(PROJECT, ".sniptoss", "REVIEW.md");
    await wait(
      "REVIEW.md with the three notes",
      () => existsSync(review) && (readFileSync(review, "utf8").match(/^### \[/gm) ?? []).length >= 3,
    );
    copyFileSync(review, join(dir, "REVIEW.md"));
    cpSync(join(PROJECT, ".sniptoss", "snapshots"), join(dir, "snapshots"), { recursive: true });

    // "Copy as Images" with one note checked puts one image on the clipboard (several are put as files); the shell-test build records it instead of touching the clipboard
    await ask("debugCaptureFake", { monitors: [] });
    for (let i = 0; i < 3; i++) {
      await page.locator(".card").nth(i).click();
      await page.keyboard.press("x");
      await page.keyboard.press("Control+Shift+I");
      const file = join(dir, `copied-${i + 1}.png`);
      await wait(
        `the image of note ${i + 1}`,
        () =>
          ask("debugClipboardPng", { path: file }).then(
            () => true,
            () => false,
          ),
        10_000,
      );
      await page.keyboard.press("x");
    }
    console.log(`Stills: ${dir}`);
  } finally {
    await inst.close();
  }
}

/** Scene 3: a video — a note on one moment, stepping frames, a mark on another moment */
export async function video(ctx, locale) {
  const dir = join(ctx.work, locale, "video");
  freshNotes();
  const inst = await start(ctx, locale, "video");
  try {
    const { page } = inst;
    await open(page, "pour.mp4");
    await page.locator("video").waitFor();
    await sleep(800);
    const rec = new Recorder(page, dir);
    await rec.start();
    await sleep(900);
    const n = NOTES[locale];
    // Play for a moment, then step to 2.29 s: Shift+→ is one second, → one frame
    await page.keyboard.press("Space");
    await sleep(1200);
    await page.keyboard.press("Space");
    // Back to the start: click the left end of the track (Home would move the library's cursor), then give the keyboard back to the library row
    const rail = await page.locator(".track").boundingBox();
    await page.mouse.click(rail.x + 1, rail.y + rail.height / 2, { delay: 60 });
    await sleep(500);
    await page.locator(".lib-row", { hasText: "pour.mp4" }).click();
    await sleep(300);
    for (let i = 0; i < 2; i++) {
      await page.keyboard.press("Shift+ArrowRight");
      await sleep(350);
    }
    for (let i = 0; i < 7; i++) {
      await page.keyboard.press("ArrowRight");
      await sleep(110);
    }
    await sleep(500);
    // A comment on this moment (no position)
    await page.keyboard.press("t");
    await page.locator(".composer-text").waitFor({ timeout: 8000 });
    await page.locator(".composer-text").pressSequentially(n.late, { delay: 16 });
    await sleep(300);
    await page.keyboard.press("Enter");
    await sleep(900);
    // Jump to about 4.2 s by clicking the track, and mark the steam
    const track = await page.locator(".track").boundingBox();
    await page.mouse.click(track.x + track.width * 0.7, track.y + track.height / 2, { delay: 60 });
    await sleep(700);
    await drawNote(page, { tool: "r", target: "video", marks: [{ from: [0.62, 0.42], to: [0.9, 0.86] }], text: n.steam, pace: SLOW });
    await page.keyboard.press("v");
    await sleep(500);
    await page.mouse.move(10, 790);
    await sleep(1200);
    await rec.stop(3000);
  } finally {
    await inst.close();
  }
}

/** Scene 4: the capture overlay over a picture of a screen, drawn to PNG through the test hooks (the fake monitor sits off screen, nothing real is captured) */
export async function capture(ctx, locale) {
  const dir = join(ctx.work, locale, "capture");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const inst = await start(ctx, locale, "capture");
  try {
    const { ask } = inst;
    const n = NOTES[locale];
    const frames = [];
    const run = async (ops) => (await ask("debugCaptureDo", { monitor: 0, ops })).state.overlays[0];
    const snap = async (ms, ops = []) => {
      const file = `f${String(frames.length).padStart(3, "0")}.png`;
      await run([...ops, { op: "shot", path: join(dir, file) }]);
      frames.push({ file, ms });
    };
    // A 1280 × 720 screen at 100% (the overlay is drawn to PNG at 1×; the test hook's picture of the layer is not right on a scaled monitor)
    await ask("debugCaptureFake", {
      monitors: [{ x: OFF, y: OFF, width: 1280, height: 720, scale: 1, image: join(ctx.work, "sample", "screen.png") }],
      windows: [],
      cursor: null,
    });
    await ask("debugHotkey");
    await wait("the capture overlay", async () => (await ask("debugCaptureState")).open);

    // Pull out a region (pointer positions are in the overlay's own coordinates)
    await snap(1100, [{ op: "move", x: 40, y: 90 }]);
    await run([{ op: "down", x: 40, y: 90 }]);
    for (const [x, y, ms] of [
      [250, 200, 90],
      [520, 340, 90],
      [760, 470, 90],
      [900, 590, 700],
    ])
      await snap(ms, [{ op: "move", x, y }]);
    await snap(900, [{ op: "up" }]);
    // A rectangle on the headline, with a note
    await run([
      { op: "key", key: "R" },
      { op: "move", x: 70, y: 196 },
      { op: "down", x: 70, y: 196 },
    ]);
    for (const [x, y, ms] of [
      [300, 260, 90],
      [690, 355, 500],
    ])
      await snap(ms, [{ op: "move", x, y }]);
    await run([{ op: "up" }]);
    await snap(900);
    await snap(1500, [{ op: "type", text: n.screen }]);
    await run([{ op: "key", key: "Enter" }]);
    await snap(900);
    // An arrow at the button, with a note
    await run([
      { op: "key", key: "A" },
      { op: "move", x: 430, y: 470 },
      { op: "down", x: 430, y: 470 },
    ]);
    for (const [x, y, ms] of [
      [350, 500, 90],
      [262, 528, 500],
    ])
      await snap(ms, [{ op: "move", x, y }]);
    await run([{ op: "up" }]);
    await snap(900);
    await snap(1400, [{ op: "type", text: n.screenButton }]);
    await run([{ op: "key", key: "Enter" }]);
    await snap(1100);
    // Finish: the image with the notes under it goes to the clipboard and a toast says so
    await run([{ op: "key", key: "Enter" }]);
    await sleep(500);
    await ask("debugWindowShot", { which: "toast", path: join(dir, "toast.png") });
    const done = await ask("debugCaptureResult", {});
    copyFileSync(done.saved, join(dir, "result.png"));
    writeFileSync(join(dir, "frames.json"), JSON.stringify(frames));
    console.log(`Capture: ${frames.length} frames in ${dir}`);
  } finally {
    await inst.close();
  }
}

/** Scene 5: the main window in every interface language, 2× crisp (the notes stay in English, the language of whoever wrote them) */
export async function languages(ctx) {
  const dir = join(ctx.work, "languages");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const locales = readdirSync(join(ctx.root, "i18n", "locales"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.replace(/\.json$/, ""));
  for (const locale of locales) {
    freshNotes();
    const inst = await start(ctx, locale, "languages");
    try {
      const { page } = inst;
      await open(page, "hero.png");
      await threeNotes(page, locale === "zh-CN" ? "zh-CN" : "en", FAST);
      await page.keyboard.press("v");
      await page.locator("[data-annot]").first().click();
      await page.mouse.move(10, 790);
      await sleep(800);
      await pageShot(page, join(dir, `${locale}.png`), 2);
    } finally {
      await inst.close();
    }
  }
}
