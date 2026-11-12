import { formatTime, isLightMark, isMarkColor, shapesOf, type Annotation, type Drawing, type Shape } from "@sniptoss/core";
import { dimOutside, drawChecker, drawShape, seekForCapture, snapshotScale, timeLabelSpot } from "./annotate";
import { placeBadges, type BadgeRequest, type Box } from "./handoffBadges";
import { gridColumns } from "./handoffPlan";
import { call, materialUrl, platform, type MaterialEntry } from "./host";
import { isSvg, needsDecode } from "./library";
import { placeColorOf } from "./markColors";
import { hasAlpha, svgNaturalSize, vectorWork, type Size } from "./mediaSize";
import { svgHead } from "./Viewer";

// Copy as Images: the pictures (canvas). A frame is drawn from the item itself with the marks of all its notes and their numbers
// (handoffBadges.ts keeps the numbers apart); several frames can share one picture as a grid. The shell adds the title line and the notes
// area around the picture (HandoffImages), so both platforms get the same image.

/** Something to draw a frame from: an image, or a video sitting at the wanted moment */
export interface FrameSource {
  media: CanvasImageSource;
  /** The size it is drawn at before scaling (an SVG's enlarged size, see mediaSize.ts) */
  size: Size;
  transparent: boolean;
}

export interface FrameSpec {
  source: FrameSource;
  /** number 0 = no circle (timestamped and overall comments have no marks) */
  notes: { annotation: Annotation; number: number }[];
  /** Drawings without notes that show on this frame */
  drawings: readonly Drawing[];
  /** A video frame's moment: written in a corner */
  time?: number;
  markColor: string;
}

/** One cell of a page: a frame drawn now, or a picture that already has its marks (a stored snapshot); caption = which item, on pages that mix items */
export interface Cell {
  frame?: FrameSpec;
  picture?: FrameSource;
  caption?: string;
}

/** The widest a page of several frames gets: more than this is only scaled down again by the AI */
const GRID_WIDTH = 2400;
const GRID_GAP = 12;
const BACKGROUND = "#141416";
/** A small image is enlarged until its long side reaches this (at most 4 times): the marks and numbers need room */
const SMALL_SIDE = 640;

/** The magnification the shell uses for the notes area (HandoffImages.Render): the numbers on the picture match the ones below it */
const textScale = (width: number) => Math.min(2.5, Math.max(1, width / 800));

/** The scale a single frame is drawn at: the snapshot size from Settings, and small images enlarged */
export function frameScale(size: Size, snapshotMax: number): number {
  const down = snapshotScale(size.w, size.h, snapshotMax);
  return down < 1 ? down : Math.min(4, Math.max(1, SMALL_SIDE / Math.max(size.w, size.h)));
}

const centerOf = (s: Shape, w: number, h: number): { x: number; y: number } => {
  const p = s.type === "arrow" ? s.from : s.type === "path" ? s.points[0] : [s.x, s.y];
  return { x: p[0] * w, y: p[1] * h };
};

/**
 * One frame with its marks, drawn scale times its size. Every place of every numbered note gets the note's number in a circle of radius r:
 * on a rectangle's corner, an arrow's tail, a stroke's start, and right above a pinned point (the pin is a dot so what it points at stays
 * visible). dim: with a single marked note, the outside of its rectangles is dimmed like in its snapshot (not in a grid: frames of
 * different brightness side by side would look like the video itself changes); with several notes nothing is dimmed
 */
