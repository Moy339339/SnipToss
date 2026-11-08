// Where the notes' numbers go on the play bar (VideoPlayer). Each number stands above where its note starts; numbers that would overlap
// merge into one stack showing how many notes are there, so every number on the bar can be seen and clicked however many notes there are.
// Pure layout in the bar's own pixels (pre-zoom CSS pixels, like the width ResizeObserver reports)

export interface BadgeNote {
  id: string;
  /** Seconds */
  start: number;
  /** The text on the badge: the note's number in the notes panel */
  text: string;
}

export interface BadgeGroup {
  /** Center of the badge, in pixels from the bar's left end */
  x: number;
  /** One note = its own number; more = a stack (in time order) */
  ids: string[];
}

/** Gap kept between two badges, so they read as two */
export const BADGE_GAP = 2;
/** A number badge: 20 high and at least 20 wide, 4 padding on each side of the digits (11px tabular digits are about 6.2 wide) */
export const badgeWidth = (text: string) => Math.max(20, 8 + 6.2 * text.length);
/** A stack: the stack icon (10) + 4 + the count, 6 padding on each side */
export const stackWidth = (count: number) => 26 + 6.2 * String(count).length;
/** How far a badge may stick out past either end of the bar: the control bar's own margin (8), so a note at 0:00 isn't cut in half */
export const BADGE_OVERHANG = 8;

/** A badge's center, kept so that the badge sticks out past the bar's ends by at most BADGE_OVERHANG */
export const clampBadge = (x: number, half: number, width: number) =>
  Math.min(width - half + BADGE_OVERHANG, Math.max(half - BADGE_OVERHANG, x));

/**
 * Left to right by start time: a badge that would overlap the one before (less than BADGE_GAP apart) joins it. A stack stays where its
 * first note starts; when it grows wider and reaches the badge before it, those merge too. Badges at the ends are pulled in (clampBadge).
 * pinned (the selected note) always keeps its own badge where it starts: the notes before it are laid out up to its left edge and the
 * ones after it from its right edge, so a neighbor that would touch it joins the stack beside it instead of covering it
 */
export function layoutBadges(notes: readonly BadgeNote[], duration: number, width: number, pinned?: string): BadgeGroup[] {
  if (!(duration > 0) || !(width > 0)) return [];
  const pin = pinned === undefined ? undefined : notes.find((n) => n.id === pinned);
  if (!pin) return lay(notes, duration, width, -Infinity, Infinity);
  const half = badgeWidth(pin.text) / 2;
  const x = clampBadge((pin.start / duration) * width, half, width);
  let before = notes.filter((n) => n !== pin && (n.start < pin.start || (n.start === pin.start && n.id < pin.id)));
  let after = notes.filter((n) => n !== pin && !before.includes(n));
  const lo = -BADGE_OVERHANG - 1e-9;
  const hi = width + BADGE_OVERHANG + 1e-9;
  const edge = (g: BadgeGroup, side: 1 | -1) =>
    g.x + side * ((g.ids.length > 1 ? stackWidth(g.ids.length) : badgeWidth(notes.find((n) => n.id === g.ids[0])!.text)) / 2);
  // Near an end there may be no room between the pinned badge and the end: what doesn't fit joins the stack on the other side
  for (let round = 0; ; round++) {
    const left = lay(before, duration, width, -Infinity, x - half - BADGE_GAP);
    const right = lay(after, duration, width, x + half + BADGE_GAP, Infinity);
    const spillLeft = left.length > 0 && edge(left[0], -1) < lo;
    const spillRight = right.length > 0 && edge(right.at(-1)!, 1) > hi;
    if (round >= 2 || (!spillLeft && !spillRight)) return [...left, { x, ids: [pin.id] }, ...right];
    if (spillLeft) {
      const moved = new Set(left[0].ids);
      after = [...after, ...before.filter((n) => moved.has(n.id))];
      before = before.filter((n) => !moved.has(n.id));
    }
    if (spillRight) {
      const moved = new Set(right.at(-1)!.ids);
      before = [...before, ...after.filter((n) => moved.has(n.id))];
      after = after.filter((n) => !moved.has(n.id));
    }
  }
}

/** Lays out notes between two edges (pixels; the badges stay inside them, and stacks squeezed against an edge merge with their neighbor) */
function lay(notes: readonly BadgeNote[], duration: number, width: number, from: number, to: number): BadgeGroup[] {
  const groups: (BadgeGroup & { half: number })[] = [];
  const sorted = [...notes].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  const firstOf = new Map(notes.map((n) => [n.id, n]));
  const widthOf = (g: BadgeGroup) => (g.ids.length > 1 ? stackWidth(g.ids.length) : badgeWidth(firstOf.get(g.ids[0])!.text));
  const place = (g: { x: number; half: number }) => {
    g.x = Math.min(to - g.half, Math.max(from + g.half, clampBadge(g.x, g.half, width)));
  };
  /** Merges the last two groups while they overlap (a group that grew or was pushed may reach the one before it) */
  const settle = () => {
    while (groups.length > 1) {
      const [a, b] = groups.slice(-2);
      if (b.x - b.half >= a.x + a.half + BADGE_GAP) break;
      a.ids.push(...b.ids);
      a.half = widthOf(a) / 2;
      place(a);
      groups.pop();
    }
  };
  for (const n of sorted) {
    const g = { x: (n.start / duration) * width, ids: [n.id], half: badgeWidth(n.text) / 2 };
    place(g);
    const last = groups.at(-1);
    if (last && g.x - g.half < last.x + last.half + BADGE_GAP) {
      last.ids.push(n.id);
      last.half = widthOf(last) / 2;
      place(last);
    } else groups.push(g);
    settle();
  }
  return groups.map(({ x, ids }) => ({ x, ids }));
}
