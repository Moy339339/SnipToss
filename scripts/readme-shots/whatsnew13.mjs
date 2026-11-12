// The scenes of the 1.3 "what's new" pictures: frame numbers, note numbers on the playback bar, drawings (marks left without a note),
// and drawings on the capture overlay. Like the 1.1 scenes (whatsnew.mjs) they drive the real UI over CDP (the capture overlay through
// the test hooks of the shell-test build) and leave raw footage: frames + frames.json per scene, and one 2× still per scene for the
// overview picture in <work>/<locale>/whatsnew13.
//
// The first frame of each animation already shows the feature (a browser that doesn't play animations only shows that frame):
// each recording leads with a finished frame from later in the same recording.

import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLIP, NOTES, Recorder, dismissToast, drawNote, ellipse, sleep, stroke, wait } from "./common.mjs";
import { FAST, OFF, TITLE, freshNotes, open, start } from "./scenes.mjs";

function stillsDir(ctx, locale) {
  const dir = join(ctx.work, locale, "whatsnew13");
  mkdirSync(dir, { recursive: true });
  return dir;
}

const center = async (target) => {
  const b = await target.boundingBox();
  return [b.x + b.width / 2, b.y + b.height / 2];
};

/** Moves the pointer onto a target (a locator or a point) and rests there: tooltips show after 350 ms */
async function hover(page, target, rest = 700) {
  const [x, y] = Array.isArray(target) ? target : await center(target);
  await page.mouse.move(x, y, { steps: 6 });
  await sleep(rest);
  return [x, y];
}

/** A drag spread over ms, so the recorder (about 15 frames per second) catches the movement */
async function slowDrag(page, from, to, ms = 700, n = 16) {
  await page.mouse.move(...from);
  await page.mouse.down();
  for (let i = 1; i <= n; i++) {
    await page.mouse.move(from[0] + ((to[0] - from[0]) * i) / n, from[1] + ((to[1] - from[1]) * i) / n);
    await sleep(ms / n);
  }
  await page.mouse.up();
}

/** A point on the picture, as fractions of it */
async function onImage(page, fx, fy) {
  const b = await page.locator("img.zoom-media").boundingBox();
  return [b.x + b.width * fx, b.y + b.height * fy];
}

/** Puts a frame from later in the recording first, held for ms (frames.json is rewritten) */
function leadWith(dir, file, ms) {
  const path = join(dir, "frames.json");
  const shots = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify([{ file, ms }, ...shots]));
}

/** The pointer rests in a corner of the window, over nothing that reacts to it */
const rest = (page) => page.mouse.move(10, 790);

const focusStage = (page) => page.locator(".stage").click({ position: { x: 4, y: 4 } });

/** Before a recording starts: moves the clip to a moment (the recorded part only uses the real controls) */
async function seek(page, seconds) {
  await page.evaluate((t) => {
    document.querySelector("video").currentTime = t;
  }, seconds);
  await sleep(350);
}

/** A comment on the current moment (no position), written fast: for the notes that are already there when a recording starts */
async function timedNote(page, text) {
  await focusStage(page);
  await page.keyboard.press("t");
  await page.locator(".composer-text").waitFor({ timeout: 8000 });
  await page.locator(".composer-text").pressSequentially(text, { delay: 3 });
  await page.keyboard.press("Enter");
  await page.locator(".composer").waitFor({ state: "detached" });
  await sleep(250);
}

async function openClip(page) {
  await open(page, CLIP);
  await page.locator("video").waitFor();
  await wait("the clip", () => page.evaluate(() => (document.querySelector("video")?.readyState ?? 0) >= 2));
  await sleep(600);
}

/**
 * Frame numbers: a click on the time in the playback bar goes from seconds to timecode to frame numbers; → steps one frame;
 * a comment on that frame shows the frame number in its box and on its card
 */