export function drawFrame(spec: FrameSpec, scale: number, r: number, dim = false): HTMLCanvasElement {
  const { w, h } = spec.source.size;
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const g = canvas.getContext("2d")!;
  if (spec.source.transparent) drawChecker(g, cw, ch);
  g.drawImage(spec.source.media, 0, 0, cw, ch);

  const line = Math.max(3, Math.round(Math.max(cw, ch) / 400));
  const marked = spec.notes.filter((n) => shapesOf(n.annotation).length > 0);
  const all = marked.flatMap((n) => shapesOf(n.annotation));
  if (dim && marked.length === 1) dimOutside(g, all, cw, ch);
  for (const d of spec.drawings) drawShape(g, d.shape, cw, ch, line, isMarkColor(d.shape.color) ? d.shape.color : spec.markColor);

  const dot = line * 1.5;
  const requests: (BadgeRequest & { number: number; color: string })[] = [];
  for (const n of marked)
    shapesOf(n.annotation).forEach((s, i) => {
      const color = placeColorOf(n.annotation, i, spec.markColor);
      const anchor = centerOf(s, cw, ch);
      if (s.type === "point" && n.number > 0) drawPin(g, anchor, dot, color);
      else drawShape(g, s, cw, ch, line, color);
      if (n.number > 0)
        requests.push(
          s.type === "point"
            ? { anchor, prefer: { x: anchor.x, y: anchor.y - r - dot - 2 }, guard: dot + 1, number: n.number, color }
            : { anchor, prefer: anchor, guard: 0, number: n.number, color },
        );
    });

  const keepOut: Box[] = [];
  if (spec.time !== undefined) {
    const label = formatTime(spec.time);
    const size = Math.max(14, Math.round(ch / 36), Math.round(r * 1.1));
    g.font = `600 ${size}px "Cascadia Mono", Consolas, Menlo, monospace`;
    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    const pad = size * 0.5;
    const box = { w: g.measureText(label).width + pad * 2, h: size * 1.6 };
    const at = timeLabelSpot(all, { w: cw, h: ch }, box, { x: pad, y: pad + size * 0.4 }, line * 5);
    g.fillStyle = "rgba(0,0,0,0.7)";
    g.fillRect(at.x, at.y, box.w, box.h);
    g.fillStyle = "#fff";
    g.fillText(label, at.x + pad, at.y + size * 1.15);
    keepOut.push({ ...at, ...box });
  }

  const spots = placeBadges(requests, r, { w: cw, h: ch }, keepOut);
  // Lines first, so no line crosses over a number
  spots.forEach((spot, i) => {
    if (!spot.tail) return;
    for (const [style, width] of [
      ["rgba(0,0,0,0.55)", Math.max(3, r * 0.3)],
      [requests[i].color, Math.max(1.5, r * 0.15)],
    ] as const) {
      g.beginPath();
      g.moveTo(spot.x, spot.y);
      g.lineTo(spot.tail.x, spot.tail.y);
      g.strokeStyle = style;
      g.lineWidth = width;
      g.lineCap = "round";
      g.stroke();
    }
  });
  spots.forEach((spot, i) => drawBadge(g, requests[i].number, requests[i].color, spot.x, spot.y, r));
  return canvas;
}

/** A pinned point: a dot with a ring around it, so it shows on any background */
function drawPin(g: CanvasRenderingContext2D, at: { x: number; y: number }, radius: number, color: string) {
  g.beginPath();
  g.arc(at.x, at.y, radius, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.lineWidth = Math.max(1, radius * 0.3);
  g.strokeStyle = isLightMark(color) ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.8)";
  g.stroke();
}

