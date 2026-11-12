import { sectionOf, type HandoffMaterial } from "@sniptoss/core";

// Copy as Images: which notes go into which image (pure; drawing is in handoffFrames.ts).
// Notes on the same frame share one image: an image item is one frame, a video has one frame per moment noted. When there are more frames
// than the limit on images (web-based AI accepts about 10 per message), several frames are laid out in a grid on one image.

/** At most this many notes on one frame: beyond it the frame is repeated with the rest (numbers that crowd each other are misread) */
export const NOTES_PER_IMAGE = 12;

/** How many frames a grid image can hold, tried in this order */
export const GRID_SIZES = [2, 4, 6, 9] as const;

export type PlanNote = HandoffMaterial["items"][number];

/** One picture and the notes on it */
export interface PlanUnit {
  /** Which handed-over group (item) it belongs to: an index into the list */
  group: number;
  /**
   * frame: drawn now from the item (all marks with their numbers); snapshot: the stored snapshot of the first note that has one (notes on
   * an earlier version, items that are gone, a video with only overall comments); text: no picture (folder comments)
   */
  kind: "frame" | "snapshot" | "text";
  /** The moment of a video frame, in seconds */
  time?: number;
  notes: PlanNote[];
}

export interface Plan {
  /** Each page becomes one image */
  pages: PlanUnit[][];
  /** Even at the largest grid there are more images than the limit */
  over: boolean;
}

const sectionOfNote = (n: PlanNote) => n.section ?? sectionOf(n.annotation);

/** The pictures of one group, in the order they are handed over */
function unitsOf(g: HandoffMaterial, group: number, each: boolean): PlanUnit[] {
  if (g.material.kind === "folder")
    return each ? g.items.map((n) => ({ group, kind: "text", notes: [n] })) : [{ group, kind: "text", notes: g.items }];
  const alone = (n: PlanNote): PlanUnit => ({ group, kind: "snapshot", notes: [n] });
  if (each || g.missing) return g.items.map(alone);

  const now = g.items.filter((n) => sectionOfNote(n) !== "earlier");
  const earlier = g.items.filter((n) => sectionOfNote(n) === "earlier");
  const overall = now.filter((n) => sectionOfNote(n) === "overall");
  const units: PlanUnit[] = [];
  if (g.material.kind === "video") {
    // One frame per moment: marks on that frame first (in number order), then the timestamped comments of that moment
    const byTime = new Map<number, PlanNote[]>();
    for (const n of now) {
      const t = n.annotation.anchor.time?.start;
      if (sectionOfNote(n) === "overall") continue;
      if (t === undefined) units.push(alone(n));
      else byTime.set(Math.round(t * 1000), [...(byTime.get(Math.round(t * 1000)) ?? []), n]);
    }
    const frames = [...byTime].sort((a, b) => a[0] - b[0]);
    const rank = (n: PlanNote) => (sectionOfNote(n) === "marked" ? 0 : 1);
    units.unshift(
      ...frames.map(([, notes]): PlanUnit => ({
        group,
        kind: "frame",
        time: notes[0].annotation.anchor.time!.start,
        notes: [...notes].sort((a, b) => rank(a) - rank(b) || a.index - b.index),
      })),
    );
    // Overall comments have no moment: they ride on the first image; with nothing else, the picture is the snapshot stored with the first one
    if (overall.length) {
      if (units.length) units[0] = { ...units[0], notes: [...units[0].notes, ...overall] };
      else units.push({ group, kind: "snapshot", notes: overall });
    }
  } else if (now.length) units.push({ group, kind: "frame", notes: now });
  return [...units, ...earlier.map(alone)];
}

/** A picture with too many notes is repeated, each time with an even share of them */
function split(unit: PlanUnit): PlanUnit[] {
  const parts = Math.ceil(unit.notes.length / NOTES_PER_IMAGE);
  if (parts <= 1) return [unit];
  const size = Math.ceil(unit.notes.length / parts);
  return Array.from({ length: parts }, (_, i) => ({ ...unit, notes: unit.notes.slice(i * size, (i + 1) * size) }));
}

/** Consecutive pictures share a page while it has room: at most cells pictures (text takes no cell) and at most cap notes */
function pack(units: PlanUnit[], cells: number, cap: number): PlanUnit[][] {
  const pages: PlanUnit[][] = [];
  let used = 0;
  let notes = 0;
  for (const u of units) {
    const cell = u.kind === "text" ? 0 : 1;
    const page = pages[pages.length - 1];
    if (!page || used + cell > cells || notes + u.notes.length > cap) {
      pages.push([u]);
      used = cell;
      notes = u.notes.length;
    } else {
      page.push(u);
      used += cell;
      notes += u.notes.length;
    }
  }
  return pages;
}

/**
 * Lay the notes out into images. each = one image per note (the stored snapshots, as before 1.4); otherwise notes on the same frame share
 * an image. max = the most images wanted (0 = no limit): with more frames than that, 2, 4, 6 or 9 frames share an image, the smallest grid
 * that fits, first keeping each image within NOTES_PER_IMAGE notes and giving that up only when nothing else fits
 */
export function planPages(list: readonly HandoffMaterial[], opts: { each: boolean; max: number }): Plan {
  const units = list.flatMap((g, i) => unitsOf(g, i, opts.each)).flatMap(split);
  const single = units.map((u) => [u]);
  if (opts.each || opts.max <= 0 || units.length <= opts.max) return { pages: single, over: false };
  for (const cap of [NOTES_PER_IMAGE, Infinity])
    for (const cells of GRID_SIZES) {
      const pages = pack(units, cells, cap);
      if (pages.length <= opts.max) return { pages, over: false };
    }
  return { pages: pack(units, GRID_SIZES[GRID_SIZES.length - 1], Infinity), over: true };
}

/** Columns of the grid for this many frames on a page: 1, 2 (up to 4 frames) or 3 */
export const gridColumns = (frames: number) => (frames <= 1 ? 1 : frames <= 4 ? 2 : 3);