export async function frames(ctx, locale) {
  const dir = join(ctx.work, locale, "frames");
  freshNotes();
  const inst = await start(ctx, locale, "frames");
  try {
    const { page } = inst;
    const n = NOTES[locale];
    await openClip(page);
    await seek(page, 1);
    await timedNote(page, n.late);
    await dismissToast(page);
    await seek(page, 2);
    await rest(page);

    const rec = new Recorder(page, dir);
    await rec.start();
    await sleep(900);
    const readout = page.locator(".transport .timecode");
    await hover(page, readout, 1300); // its tooltip says what a click does, and the frame rate
    await page.mouse.click(...(await center(readout)), { delay: 60 });
    await sleep(1500);
    await page.mouse.click(...(await center(readout)), { delay: 60 });
    await sleep(1500);
    await focusStage(page);
    await rest(page);
    for (let i = 0; i < 5; i++) {
      await page.keyboard.press("ArrowRight");
      await sleep(260);
    }
    await sleep(500);
    await page.keyboard.press("t");
    await page.locator(".composer-text").waitFor({ timeout: 8000 });
    await page.locator(".composer-text").pressSequentially(n.flicker, { delay: 30 });
    await sleep(900);
    const finished = rec.frames.length + 1; // frame numbers in the bar and in the note box: the first frame of the picture
    await sleep(300);
    await page.keyboard.press("Enter");
    await sleep(1800);
    const shots = await rec.stop(1500);
    leadWith(dir, shots[finished].file, 1300);
    copyFileSync(join(dir, shots[finished].file), join(stillsDir(ctx, locale), "frames.jpg"));
  } finally {
    await inst.close();
  }
}

/**
 * Note numbers on the playback bar: each note's number stands where the note starts; a click goes to the note; three notes close
 * together are one stack, and a click on it lists them
 */
export async function badges(ctx, locale) {
  const dir = join(ctx.work, locale, "badges");
  freshNotes();
  const inst = await start(ctx, locale, "badges");
  try {
    const { page } = inst;
    const n = NOTES[locale];
    await openClip(page);
    await seek(page, 0.8);
    await timedNote(page, n.late);
    await dismissToast(page);
    await seek(page, 2.2);
    await drawNote(page, { tool: "r", target: "video", marks: [{ from: [0.62, 0.42], to: [0.9, 0.86] }], text: n.steam, pace: FAST });
    await page.keyboard.press("v");
    for (const [t, text] of [
      [3.9, n.flicker],
      [4.02, n.cut],
      [4.14, n.grade],
      [5.3, n.logo],
    ]) {
      await seek(page, t);
      await timedNote(page, text);
    }
    await seek(page, 0);
    await focusStage(page);
    await rest(page);
    const stack = page.locator(".track-stack");
    if ((await stack.count()) !== 1) throw new Error(`Expected one stack on the playback bar, found ${await stack.count()}`);

    const rec = new Recorder(page, dir);
    await rec.start();
    await sleep(1100);
    // The first number: its tooltip is the note, a click goes there
    const first = page.locator(".track-badge").first();
    await hover(page, first, 1300);
    await page.mouse.click(...(await center(first)), { delay: 60 });
    await rest(page);
    await sleep(1400);
    const still = rec.frames.length - 1; // the bar with its numbers and the stack, nothing open: the overview picture
    // The stack: its tooltip lists the notes in it, a click offers them
    await hover(page, stack, 1700);
    await page.mouse.click(...(await center(stack)), { delay: 60 });
    const items = page.locator(".menu [role=menuitem]");
    await items.first().waitFor();
    await hover(page, items.nth(1), 1100);
    const finished = rec.frames.length + 1; // the stack's list open: the first frame of the picture
    await sleep(300);
    await page.mouse.click(...(await center(items.nth(1))), { delay: 60 });
    await rest(page);
    await sleep(1800);
    const shots = await rec.stop(1500);
    leadWith(dir, shots[finished].file, 1300);
    copyFileSync(join(dir, shots[still].file), join(stillsDir(ctx, locale), "badges.jpg"));
  } finally {
    await inst.close();
  }
}