/** The number: the same solid circle as on the canvas and in the notes area (MarkPainter.DrawBadge in the shell); dark text on a light color */
function drawBadge(g: CanvasRenderingContext2D, number: number, color: string, x: number, y: number, r: number) {
  const light = isLightMark(color);
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  g.lineWidth = (1.5 * r) / 10;
  g.strokeStyle = light ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.8)";
  g.stroke();
  g.fillStyle = light ? "#141416" : "#fff";
  // Two digits still fit inside the circle
  g.font = `600 ${r * (number > 9 ? 1.05 : 1.2)}px "Segoe UI", system-ui, sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(String(number), x, y + r * 0.06);
}

/**
 * A page's picture. One cell: the frame at the snapshot size from Settings. Several: a grid of 2 or 3 columns no wider than GRID_WIDTH,
 * each frame scaled to its column (rows are as tall as their tallest frame), with the item's name above each frame when captions are given
 */
export function drawPage(cells: readonly Cell[], snapshotMax: number): HTMLCanvasElement | undefined {
  const shown = cells.filter((c) => c.frame || c.picture);
  if (shown.length === 0) return undefined;
  const sizeOf = (c: Cell) => (c.frame?.source ?? c.picture!).size;
  if (shown.length === 1 && !shown[0].caption) {
    const c = shown[0];
    const scale = frameScale(sizeOf(c), snapshotMax);
    if (c.frame) return drawFrame(c.frame, scale, 10 * textScale(sizeOf(c).w * scale), true);
    return drawPicture(c.picture!, scale);
  }

  const cols = gridColumns(shown.length);
  const column = Math.floor((GRID_WIDTH - GRID_GAP * (cols - 1)) / cols);
  // No frame is enlarged to fill its column, and a tall one is held to 1.2 times the column width
  const scales = shown.map((c) => Math.min(frameScale(sizeOf(c), snapshotMax), column / sizeOf(c).w, (column * 1.2) / sizeOf(c).h));
  const box = Math.max(...shown.map((c, i) => Math.round(sizeOf(c).w * scales[i])));
  const width = box * cols + GRID_GAP * (cols - 1);
  const s = textScale(width);
  const drawn = shown.map((c, i) =>
    c.frame ? drawFrame(c.frame, scales[i], Math.max(10 * textScale(sizeOf(c).w * scales[i]), 7 * s)) : drawPicture(c.picture!, scales[i]),
  );
  const captioned = shown.some((c) => c.caption);
  const font = Math.round(12 * s);
  const head = captioned ? Math.round(font * 2) : 0;
  const rows: number[] = [];
  drawn.forEach((d, i) => (rows[Math.floor(i / cols)] = Math.max(rows[Math.floor(i / cols)] ?? 0, d.height)));
  const height = rows.reduce((sum, row) => sum + head + row, 0) + GRID_GAP * (rows.length - 1);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const g = canvas.getContext("2d")!;
  g.fillStyle = BACKGROUND;
  g.fillRect(0, 0, width, height);
  let y = 0;
  rows.forEach((row, ri) => {
    for (let ci = 0; ci < cols; ci++) {
      const i = ri * cols + ci;
      if (i >= drawn.length) break;
      const x = ci * (box + GRID_GAP);
      const caption = shown[i].caption;
      if (caption) {
        g.font = `${font}px "Segoe UI", system-ui, sans-serif`;
        g.fillStyle = "#b4b4bc";
        g.textAlign = "left";
        g.textBaseline = "middle";
        g.fillText(fitText(g, caption, box - font), x + font / 2, y + head / 2);
      }
      g.drawImage(drawn[i], x + Math.floor((box - drawn[i].width) / 2), y + head);
    }
    y += head + row + GRID_GAP;
  });
  return canvas;
}

function drawPicture(source: FrameSource, scale: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(source.size.w * scale));
  canvas.height = Math.max(1, Math.round(source.size.h * scale));
  canvas.getContext("2d")!.drawImage(source.media, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** A caption cut to the width with an ellipsis in the middle (the end of a path says the most) */
function fitText(g: CanvasRenderingContext2D, text: string, width: number): string {
  if (g.measureText(text).width <= width) return text;
  for (let keep = text.length - 1; keep > 4; keep--) {
    const head = Math.ceil(keep / 3);
    const cut = `${text.slice(0, head)}…${text.slice(text.length - (keep - head))}`;
    if (g.measureText(cut).width <= width) return cut;
  }
  return text.slice(-4);
}

/** The picture as base64 PNG (no data: prefix); empty when the canvas is too large to draw */
export function pngOf(canvas: HTMLCanvasElement): string {
  const url = canvas.toDataURL("image/png");
  return url.slice(url.indexOf(",") + 1);
}

// ---------- Loading items off screen ----------

/** An image by URL, ready to draw */
async function loadPicture(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  await img.decode();
  return img;
}

/** An image item (the shell converts what WebView2 cannot show, like the canvas does) */
export async function loadImage(entry: MaterialEntry): Promise<FrameSource> {
  let url = materialUrl(entry);
  if (platform !== "mac" && needsDecode(entry.path)) {
    const r = await call("decodeImage", { path: entry.path });
    if ("problem" in r) throw new Error(`image cannot be converted (${r.problem})`);
    url = r.url;
  }
  const img = await loadPicture(url);
  const own = { w: img.naturalWidth, h: img.naturalHeight };
  if (!own.w || !own.h) throw new Error("image has no size");
  const vector = isSvg(entry.path);
  const size = vector ? vectorWork(svgNaturalSize(await svgHead(url), own)) : own;
  return { media: img, size, transparent: vector || hasAlpha(img) };
}

/** A stored snapshot (.sniptoss/snapshots) as a picture */
export async function loadSnapshot(home: string, path: string): Promise<FrameSource> {
  const img = await loadPicture(await call("fileUrl", { home, path }));
  return { media: img, size: { w: img.naturalWidth, h: img.naturalHeight }, transparent: false };
}

/**
 * A video opened off screen (the one on the canvas keeps playing where it is). at() seeks to a moment and returns a still of that frame;
 * close() lets go of the file
 */
export async function openVideo(entry: MaterialEntry, timeoutMs = 15000) {
  const video = document.createElement("video");
  video.crossOrigin = "anonymous";
  video.muted = true;
  video.preload = "auto";
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`video load timeout ${timeoutMs} ms`)), timeoutMs);
    video.addEventListener("loadeddata", () => (clearTimeout(timer), resolve()), { once: true });
    video.addEventListener("error", () => (clearTimeout(timer), reject(new Error("video cannot be loaded"))), { once: true });
    video.src = materialUrl(entry);
  });
  return {
    /** snapshotMax: the snapshot size from Settings; the still is no larger than a frame is ever drawn (a page can hold nine 4K frames) */
    async at(time: number, snapshotMax: number): Promise<FrameSource> {
      await seekForCapture(video, time);
      // A still of this moment: the next seek must not change a frame that is drawn later
      const scale = snapshotScale(video.videoWidth, video.videoHeight, snapshotMax);
      const size = { w: Math.max(1, Math.round(video.videoWidth * scale)), h: Math.max(1, Math.round(video.videoHeight * scale)) };
      const still = document.createElement("canvas");
      still.width = size.w;
      still.height = size.h;
      still.getContext("2d")!.drawImage(video, 0, 0, size.w, size.h);
      return { media: still, size, transparent: false };
    },
    close() {
      video.removeAttribute("src");
      video.load();
    },
  };
}
