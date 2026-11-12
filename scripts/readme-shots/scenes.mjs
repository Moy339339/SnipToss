// The scenes of the README pictures. Each one starts a test instance with the real app, drives it through the real UI (or, for the capture overlay,
// through the test hooks of the shell-test build), and leaves raw footage in a work folder: PNG stills and PNG frames with their durations (frames.json).
// Turning the footage into the final pictures (stage, headline, window frame, animation encoding) is done elsewhere (design/readme-art).

import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  CLIP,
  NOTES,
  PROJECT,
  PROJECT2,
  PROJECTS,
  Recorder,
  dismissToast,
  drawNote,
  ellipse,
  launch,
  pageShot,
  sleep,
  wait,
} from "./common.mjs";
import { renderClip, renderLanding, renderPoster, renderScreen } from "./sample.mjs";

export const OFF = -20000;
export const FAST = { steps: 10, type: 3, after: 300, between: 120 };
export const SLOW = { steps: 14, type: 16, after: 500, between: 280 };

/** The sample project: two pictures (one carries a note that is already resolved, so the "where notes are stored" toast, which has a full path in it, never appears) and the clip */
export async function prepareProject(work) {
  rmSync(PROJECTS, { recursive: true, force: true });
  mkdirSync(join(PROJECT, "assets"), { recursive: true });
  mkdirSync(join(PROJECT, "video"), { recursive: true });
  const sample = join(work, "sample");
  await renderLanding(sample);
  copyFileSync(join(sample, "hero.png"), join(PROJECT, "assets", "hero.png"));
  copyFileSync(join(sample, "banner.png"), join(PROJECT, "assets", "banner.png"));
  await renderClip(join(PROJECT, "video", CLIP));
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
export function seedResolved(project, file, width, height) {
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
export function freshNotes() {
  rmSync(join(PROJECT, ".sniptoss"), { recursive: true, force: true });
  seedBanner();
}

export const start = (ctx, locale, name, o = {}) =>
  launch(ctx.exe, {
    locale,
    dataDir: join(ctx.tmp, `${name}-${locale}`),
    library: [PROJECT],
    expanded: [join(PROJECT, "assets"), join(PROJECT, "video")],
    ...o,
  });

export const open = async (page, name) => {
  await page.locator(".lib-row", { hasText: name }).click();
  await sleep(1500); // the picture loads and fits the window
};

// Marks on hero.png, as fractions of the picture
export const TITLE = { tool: "r", marks: [{ from: [0.055, 0.235], to: [0.54, 0.44] }] };
export const BUTTON = { tool: "a", marks: [{ from: [0.3, 0.86], to: [0.2, 0.735] }] };
const WATERMARK = { tool: "c", marks: [{ from: [0.885, 0.17] }], category: 2 };
// The two grapefruit slices: one note, two places (the lower one first: the note box opens below it and would cover it)
const HIGHLIGHTS = {
  tool: "b",
  marks: [{ points: ellipse(0.866, 0.65, 0.105, 0.155) }, { points: ellipse(0.603, 0.27, 0.085, 0.135) }],
  category: 1,
};

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
    // With nothing checked, Copy as Images takes every open note: the three notes of this picture come out as one image
    await sleep(1500);
    await page.locator(".card").first().click();
    await page.keyboard.press("Control+Shift+I");
    await sleep(2500);
    await ask("debugClipboardPng", { path: join(dir, "copied-all.png") }).catch((e) => console.log(`No image for all notes: ${e.message}`));
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
    await open(page, CLIP);
    await page.locator("video").waitFor();
    await sleep(800);
    // The time in the playback bar as frame numbers (a click goes from seconds to timecode, another to frames)
    for (let i = 0; i < 2; i++) {
      await page.locator(".transport .timecode").click();
      await sleep(400);
    }
    await page.locator(".lib-row", { hasText: CLIP }).click();
    await page.mouse.move(700, 420);
    await sleep(600);
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
    await page.locator(".lib-row", { hasText: CLIP }).click();
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
    // Jump to 7.5 s (the ride downhill) by clicking the track, and mark the foot
    const track = await page.locator(".track").boundingBox();
    await page.mouse.click(track.x + track.width * 0.375, track.y + track.height / 2, { delay: 60 });
    await sleep(700);
    await drawNote(page, { tool: "r", target: "video", marks: [{ from: [0.28, 0.61], to: [0.44, 0.83] }], text: n.steam, pace: SLOW });
    await page.keyboard.press("v");
    await sleep(500);
    await page.mouse.move(10, 790);
    await sleep(1200);
    await rec.stop(3000);
  } finally {
    await inst.close();
  }
}

/** Scene 4: the capture overlay over a picture of a screen (a chat with a long answer; each of its questions gets a reply), drawn to PNG through the test hooks (the fake monitor sits off screen, nothing real is captured) */
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

    // Pull out a region around the answer (pointer positions are in the overlay's own coordinates)
    const { reply, questions } = JSON.parse(readFileSync(join(ctx.work, "sample", "screen.png.json"), "utf8"));
    const lerp = (p, q, steps) =>
      Array.from({ length: steps }, (_, i) =>
        [p[0] + ((q[0] - p[0]) * (i + 1)) / steps, p[1] + ((q[1] - p[1]) * (i + 1)) / steps].map(Math.round),
      );
    const from = [reply.x - 30, reply.y - 44];
    const to = [reply.x + reply.width + 30, reply.y + reply.height + 24];
    await snap(1100, [{ op: "move", x: from[0], y: from[1] }]);
    await run([{ op: "down", x: from[0], y: from[1] }]);
    const way = lerp(from, to, 5);
    for (const [i, [x, y]] of way.entries()) await snap(i === way.length - 1 ? 700 : 90, [{ op: "move", x, y }]);
    await snap(900, [{ op: "up" }]);
    // A rectangle on each of the three questions, with the reply to it
    const replies = [n.reply1, n.reply2, n.reply3].map((t, i) => t ?? NOTES.en[`reply${i + 1}`]);
    for (const [i, q] of questions.entries()) {
      const p = [q.x + 3, q.y + 3];
      const r = [q.x + q.width - 3, q.y + q.height - 3];
      await run([
        { op: "key", key: "R" },
        { op: "move", x: p[0], y: p[1] },
        { op: "down", x: p[0], y: p[1] },
      ]);
      const path = lerp(p, r, 3);
      for (const [k, [x, y]] of path.entries()) await snap(k === path.length - 1 ? 500 : 90, [{ op: "move", x, y }]);
      await run([{ op: "up" }]);
      await snap(800);
      await snap(1400, [{ op: "type", text: replies[i] }]);
      await run([{ op: "key", key: "Enter" }]);
      await snap(i === questions.length - 1 ? 1300 : 800);
    }
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
