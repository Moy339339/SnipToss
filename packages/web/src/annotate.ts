import { formatTime, pathRuns, shapesOf, type Annotation, type Shape } from "@sniptoss/core";
import { placeColorOf } from "./markColors";
import { isTransparent, workSize, type Size } from "./mediaSize";
import type { Prefs } from "./prefs";

// What is needed when a note is written to disk: the snapshot and the text for AI. Pure functions + canvas, no React.

/** select: select / edit marks; hand: drag the canvas; the rest draw marks */
export type Tool = "select" | "hand" | "point" | "rect" | "pen" | "arrow";

/**
 * Upper limit of the snapshot canvas: a Chromium canvas side is at most 32767 and its area at most 2^28 pixels; beyond that nothing is drawn
 * and toDataURL returns just an empty "data:," (e.g. with a 20000 × 15000 image and the snapshot size set to "Original", the saved
 * snapshot is 0 bytes). Snapshots are for people and agents to look at and need not be that large: "Original" is also scaled down to this
 */
export const SNAPSHOT_MAX_SIDE = 16384;
export const SNAPSHOT_MAX_PIXELS = 64 * 1024 * 1024;

/** How much to scale the snapshot down: no more than the longest side in Settings (0 = original), and no more than the canvas limit */
export function snapshotScale(w: number, h: number, snapshotMax: number): number {
  const side = snapshotMax > 0 ? Math.min(snapshotMax, SNAPSHOT_MAX_SIDE) : SNAPSHOT_MAX_SIDE;
  return Math.min(1, side / Math.max(w, h), Math.sqrt(SNAPSHOT_MAX_PIXELS / (w * h)));
}

/**
 * Snapshot: the whole frame scaled to snapshotMax, dimmed outside the rectangles to stress the position, and marks drawn in their color
 * (the place's or the note's own color if it has one, otherwise the one from Settings); a video gets the time written in a corner (timeLabelSpot).
 * Every place of a multi-place note is drawn, all rectangles stay bright and everything outside them is dimmed (ADR-0009).
 * When nothing can be drawn, data is empty
 */
export async function renderSnapshot(
  media: HTMLImageElement | HTMLVideoElement,
  annotation: Annotation,
  prefs: Prefs,
): Promise<{ data: string; ext: "png" | "jpg" }> {
  const { w, h } = workSize(media);
  const scale = snapshotScale(w, h, prefs.snapshotMax);
  const cw = Math.round(w * scale);
  const ch = Math.round(h * scale);
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const g = canvas.getContext("2d")!;
  if (isTransparent(media)) drawChecker(g, cw, ch);
  g.drawImage(media, 0, 0, cw, ch);

  const line = Math.max(3, Math.round(Math.max(cw, ch) / 400));
  const shapes = shapesOf(annotation);
  dimOutside(g, shapes, cw, ch);
  shapes.forEach((s, i) => drawShape(g, s, cw, ch, line, placeColorOf(annotation, i, prefs.markColor)));

  const time = annotation.anchor.time;
  if (time) {
    const label = time.end !== undefined ? `${formatTime(time.start)} – ${formatTime(time.end)}` : formatTime(time.start);
    const size = Math.max(14, Math.round(ch / 36));
    g.font = `600 ${size}px "Cascadia Mono", Consolas, monospace`;
    const pad = size * 0.5;
    const box = { w: g.measureText(label).width + pad * 2, h: size * 1.6 };
    const at = timeLabelSpot(shapes, { w: cw, h: ch }, box, { x: pad, y: pad + size * 0.4 }, line * 5);
    g.fillStyle = "rgba(0,0,0,0.7)";
    g.fillRect(at.x, at.y, box.w, box.h);
    g.fillStyle = "#fff";
    g.fillText(label, at.x + pad, at.y + size * 1.15);
  }

  const ext = prefs.snapshotFormat === "jpeg" ? "jpg" : "png";
  const url = canvas.toDataURL(ext === "jpg" ? "image/jpeg" : "image/png", 0.9);
  return { data: url.slice(url.indexOf(",") + 1), ext };
}

/**
 * An image with transparency: the snapshot also gets a checkerboard first (as on the canvas, .zoom-media.is-transparent in styles.css),
 * otherwise a dark icon would be invisible on the dark background of "Copy as Images".
 * The cell size follows the snapshot size, about 1/64 of the long side
 */
function drawChecker(g: CanvasRenderingContext2D, w: number, h: number) {
  const cell = Math.max(8, Math.round(Math.max(w, h) / 64));
  g.fillStyle = "#fff";
  g.fillRect(0, 0, w, h);
  g.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--checker").trim() || "#dcdcdc";
  for (let y = 0; y < h; y += cell) for (let x = ((y / cell) % 2) * cell; x < w; x += cell * 2) g.fillRect(x, y, cell, cell);
}

/**
 * Where the time label goes on a video snapshot: bottom left by default; when marks (each place's bounding box grown by margin, to cover the
 * pin's ring and the arrowhead) overlap it, it moves to the corner with the least overlap, tried in the order bottom left → bottom right →
 * top left → top right (with a rectangle in the bottom left corner the label would cover the inside of the rectangle).
 * All values are pixels of the snapshot; gap is the distance of the label from the image edge
 */
