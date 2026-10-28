// Regenerates tests/golden/where.zh-CN.json: the golden file for the position wording given to AI. The expected values come from core's describeShape
// (the reference implementation); the C# (capture overlay ShapeText) and TS sides both compare against it. Usage: node scripts/gen-golden-where.mjs after npm run build
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const { describeShape } = await import(pathToFileURL(join(root, "packages", "core", "dist", "index.js")).href);
const { IntlMessageFormat } = await import("intl-messageformat");
// The wording lives in the messages (ai.where.*): computed from the Chinese catalog
const zh = JSON.parse(readFileSync(join(root, "i18n", "locales", "zh-CN.json"), "utf8"));
const t = (id, values) => String(new IntlMessageFormat(zh[id], "zh-CN").format(values));

const hd = { width: 1920, height: 1080 };
const cases = [
  ["Grid: top left, with pixels", { type: "point", x: 0.1, y: 0.1 }, { width: 1000, height: 500 }],
  ["Grid: center, size unknown so percentages only", { type: "point", x: 0.5, y: 0.5 }, null],
  ["Grid: right, middle", { type: "point", x: 0.9, y: 0.6 }, null],
  ["Grid: bottom, middle", { type: "point", x: 0.5, y: 0.95 }, hd],
  ["Exactly on the thirds (1/3, 2/3) counts as the middle cell", { type: "point", x: 1 / 3, y: 2 / 3 }, hd],
  ["Region: an ordinary box", { type: "rect", x: 0.1234, y: 0.0555, w: 0.4, h: 0.1 }, hd],
  ["Region: spans the width", { type: "rect", x: 0, y: 0.85, w: 1, h: 0.15 }, hd],
  ["Region: spans the height", { type: "rect", x: 0.05, y: 0, w: 0.2, h: 1 }, null],
  ["Region: covers most of the frame", { type: "rect", x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, hd],
  ["Region: width of exactly 0.66 counts as spanning", { type: "rect", x: 0.1, y: 0.4, w: 0.66, h: 0.1 }, hd],
  [
    "Rounding: pixels at exactly .5 round up (2.5 → 3, not banker's rounding to 2)",
    { type: "rect", x: 0.5, y: 0.5, w: 0.1, h: 0.1 },
    { width: 5, height: 5 },
  ],
  ["Rounding: percentages at exactly .5 round up (12.5 → 13)", { type: "rect", x: 0.125, y: 0.375, w: 0.25, h: 0.125 }, null],
  [
    "Rounding: negative .5 rounds toward the larger value (-2.5 → -2)",
    { type: "point", x: -0.0025, y: 0.5 },
    { width: 1000, height: 1000 },
  ],
  [
    "Outside the frame: percentages clamped to 0–100, pixels as they are",
    { type: "rect", x: -0.1, y: 0.9, w: 0.3, h: 0.2 },
    { width: 1000, height: 1000 },
  ],
  ["Arrow: start and end", { type: "arrow", from: [0.1, 0.9], to: [0.5, 0.5] }, { width: 1000, height: 500 }],
  ["Arrow: size unknown", { type: "arrow", from: [0.8, 0.2], to: [0.2, 0.75] }, null],
  [
    "Pen: described by its bounding box",
    {
      type: "path",
      points: [
        [0.7, 0.1],
        [0.9, 0.3],
        [0.75, 0.25],
      ],
    },
    hd,
  ],
  ["Pen: a single point", { type: "path", points: [[0.3, 0.3]] }, { width: 800, height: 600 }],
];
const out = cases.map(([name, shape, size]) => ({ name, shape, size, text: describeShape(shape, size ?? undefined, t) }));
const file = join(root, "tests", "golden", "where.zh-CN.json");
writeFileSync(file, JSON.stringify(out, null, 2) + "\n", "utf8");
console.log(`${out.length} cases → ${file}`);
