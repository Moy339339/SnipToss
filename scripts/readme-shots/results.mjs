// The images Copy as Images makes, as the pictures a reader of the README sees first: what is handed to the AI rather than the window it was made in.
// The notes are written straight into the notes files (the wording and places are fixed, nothing depends on drawing them by hand);
// the images are made by the real app (right-click the item → Copy Notes as Images) and collected from where it saves them.
//
//   node scripts/readme-shots.mjs --only results --locales en --work <folder>
//
// Leaves in <work>/<locale>/results/:
//   teaser/        the teaser with notes at 24 moments: more than one copy may hold, so several moments share an image as a grid (01 = its four shots)
//   teaser-short/  the same teaser with notes at four moments: one image per moment
//   cover/         the illustration with three notes: one image
//   flyer/         the festival flyer with three notes: one image
// and in <work>/sample/: cover.png, flyer.png, flyer-after.png (the flyer after the notes were applied)

import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLIP, PROJECT, PROJECT2, PROJECTS, launch, sleep, wait } from "./common.mjs";
import { CLIP_SECONDS, renderIllustration } from "./sample.mjs";
import { OFF, seedResolved } from "./scenes.mjs";

/** Two more sample projects: the teaser on its own (with its notes), and the picture book */
const TEASER = join(PROJECTS, "ruby-pop-teaser");
const BOOK = join(PROJECTS, "tiny-planet-book");
const AT = "2026-11-12T03:00:00Z";

function writeNotes(project, path, material, notes) {
  mkdirSync(join(project, ".sniptoss", "annotations"), { recursive: true });
  writeFileSync(
    join(project, ".sniptoss", "annotations", `${path.replace("/", "__")}.json`),
    JSON.stringify(
      {
        schema: "sniptoss/5",
        material: { path, ...material },
        annotations: notes.map((n, i) => ({
          id: `r${String(i + 1).padStart(5, "0")}`,
          status: "open",
          category: n.category ?? "change",
          body: n.body,
          anchor: { ...(n.time !== undefined ? { time: { start: n.time } } : {}), ...(n.shape ? { shapes: [n.shape] } : {}) },
          author: "user",
          created_at: AT,
          updated_at: AT,
          replies: [],
        })),
      },
      null,
      2,
    ) + "\n",
  );
}

const rect = (x, y, w, h) => ({ type: "rect", x, y, w, h });
const arrow = (x1, y1, x2, y2) => ({ type: "arrow", from: [x1, y1], to: [x2, y2] });
const point = (x, y) => ({ type: "point", x, y });
const frame = (seconds) => Math.round(seconds * 24) / 24;

/** The four notes a reader sees: one in each of the four shots (places as they are on that frame, the camera moves) */
const SHOTS = [
  {
    time: frame(1.5),
    body: "They are too small in the opening shot. Start closer on the girl and the cat.",
    shape: rect(0.11, 0.44, 0.26, 0.47),
  },
  { time: frame(4.5), body: "The cat's ears are cut off. Pull back a little.", shape: arrow(0.4, 0.2, 0.52, 0.06) },
  { time: frame(7.5), body: "Her foot is floating next to the pedal. Put it on.", shape: rect(0.28, 0.61, 0.16, 0.22) },
  {
    time: frame(10.5),
    body: "Her raincoat is longer here than in the bike shot. Keep it the same.",
    shape: rect(0.415, 0.39, 0.16, 0.325),
  },
];

/** Twenty more on the closing card, a third of a second apart: with 24 moments one copy can't give each its own image */
const CLOSING = [
  { body: "Fade the name in more slowly.", shape: rect(0.2, 0.33, 0.6, 0.2) },
  { body: "Show the line together with the name.", shape: point(0.5, 0.6) },
  { body: "The gradient flickers on this frame.", shape: point(0.15, 0.2) },
  { body: "Trim two frames here.", category: "remove" },
  { body: "Hold this frame a little longer.", category: "add", shape: arrow(0.78, 0.78, 0.66, 0.64) },
];
const closing = () => Array.from({ length: 20 }, (_, i) => ({ time: frame(12.5 + i * 0.36), ...CLOSING[i % CLOSING.length] }));

const COVER = [
  { body: "Two moons is one too many. Remove this one.", category: "remove", shape: rect(0.86, 0.015, 0.13, 0.185) },
  { body: "The robot should look up at the tree, not at us.", shape: arrow(0.86, 0.8, 0.77, 0.68) },
  { body: "Make the water reach the roots.", shape: point(0.465, 0.6) },
];