export function timeLabelSpot(shapes: readonly Shape[], canvas: Size, label: Size, gap: { x: number; y: number }, margin: number) {
  const left = gap.x;
  const right = canvas.w - label.w - gap.x;
  const top = gap.y;
  const bottom = canvas.h - label.h - gap.y;
  const spots = [
    { x: left, y: bottom },
    { x: right, y: bottom },
    { x: left, y: top },
    { x: right, y: top },
  ];
  if (shapes.length === 0) return spots[0];
  const boxes = shapes.map((shape) => {
    const pts =
      shape.type === "rect"
        ? [
            [shape.x, shape.y],
            [shape.x + shape.w, shape.y + shape.h],
          ]
        : shape.type === "point"
          ? [[shape.x, shape.y]]
          : shape.type === "arrow"
            ? [shape.from, shape.to]
            : shape.points;
    const xs = pts.map((p) => p[0] * canvas.w);
    const ys = pts.map((p) => p[1] * canvas.h);
    return [Math.min(...xs) - margin, Math.max(...xs) + margin, Math.min(...ys) - margin, Math.max(...ys) + margin];
  });
  // Overlap is computed per place and summed
  const overlap = (s: { x: number; y: number }) =>
    boxes.reduce(
      (sum, [x0, x1, y0, y1]) =>
        sum + Math.max(0, Math.min(s.x + label.w, x1) - Math.max(s.x, x0)) * Math.max(0, Math.min(s.y + label.h, y1) - Math.max(s.y, y0)),
      0,
    );
  return spots.reduce((best, s) => (overlap(s) < overlap(best) ? s : best));
}

/**
 * Dims everything outside the rectangles so it is obvious which part is meant. With several rectangles all stay bright: the whole shade is
 * drawn on a separate canvas, each rectangle is cut out of it, and the result is laid over the image
 * (several holes in one path would be painted dark again where two rectangles overlap, because of the even-odd rule)
 */
function dimOutside(g: CanvasRenderingContext2D, shapes: readonly Shape[], w: number, h: number) {
  const rects = shapes.filter((s) => s.type === "rect");
  if (rects.length === 0) return;
  const shade = document.createElement("canvas");
  shade.width = w;
  shade.height = h;
  const sg = shade.getContext("2d")!;
  sg.fillStyle = "rgba(0,0,0,0.38)";
  sg.fillRect(0, 0, w, h);
  for (const r of rects) sg.clearRect(r.x * w, r.y * h, r.w * w, r.h * h);
  g.drawImage(shade, 0, 0);
}

function drawShape(g: CanvasRenderingContext2D, s: Shape, w: number, h: number, line: number, color: string) {
  g.strokeStyle = color;
  g.fillStyle = color;
  g.lineWidth = line;
  g.lineJoin = "round";
  g.lineCap = "round";
  switch (s.type) {
    case "rect":
      // Dimming outside the rectangles was already done together beforehand (dimOutside)
      g.strokeRect(s.x * w, s.y * h, s.w * w, s.h * h);
      break;
    case "point": {
      const r = line * 4;
      g.beginPath();
      g.arc(s.x * w, s.y * h, r, 0, Math.PI * 2);
      g.lineWidth = line;
      g.stroke();
      g.beginPath();
      g.arc(s.x * w, s.y * h, line, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case "arrow": {
      const [x1, y1, x2, y2] = [s.from[0] * w, s.from[1] * h, s.to[0] * w, s.to[1] * h];
      g.beginPath();
      g.moveTo(x1, y1);
      g.lineTo(x2, y2);
      g.stroke();
      const a = Math.atan2(y2 - y1, x2 - x1);
      const head = line * 5;
      g.beginPath();
      g.moveTo(x2, y2);
      g.lineTo(x2 - head * Math.cos(a - 0.45), y2 - head * Math.sin(a - 0.45));
      g.lineTo(x2 - head * Math.cos(a + 0.45), y2 - head * Math.sin(a + 0.45));
      g.closePath();
      g.fill();
      break;
    }
    case "path": {
      // A stroke split into runs: each run starts a new subpath, and runs are not joined
      g.beginPath();
      for (const run of pathRuns(s)) run.forEach(([px, py], i) => (i ? g.lineTo(px * w, py * h) : g.moveTo(px * w, py * h)));
      g.stroke();
      break;
    }
  }
}

/** Capturing a video at a given moment: if the current frame isn't that moment, seek there first and wait for the frame to appear */
export async function seekForCapture(video: HTMLVideoElement, t: number, timeoutMs = 5000): Promise<void> {
  if (Math.abs(video.currentTime - t) < 0.02) return;
  video.pause();
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      video.removeEventListener("seeked", ok);
      video.removeEventListener("error", failed);
      video.removeEventListener("emptied", failed);
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };
    const ok = () => finish();
    const failed = () => finish(new Error("video error"));
    const timer = setTimeout(() => finish(new Error(`seek timeout ${timeoutMs} ms`)), timeoutMs);
    video.addEventListener("seeked", ok);
    video.addEventListener("error", failed);
    video.addEventListener("emptied", failed);
    video.currentTime = t;
  });
}
