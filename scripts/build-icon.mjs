// Generates the app icon: a vector master plus small sizes drawn separately on a pixel grid, packed into a multi-size .ico.
//   node scripts/build-icon.mjs
// Output: app/SnipToss.ico (for the app, windows and shortcuts), design/icon/sniptoss.svg (the master),
//         design/icon/sniptoss-1024.png, design/icon/final-preview.png (1:1 preview on dark and light backgrounds, for checking the small sizes)
// Design: a viewfinder frame plus a note box, redrawn here from the design draft as clean vectors.

import { Resvg } from "@resvg/resvg-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BLUE = "#5b8cff"; // UI accent blue (styles.css --accent)
const ORANGE = "#ff6a3d"; // note orange (styles.css --mark)

/** Master, 256 grid: four-corner viewfinder frame (blue) + note box with a small tail (orange) */
const MASTER = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <g fill="none" stroke="${BLUE}" stroke-width="20" stroke-linecap="round" stroke-linejoin="round">
    <path d="M36 92V60a24 24 0 0 1 24-24h32"/>
    <path d="M164 36h32a24 24 0 0 1 24 24v32"/>
    <path d="M220 164v32a24 24 0 0 1-24 24h-32"/>
    <path d="M92 220H60a24 24 0 0 1-24-24v-32"/>
  </g>
  <path d="M104 80h48a24 24 0 0 1 24 24v82l-20-10h-52a24 24 0 0 1-24-24v-48a24 24 0 0 1 24-24z"
        fill="none" stroke="${ORANGE}" stroke-width="18" stroke-linejoin="round"/>
</svg>`;

/**
 * Small sizes: drawn entirely with filled rectangles on whole pixels, so edges land on the pixel grid and stay sharp.
 * Line width s, corner inset o, corner arm length a and note-box inset b are all rounded per size; the tail is drawn from 24px up (smaller turns into noise).
 */
function small(n) {
  const s = n <= 24 ? 2 : n <= 32 ? 3 : 4;
  const o = Math.max(1, Math.round(n * 0.08));
  const a = Math.round(n * 0.27);
  const b = Math.round(n * 0.28);
  const r = n <= 20 ? 0.5 : 1; // slightly rounded corners, so they don't look sharp after anti-aliasing
  const e = n - o; // right/bottom edge of the outer frame
  const rect = (x, y, w, h, c) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${c}"/>`;
  const corners = [
    rect(o, o, a, s, BLUE),
    rect(o, o, s, a, BLUE),
    rect(e - a, o, a, s, BLUE),
    rect(e - s, o, s, a, BLUE),
    rect(o, e - s, a, s, BLUE),
    rect(o, e - a, s, a, BLUE),
    rect(e - a, e - s, a, s, BLUE),
    rect(e - s, e - a, s, a, BLUE),
  ];
  const be = n - b;
  // Note box: outer rectangle minus inner rectangle (evenodd), same line width as the corners
  const box = `<path fill="${ORANGE}" fill-rule="evenodd" d="M${b} ${b}h${be - b}v${be - b}h${-(be - b)}z M${b + s} ${b + s}v${be - b - 2 * s}h${be - b - 2 * s}v${-(be - b - 2 * s)}z"/>`;
  // Tail: extends one cell down and to the right from the box's bottom-right corner
  const tail = n >= 24 ? `<path fill="${ORANGE}" d="M${be - s} ${be}h${s}v${s}z"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${n}" height="${n}">${corners.join("")}${box}${tail}</svg>`;
}

const render = (svg, size) => new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();

// Sizes stored in the .ico: 16/20/24/32 use the pixel version, 40 and up use the master
const SIZES = [16, 20, 24, 32, 40, 48, 64, 256];
const pngs = SIZES.map((n) => ({ n, png: n <= 32 ? render(small(n), n) : render(MASTER, n) }));

// Write the .ico: 6-byte header + 16-byte directory entry per image + PNG data (since Vista, PNG entries are supported at every size)
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(pngs.length, 4);
let offset = 6 + 16 * pngs.length;
const dir = pngs.map(({ n, png }) => {
  const d = Buffer.alloc(16);
  d.writeUInt8(n >= 256 ? 0 : n, 0);
  d.writeUInt8(n >= 256 ? 0 : n, 1);
  d.writeUInt16LE(1, 4);
  d.writeUInt16LE(32, 6);
  d.writeUInt32LE(png.length, 8);
  d.writeUInt32LE(offset, 12);
  offset += png.length;
  return d;
});
writeFileSync(join(ROOT, "app/SnipToss.ico"), Buffer.concat([header, ...dir, ...pngs.map((p) => p.png)]));

const ICON_DIR = join(ROOT, "design/icon");
mkdirSync(ICON_DIR, { recursive: true });
writeFileSync(join(ICON_DIR, "sniptoss.svg"), MASTER + "\n");
writeFileSync(join(ICON_DIR, "sniptoss-1024.png"), render(MASTER, 1024));

// Preview: one row on a dark and one on a light background, all at 1:1 pixels
const row = (bg, y) =>
  `<rect x="0" y="${y}" width="760" height="300" fill="${bg}"/>` +
  pngs
    .filter((p) => p.n !== 20 && p.n !== 40)
    .reduce(
      (acc, p) => {
        const x = acc.x;
        acc.out += `<image x="${x}" y="${y + 150 - p.n / 2}" width="${p.n}" height="${p.n}" href="data:image/png;base64,${p.png.toString("base64")}"/>`;
        acc.x += p.n + 28;
        return acc;
      },
      { x: 24, out: "" },
    ).out;
const preview = `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="600">${row("#141416", 0)}${row("#f3f3f3", 300)}</svg>`;
writeFileSync(join(ICON_DIR, "final-preview.png"), new Resvg(preview).render().asPng());

console.log("Generated app/SnipToss.ico (" + SIZES.join("/") + "), design/icon/sniptoss.svg, sniptoss-1024.png, final-preview.png");