/**
 * Drawings: an arrow and a pen circle left without a word stay on the picture, without a number (the first time a hint says so);
 * a click on one opens its colors, a double-click writes a note for it and it gets a number
 */
export async function drawings(ctx, locale) {
  const dir = join(ctx.work, locale, "drawings");
  freshNotes();
  const inst = await start(ctx, locale, "drawings");
  try {
    const { page } = inst;
    const n = NOTES[locale];
    await open(page, "hero.png");
    await drawNote(page, { ...TITLE, text: n.title, pace: FAST });
    await dismissToast(page);
    await focusStage(page);
    await page.keyboard.press("a");
    await rest(page);
    const blank = await onImage(page, 0.62, 0.08);
    const composer = page.locator(".composer");
    const circle = ellipse(0.75, 0.66, 0.1, 0.085);

    const rec = new Recorder(page, dir);
    await rec.start();
    await sleep(900);
    // An arrow at the button, and a click elsewhere without writing: it stays
    await slowDrag(page, await onImage(page, 0.42, 0.86), await onImage(page, 0.25, 0.68), 600, 12);
    await composer.waitFor();
    await sleep(1000);
    await hover(page, blank, 300);
    await page.mouse.click(...blank, { delay: 60 });
    await composer.waitFor({ state: "detached" });
    await sleep(2200); // the first-time hint
    // A circle around the glass with the pen, left the same way
    await page.keyboard.press("b");
    await stroke(page, await page.locator("img.zoom-media").boundingBox(), circle, 3);
    await composer.waitFor();
    await sleep(900);
    await hover(page, blank, 300);
    await page.mouse.click(...blank, { delay: 60 });
    await composer.waitFor({ state: "detached" });
    await sleep(1000);
    // The circle: a click opens its colors right next to it
    await page.keyboard.press("v");
    const edge = await onImage(page, ...circle[0]);
    await hover(page, edge, 500);
    await page.mouse.click(...edge, { delay: 60 });
    const bar = page.locator(".mark-colors");
    await bar.waitFor();
    await sleep(700);
    const still = rec.frames.length - 1; // the color row open, before a tooltip: the overview picture
    await hover(page, bar.locator(".menu-swatch").nth(3), 900);
    const finished = rec.frames.length + 1; // two drawings and the color row open on one of them: the first frame of the picture
    await sleep(300);
    await page.mouse.click(...(await center(bar.locator(".menu-swatch").nth(3))), { delay: 60 });
    await sleep(1100);
    await page.keyboard.press("Escape");
    // The arrow: a double-click writes a note for it, and it gets a number
    const mid = await onImage(page, 0.2925, 0.725); // near the head: the color row opens by the tail and must not take the second click
    await hover(page, mid, 500);
    await page.mouse.dblclick(...mid, { delay: 60 });
    await composer.waitFor();
    await sleep(500);
    await page.locator(".composer-text").pressSequentially(n.button, { delay: 22 });
    await sleep(700);
    await page.keyboard.press("Enter");
    await rest(page);
    await sleep(1800);
    const shots = await rec.stop(1500);
    leadWith(dir, shots[finished].file, 1300);
    copyFileSync(join(dir, shots[still].file), join(stillsDir(ctx, locale), "drawings.jpg"));
  } finally {
    await inst.close();
  }
}

/**
 * The capture overlay (drawn to PNG through the test hooks on an off-screen fake monitor, as in scenes.mjs → capture): an arrow and an
 * ellipse left without a word stay as drawings; a click on one opens its colors and Delete right next to it; a double-click writes its note
 */