const FLYER = [
  { body: "Title is too small for a poster. Make it twice as large.", shape: rect(0.29, 0.066, 0.42, 0.094) },
  { body: "The date is hard to read. Add more contrast.", shape: arrow(0.72, 0.8, 0.62, 0.92) },
  { body: "Add the opening time next to the date.", category: "add", shape: point(0.8, 0.945) },
];

/** The newest folder the app saved copied images to (several images are saved as files) */
function newestHandoff(root) {
  const found = [];
  const walk = (dir, depth) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const p = join(dir, e.name);
      if (e.name === "handoff") found.push(...readdirSync(p).map((n) => join(p, n)));
      else if (depth < 3 && e.name !== "WebView2") walk(p, depth + 1);
    }
  };
  walk(root, 0);
  return found.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
}

export async function results(ctx, locale) {
  const out = join(ctx.work, locale, "results");
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const sample = join(ctx.work, "sample");

  // The teaser (rendered into the first project by prepareProject), twice: with 24 moments noted and with four
  rmSync(TEASER, { recursive: true, force: true });
  mkdirSync(join(TEASER, "video"), { recursive: true });
  const video = { kind: "video", width: 1280, height: 720, duration: CLIP_SECONDS, frame_rate: 24 };
  copyFileSync(join(PROJECT, "video", CLIP), join(TEASER, "video", "teaser.mp4"));
  copyFileSync(join(PROJECT, "video", CLIP), join(TEASER, "video", "teaser-short.mp4"));
  writeNotes(TEASER, "video/teaser.mp4", video, [...SHOTS, ...closing()]);
  writeNotes(TEASER, "video/teaser-short.mp4", video, SHOTS);
  // The illustration
  rmSync(BOOK, { recursive: true, force: true });
  mkdirSync(join(BOOK, "art"), { recursive: true });
  await renderIllustration(join(sample, "cover.png"));
  copyFileSync(join(sample, "cover.png"), join(BOOK, "art", "cover.png"));
  writeNotes(BOOK, "art/cover.png", { kind: "image", width: 1500, height: 1000 }, COVER);
  // The flyer with its three notes (the poster next to it keeps its resolved one)
  rmSync(join(PROJECT2, ".sniptoss"), { recursive: true, force: true });
  seedResolved(PROJECT2, "poster.png", 1200, 1500);
  writeNotes(PROJECT2, "assets/flyer.png", { kind: "image", width: 1500, height: 1000 }, FLYER);

  const inst = await launch(ctx.exe, {
    locale,
    dataDir: join(ctx.tmp, `results-${locale}`),
    library: [TEASER, BOOK, PROJECT2],
    expanded: [join(TEASER, "video"), join(BOOK, "art"), join(PROJECT2, "assets")],
  });
  try {
    const { page, ask } = inst;
    // Setting up the capture fakes also swaps the clipboard for a recorder: the images never reach the system clipboard
    await ask("debugCaptureFake", { monitors: [{ x: OFF, y: OFF, width: 1280, height: 720, scale: 1 }], windows: [], cursor: null });
    let last = "";
    for (const [name, row, single] of [
      ["teaser", "teaser.mp4", false],
      ["teaser-short", "teaser-short.mp4", false],
      ["cover", "cover.png", true],
      ["flyer", "flyer.png", true],
    ]) {
      const dir = join(out, name);
      mkdirSync(dir, { recursive: true });
      const before = newestHandoff(inst.dataDir);
      await page.locator(".lib-row", { hasText: row }).first().click({ button: "right" });
      await page.getByRole("menuitem", { name: /Copy Notes as Images/ }).click();
      if (single) {
        // One image goes to the clipboard (the recorder, which keeps the last one: wait for a picture that differs from the previous case's)
        const file = join(dir, "01.png");
        await wait(
          `the image of ${name}`,
          async () => {
            const ok = await ask("debugClipboardPng", { path: file }).then(
              () => existsSync(file),
              () => false,
            );
            return ok && statSync(file).size !== last;
          },
          120_000,
        );
        last = statSync(file).size;
      } else {
        // Several images are saved as files; the folder is complete when its file count stops changing
        const saved = await wait(
          "the images to be saved",
          () => {
            const d = newestHandoff(inst.dataDir);
            return d && d !== before ? d : undefined;
          },
          120_000,
        );
        for (let n = -1; n !== readdirSync(saved).length; await sleep(1500)) n = readdirSync(saved).length;
        cpSync(saved, dir, { recursive: true });
      }
      console.log(`${name}: ${readdirSync(dir).filter((n) => n.endsWith(".png")).length} image(s)`);
      await sleep(1500);
    }
  } finally {
    await inst.close();
  }
}
