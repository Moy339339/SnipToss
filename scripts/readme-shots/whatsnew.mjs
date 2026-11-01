// The scenes of the 1.1 "what's new" pictures: mark colors and the color picker, deleting one place of a note, moving the note box out of
// the way, and the same tools on the capture overlay. Like the README scenes (scenes.mjs) they drive the real UI over CDP (the capture overlay
// through the test hooks of the shell-test build) and leave raw footage: frames + frames.json per scene, and one 2× still per scene for the
// overview picture in <work>/<locale>/whatsnew. While the recorder runs, a still is one of its frames (JPEG) rather than a pageShot:
// a second screenshot at 2× taken alongside the recorder's leaves the page with a wrong viewport (the window lays itself out again, zoomed).
//
// The first frame of each animation already shows the feature (a browser that doesn't play animations only shows that frame): the scenes
// start with the color bar open, and the note-box scene leads with its finished frame (a real frame from later in the same recording).

import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { NOTES, PROJECT2, Recorder, dismissToast, drawNote, launch, pageShot, sleep, wait } from "./common.mjs";
import { BUTTON, FAST, OFF, TITLE, freshNotes, open, seedResolved, start } from "./scenes.mjs";

/** Where the stills of the overview picture go */
function stillsDir(ctx, locale) {
  const dir = join(ctx.work, locale, "whatsnew");
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

async function press(page, target, rest = 450) {
  const [x, y] = await hover(page, target, rest);
  await page.mouse.click(x, y, { delay: 60 });
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

/** The number badge of a note on the canvas (part = which of its places) */
const badge = (page, number, part = 0) => page.locator(`.annot-badge[data-part="${part}"]`).filter({ hasText: new RegExp(`^${number}$`) });
const bar = (page) => page.locator(".mark-colors");

/** Opens the color bar of a mark by clicking its badge */
async function openBar(page, number, part = 0) {
  await press(page, badge(page, number, part), 250);
  await bar(page).waitFor();
  await sleep(250); // the opening animation
}

/** Puts a frame from later in the recording first, held for ms (frames.json is rewritten) */
function leadWith(dir, file, ms) {
  const path = join(dir, "frames.json");
  const frames = JSON.parse(readFileSync(path, "utf8"));
  writeFileSync(path, JSON.stringify([{ file, ms }, ...frames]));
}

/** The pointer rests in a corner of the window, over nothing that reacts to it */
const rest = (page) => page.mouse.move(10, 790);

/**
 * Colors: the title turns black, the glass white (its number turns dark), and the arrow gets a color made in the color picker,
 * which then waits among the recent colors of every color row
 */
export async function colors(ctx, locale) {
  const dir = join(ctx.work, locale, "colors");
  freshNotes();
  const inst = await start(ctx, locale, "colors");
  try {
    const { page } = inst;
    const n = NOTES[locale];
    await open(page, "hero.png");
    await drawNote(page, { ...TITLE, text: n.title, pace: FAST });
    await drawNote(page, { ...BUTTON, text: n.button, pace: FAST });
    await drawNote(page, { tool: "r", marks: [{ from: [0.655, 0.46], to: [0.865, 0.905] }], text: n.glass, pace: FAST });
    await dismissToast(page);
    await page.keyboard.press("v");
    // First frame: the title's color bar is open, the pointer on Black (its tooltip gives the key)
    await openBar(page, 1);
    const swatch = (i) => bar(page).locator(".menu-swatch").nth(i);
    await hover(page, swatch(6), 900);

    const rec = new Recorder(page, dir);
    await rec.start();
    await sleep(1300);
    await page.mouse.click(...(await center(swatch(6))), { delay: 60 });
    await sleep(1000);
    // The glass turns white: the number on it turns dark
    await openBar(page, 3);
    await press(page, swatch(7), 800);
    await sleep(1100);
    // The arrow: a color of its own from the color picker (the hue strip, then the field), OK
    await openBar(page, 2);
    await press(page, bar(page).locator(".is-custom"), 700);
    const picker = page.locator(".color-picker");
    await picker.waitFor();
    await sleep(700);
    const hue = await page.locator(".color-hue").boundingBox();
    const y = hue.y + hue.height / 2;
    await slowDrag(page, [hue.x + hue.width * 0.04, y], [hue.x + hue.width * 0.47, y], 900);
    await sleep(350);
    const field = await page.locator(".color-field").boundingBox();
    await slowDrag(
      page,
      [field.x + field.width * 0.76, field.y + 2],
      [field.x + field.width * 0.86, field.y + field.height * 0.36],
      600,
      10,
    );
    await sleep(500);
    const still = rec.frames.length + 1; // the color picker with its new color, for the overview picture
    await press(page, picker.getByRole("button"), 500);
    await picker.waitFor({ state: "detached" });
    await sleep(1300);
    // The new color is now one click away on every mark: the title's color bar offers it, the pointer on it
    await openBar(page, 1);
    await hover(page, bar(page).locator(".menu-swatch").nth(8), 1900);
    const frames = await rec.stop(1500);
    copyFileSync(join(dir, frames[still].file), join(stillsDir(ctx, locale), "colors.jpg"));
  } finally {
    await inst.close();
  }
}

/**
 * The still of the colors card in the overview: on the poster, where the middle is all picture (a crop then cuts through no text),
 * the record label already has a color made in the color picker, and the tonearm's color bar has the picker open on a new color
 */
export async function colorsStill(ctx, locale) {
  rmSync(join(PROJECT2, ".sniptoss"), { recursive: true, force: true });
  seedResolved(PROJECT2, "poster.png", 1200, 1500);
  const inst = await launch(ctx.exe, {
    locale,
    dataDir: join(ctx.tmp, `colors-still-${locale}`),
    library: [PROJECT2],
    expanded: [join(PROJECT2, "assets")],
  });
  try {
    const { page } = inst;
    const n = NOTES[locale];
    await open(page, "poster.png");
    await drawNote(page, { tool: "a", marks: [{ from: [0.24, 0.47], to: [0.42, 0.555] }], text: n.label, pace: FAST });
    await drawNote(page, { tool: "a", marks: [{ from: [0.9, 0.615], to: [0.74, 0.66] }], text: n.arm, pace: FAST });
    await dismissToast(page);
    await page.keyboard.press("v");
    // The arrow at the label: a color typed into the picker's hex box (the digits are selected when it opens), OK
    await openBar(page, 1);
    await press(page, bar(page).locator(".is-custom"), 300);
    await page.locator(".color-picker").waitFor();
    await page.keyboard.type("17A38A");
    await page.keyboard.press("Enter");
    await page.locator(".color-picker").waitFor({ state: "detached" });
    // The tonearm: its color bar now offers that color among the recent ones; the picker opened from it, dragged to a new color
    await page.keyboard.press("Escape");
    await openBar(page, 2);
    await press(page, bar(page).locator(".is-custom"), 300);
    await page.locator(".color-picker").waitFor();
    await sleep(300);
    const hue = await page.locator(".color-hue").boundingBox();
    const y = hue.y + hue.height / 2;
    await slowDrag(page, [hue.x + hue.width * 0.04, y], [hue.x + hue.width * 0.76, y], 300, 8);
    const field = await page.locator(".color-field").boundingBox();
    await slowDrag(
      page,
      [field.x + field.width * 0.5, field.y + field.height * 0.5],
      [field.x + field.width * 0.7, field.y + field.height * 0.18],
      200,
      6,
    );
    await rest(page);
    await sleep(800);
    await pageShot(page, join(stillsDir(ctx, locale), "colors.png"), 2);
  } finally {
    await inst.close();
  }
}

/** Delete one place: a note pointing at the date and (by mistake) at the subtitle loses the second place from its color bar, Ctrl+Z brings it back; then the Delete key */
export async function deletePlace(ctx, locale) {
  const dir = join(ctx.work, locale, "delete");
  rmSync(join(PROJECT2, ".sniptoss"), { recursive: true, force: true });
  seedResolved(PROJECT2, "poster.png", 1200, 1500);
  const inst = await launch(ctx.exe, {
    locale,
    dataDir: join(ctx.tmp, `delete-${locale}`),
    library: [PROJECT2],
    expanded: [join(PROJECT2, "assets")],
  });
  try {
    const { page } = inst;
    const n = NOTES[locale];
    await open(page, "flyer.png");
    await drawNote(page, { tool: "r", marks: [{ from: [0.14, 0.05], to: [0.86, 0.2] }], text: n.posterTitle, pace: FAST });
    await drawNote(page, {
      tool: "a",
      marks: [
        { from: [0.72, 0.68], to: [0.62, 0.86] },
        { from: [0.13, 0.245], to: [0.3, 0.245] },
      ],
      text: n.posterDate,
      pace: FAST,
    });
    await dismissToast(page);
    await page.keyboard.press("v");
    // First frame: the subtitle's color bar is open, the pointer on Delete (its tooltip gives the key)
    await openBar(page, 2, 1);
    const del = bar(page).locator(".mark-colors-delete");
    await hover(page, del, 900);
    await pageShot(page, join(stillsDir(ctx, locale), "delete.png"), 2);

    const rec = new Recorder(page, dir);
    await rec.start();
    await sleep(1400);
    await page.mouse.click(...(await center(del)), { delay: 60 });
    await rest(page);
    await sleep(1500);
    await page.keyboard.press("Control+z");
    await sleep(1800);
    // The Delete key does the same while the bar is open
    await openBar(page, 2, 1);
    await rest(page);
    await sleep(800);
    await page.keyboard.press("Delete");
    await sleep(1300);
    await page.keyboard.press("Control+z");
    await sleep(1500);
    await rec.stop(1500);
  } finally {
    await inst.close();
  }
}

/** The note box opens over the next thing to mark: dragged away by its title row, the covered link is marked as a second place, then saved */
export async function movebox(ctx, locale) {
  const dir = join(ctx.work, locale, "movebox");
  freshNotes();
  const inst = await start(ctx, locale, "movebox");
  try {
    const { page } = inst;
    const n = NOTES[locale];
    await open(page, "hero.png");
    await drawNote(page, { ...TITLE, text: n.title, pace: FAST });
    await dismissToast(page);
    await page.locator(".stage").click({ position: { x: 4, y: 4 } });
    await page.keyboard.press("r");
    await rest(page);

    const rec = new Recorder(page, dir);
    await rec.start();
    await sleep(900);
    // The button: the box opens to its right, over the link next to it
    await slowDrag(page, await onImage(page, 0.055, 0.62), await onImage(page, 0.228, 0.715), 600, 12);
    const composer = page.locator(".composer");
    await composer.waitFor();
    await sleep(900);
    // The grip's tooltip, then the title row dragged down and to the right
    await hover(page, page.locator(".composer-grip"), 900);
    const title = await page.locator(".composer-title").boundingBox();
    const from = [title.x + 60, title.y + title.height / 2];
    await slowDrag(page, from, [from[0] + 150, from[1] + 52], 800, 18);
    await sleep(700);
    // The link it covered, as a second place of the same note: the box stays where it was put
    await slowDrag(page, await onImage(page, 0.237, 0.645), await onImage(page, 0.4, 0.725), 600, 12);
    await sleep(700);
    await page.locator(".composer-text").pressSequentially(n.sameStyle, { delay: 45 });
    await sleep(900);
    const finished = rec.frames.length + 1; // a frame with the box moved, two places and the text: the first frame of the picture
    await sleep(300);
    await page.keyboard.press("Enter");
    await sleep(600);
    await page.keyboard.press("v");
    await rest(page);
    await sleep(1500);
    const frames = await rec.stop(1500);
    leadWith(dir, frames[finished].file, 1300);
    copyFileSync(join(dir, frames[finished].file), join(stillsDir(ctx, locale), "movebox.jpg"));
  } finally {
    await inst.close();
  }
}

/**
 * The capture overlay (drawn to PNG through the test hooks on an off-screen fake monitor, as in scenes.mjs → capture):
 * a black box on the headline is already there; a color made in the color picker, an arrow at the button with its note box dragged aside,
 * then the box is picked and deleted from the toolbar, and Ctrl+Z brings it back
 */
export async function captureToolbar(ctx, locale) {
  const dir = join(ctx.work, locale, "capture-toolbar");
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const inst = await start(ctx, locale, "capture-toolbar");
  try {
    const { ask } = inst;
    const n = NOTES[locale];
    const frames = [];
    /** Runs a few steps; returns how the layer looks afterwards, with each step's return value in results */
    const run = async (ops) => {
      const r = await ask("debugCaptureDo", { monitor: 0, ops });
      return Object.assign(r.state.overlays[0] ?? {}, { results: r.results }); // no layer once the overlay is closed
    };
    const snap = async (ms, ops = []) => {
      const file = `f${String(frames.length).padStart(3, "0")}.png`;
      const layer = await run([...ops, { op: "shot", path: join(dir, file) }]);
      frames.push({ file, ms });
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
    const step = 110; // ms per in-between shot of a drag
    // A 1280 × 720 screen at 100% (the test hook's picture of the layer is not right on a scaled monitor)
    await ask("debugCaptureFake", {
      monitors: [{ x: OFF, y: OFF, width: 1280, height: 720, scale: 1, image: join(ctx.work, "sample", "screen.png") }],
      windows: [],
      cursor: null,
    });
    await ask("debugHotkey");
    await wait("the capture overlay", async () => (await ask("debugCaptureState")).open);

    // Before the first frame: the region, and a black box (key 7) on the headline with its note
    await run([
      { op: "drag", from: [40, 90], to: [900, 590] },
      { op: "key", key: "R" },
      { op: "key", key: "D7" },
      { op: "drag", from: [70, 196], to: [690, 355] },
      { op: "type", text: n.screen },
      { op: "key", key: "Enter" },
      { op: "key", key: "A" },
    ]);
    // First frame: the toolbar (Delete after Undo) and the color row (eight colors and the hue disc)
    await snap(1500);
    // The hue disc opens the color picker on black: the field first (out of black), then along the hue strip
    let o = await snap(900, [{ op: "click", id: "color-custom" }]);
    const { field, hue } = o.picker;
    const fx = (s) => field.x + field.width * s;
    const fy = (v) => field.y + field.height * (1 - v);
    await drag(
      [fx(0.01), fy(0.01)],
      [
        [fx(0.3), fy(0.3), step],
        [fx(0.6), fy(0.5), step],
        [fx(0.86), fy(0.66), step],
      ],
      350,
    );
    const hy = hue.y + hue.height / 2;
    await drag(
      [hue.x + 2, hy],
      [
        [hue.x + hue.width * 0.12, hy, step],
        [hue.x + hue.width * 0.25, hy, step],
        [hue.x + hue.width * 0.37, hy, step],
        [hue.x + hue.width * 0.47, hy, step],
      ],
      1000,
    );
    const pickerFrame = frames.at(-1).file;
    // OK: the color is used, and the row now offers it among the recent colors
    o = await snap(1100, [{ op: "click", id: "picker-apply" }]);
    if (o.picker || o.recent.length !== 1)
      throw new Error(`The color was not taken: ${JSON.stringify({ picker: o.picker, recent: o.recent })}`);
    // An arrow at the button: its note box opens to the right, over the link next to it
    await drag(
      [430, 470],
      [
        [350, 500, step],
        [262, 528, step],
      ],
      1000,
    );
    // Dragged by its title row, up and out of the way (a click on the row without moving finds where it is and leaves the box alone)
    const handle = (await run([{ op: "click", id: "note-handle" }])).results[0];
    await drag(
      [handle.x, handle.y],
      [
        [handle.x + 80, handle.y - 60, step],
        [handle.x + 170, handle.y - 130, step],
        [handle.x + 250, handle.y - 190, step],
      ],
      700,
    );
    await snap(1500, [{ op: "type", text: n.screenButton }]);
    await snap(900, [{ op: "key", key: "Enter" }]);
    // The black box: the tool is put down, a click on its line picks it, Delete on the toolbar removes it, Ctrl+Z brings it back
    await run([{ op: "click", id: "arrow" }]);
    o = await snap(1300, [{ op: "down", x: 690, y: 290 }, { op: "up" }]);
    if (o.picked < 0) throw new Error("The box was not picked");
    await snap(1500, [{ op: "click", id: "delete" }]);
    await snap(1800, [{ op: "key", key: "Z", ctrl: true }]);
    writeFileSync(join(dir, "frames.json"), JSON.stringify(frames));
    // The overview picture uses the frame with the color picker open
    copyFileSync(join(dir, pickerFrame), join(stillsDir(ctx, locale), "capture.png"));
    await run([
      { op: "key", key: "Escape" },
      { op: "key", key: "Escape" },
    ]);
    console.log(`Capture toolbar: ${frames.length} frames in ${dir}`);
  } finally {
    await inst.close();
  }
}