export async function captureDrawings(ctx, locale) {
  const dir = join(ctx.work, locale, "capture-drawings");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const inst = await start(ctx, locale, "capture-drawings", { capture: { DrawingHintDone: true } });
  try {
    const { ask } = inst;
    const n = NOTES[locale];
    const shots = [];
    const run = async (ops) => {
      const r = await ask("debugCaptureDo", { monitor: 0, ops });
      return Object.assign(r.state.overlays[0] ?? {}, { results: r.results });
    };
    const snap = async (ms, ops = []) => {
      const file = `f${String(shots.length).padStart(3, "0")}.png`;
      const layer = await run([...ops, { op: "shot", path: join(dir, file) }]);
      shots.push({ file, ms });
      return layer;
    };
    /** A drag in a few shots: down, then one shot at each point (the last one is where it ends), up, and a shot of the result held for last ms */
    const drag = async (from, points, last) => {
      await run([
        { op: "move", x: from[0], y: from[1] },
        { op: "down", x: from[0], y: from[1] },
      ]);
      for (const [x, y, ms] of points) await snap(ms, [{ op: "move", x, y }]);
      await run([{ op: "up" }]);
      return snap(last);
    };
    const step = 110;
    const elsewhere = (x, y) => [{ op: "move", x, y }, { op: "down", x, y }, { op: "up" }];
    await ask("debugCaptureFake", {
      monitors: [{ x: OFF, y: OFF, width: 1280, height: 720, scale: 1, image: join(ctx.work, "sample", "screen.png") }],
      windows: [],
      cursor: null,
    });
    await ask("debugHotkey");
    await wait("the capture overlay", async () => (await ask("debugCaptureState")).open);

    // Before the first frame: the region, and a box on the headline with its note
    await run([
      { op: "drag", from: [40, 90], to: [1230, 640] },
      { op: "key", key: "R" },
      { op: "drag", from: [70, 196], to: [690, 355] },
      { op: "type", text: n.screen },
      { op: "key", key: "Enter" },
      { op: "key", key: "A" },
    ]);
    await snap(1200);
    // An arrow at the button: the note box opens; a click elsewhere without writing and the arrow stays, without a number
    await drag(
      [430, 470],
      [
        [350, 500, step],
        [262, 528, step],
      ],
      1100,
    );
    let o = await snap(1400, elsewhere(700, 450));
    if (o.note || o.marks.length !== 2) throw new Error(`The arrow did not stay as a drawing: ${JSON.stringify(o.marks)}`);
    // An ellipse around the spout, left the same way
    await run([{ op: "key", key: "O" }]);
    await drag(
      [880, 150],
      [
        [950, 215, step],
        [1020, 280, step],
        [1085, 340, step],
      ],
      1000,
    );
    o = await snap(1300, elsewhere(120, 560));
    if (o.note || o.marks.length !== 3) throw new Error(`The ellipse did not stay as a drawing: ${JSON.stringify(o.marks)}`);
    // A click on the ellipse's line picks it: its colors pop up right next to it, ending with Delete
    await run([{ op: "click", id: "ellipse" }]);
    o = await snap(1500, [{ op: "move", x: 880, y: 245 }, { op: "down", x: 880, y: 245 }, { op: "up" }]);
    if (o.picked < 0) throw new Error("The ellipse was not picked");
    const pickedFrame = shots.at(-1).file;
    const other = o.buttons.find((b) => b.id.startsWith("color-") && b.id !== `color-${o.color}` && b.id !== "color-custom").id;
    await snap(1400, [{ op: "click", id: other }]);
    // A double-click on the arrow writes a note for it: it gets a number
    await snap(1000, [{ op: "dblclick", x: 346, y: 499 }]);
    await snap(1500, [{ op: "type", text: n.screenButton }]);
    o = await snap(2000, [{ op: "key", key: "Enter" }]);
    if (!o.marks.some((m) => m.number === 2)) throw new Error(`The arrow did not get a number: ${JSON.stringify(o.marks)}`);
    writeFileSync(join(dir, "frames.json"), JSON.stringify([{ file: pickedFrame, ms: 1300 }, ...shots]));
    copyFileSync(join(dir, pickedFrame), join(stillsDir(ctx, locale), "capture.png"));
    await run([
      { op: "key", key: "Escape" },
      { op: "key", key: "Escape" },
    ]);
    console.log(`Capture drawings: ${shots.length} frames in ${dir}`);
  } finally {
    await inst.close();
  }
}
