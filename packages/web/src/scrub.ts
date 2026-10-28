// How a video seeks while the progress bar is dragged or an arrow key is held (used by VideoPlayer).
// Setting currentTime directly on every step lets a new step interrupt the previous one before it has finished decoding: no frame appears while dragging, only after stopping
// (a 4K video with sparse keyframes needs a few more tenths of a second after stopping). So:
// - while the previous seek is unfinished, only the latest target is remembered and visited once it finishes: the picture updates after every completed seek
// - seeking to the exact moment must decode from the previous keyframe, which takes a few tenths of a second for a large video with sparse keyframes. When dragging fast, by the time the exact frame is decoded the mouse has moved on by more than half a segment
//   (between two keyframes), so that frame is already stale: then only the keyframe is given (one frame to decode, fast), and the picture keeps up with the hand.
//   Dragging slowly to find a frame, or with a video that decodes fast, is always exact; when the hand stops or releases, it goes to the exact moment

/** Where it is seeking to; absent once it has arrived. Code outside the player that asks for "the current moment" honors it too (the picture may lag a bit behind when writing a note or placing a right-click) */
const wanted = new WeakMap<HTMLVideoElement, number>();

/** The video's "current moment": if it is seeking to some moment, that moment (the playhead and timecode are already there), otherwise currentTime */
export const wantedTime = (v: HTMLVideoElement) => wanted.get(v) ?? v.currentTime;

/** Two moments count as the same: the currentTime read back from the browser is rounded to microseconds */
const SAME = 5e-4;
/** When seeking to a keyframe, land a little after it: landing exactly on it, a rounding difference would decode from the previous keyframe (slow again) */
const PAST_KEYFRAME = 1e-3;
/** The mouse not moving for this long (milliseconds) counts as stopped: go to the exact moment */
const STILL = 100;
/** Drag speed is computed over this recent period (milliseconds) */
const TRAIL = 150;

/** Seeking to an exact moment taking longer than this (seconds) counts as slow decoding */
const SLOW_EXACT = 0.15;

/**
 * Where this step of a drag goes. Returns the moment to seek to: t itself (the exact moment) or the nearest keyframe; undefined = do not seek yet
 * (the nearest keyframe is already on screen, so wait for the mouse to move further or stop).
 * speed: how many video seconds the target moment changes per second; exactCost: how many seconds seeking to an exact moment takes (measured).
 * The keyframe is given only when, by the time the exact frame is decoded, the mouse has moved past more than half of the segment containing t (between the keyframes before and after);
 * a long jump (a click on the progress bar) with slow decoding also gives the keyframe first, so a picture shows at once, and the exact moment follows
 */
export function scrubStop(
  keyframes: readonly number[] | undefined,
  t: number,
  shown: number,
  duration: number,
  speed: number,
  exactCost: number,
): number | undefined {
  if (!keyframes?.length) return t;
  // a = the last keyframe at or before t, b = the first one after (if none, count a segment up to the end)
  let lo = 0;
  let hi = keyframes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  const a = keyframes[lo - 1];
  if (a === undefined) return t;
  const next = keyframes[lo];
  const b = next ?? duration;
  const half = (b - a) / 2;
  const late = speed * exactCost > half || (exactCost > SLOW_EXACT && Math.abs(t - shown) > half);
  if (!(b > a) || !late) return t;
  const k = Math.min((next !== undefined && next - t < t - a ? next : a) + PAST_KEYFRAME, duration);
  return Math.abs(k - shown) < SAME ? undefined : k;
}

export interface Scrubber {
  /** The keyframe moments (read by videoHeader.ts); without them only exact moments are sought */
  keyframes?: readonly number[];
  /** Seek to t. coarse = a drag is in progress (when dragging fast only the keyframe may be given) */
  to(t: number, coarse?: boolean): void;
  /** Release: the drag is over, and a seek that stopped on a keyframe goes on to the exact moment */
  release(): void;
  dispose(): void;
}

/** clock is replaced only by tests */
export function scrubber(v: HTMLVideoElement, clock = () => performance.now()): Scrubber {
  /** What was last really set on currentTime; when it was set and whether it was the exact moment */
  let issued: number | undefined;
  let issuedAt = 0;
  let issuedExact = false;
  /** How long seeking to an exact moment takes (milliseconds, a weighted average of the last few); 0 before it has been measured (treated as fast) */
  let exactCost = 0;
  let coarse = false;
  /** The target moments of the last TRAIL milliseconds, used to compute the drag speed */
  const trail: { at: number; t: number }[] = [];
  let stopTimer: ReturnType<typeof setTimeout> | undefined;

  const speed = () => {
    const last = trail.at(-1);
    if (!last || trail.length < 2 || clock() - last.at > STILL) return 0;
    return Math.abs(last.t - trail[0].t) / (Math.max(1, last.at - trail[0].at) / 1000);
  };
  const go = () => {
    const t = wanted.get(v);
    if (t === undefined) return;
    const dest = coarse ? scrubStop(s.keyframes, t, v.currentTime, v.duration || 0, speed(), exactCost / 1000) : t;
    // The nearest keyframe is already on screen: wait for the mouse to move further; when the hand stops, stopTimer adds the exact moment
    if (dest === undefined) return;
    if (dest === t && Math.abs(v.currentTime - t) < SAME) {
      wanted.delete(v);
      return;
    }
    issued = dest;
    issuedAt = clock();
    issuedExact = dest === t;
    v.currentTime = dest;
  };
  /** Something else seeked (a click on a note card, or a jump to that moment before a screenshot): follow it and drop the earlier target. Later dragging and key presses seek as usual */
  const onSeeking = () => {
    if (issued === undefined || Math.abs(v.currentTime - issued) >= SAME) wanted.delete(v);
  };
  const onSeeked = () => {
    if (issuedExact && issued !== undefined && Math.abs(v.currentTime - issued) < SAME) {
      const ms = clock() - issuedAt;
      exactCost = exactCost ? exactCost * 0.6 + ms * 0.4 : ms;
    }
    if (!v.seeking) go();
  };
  /**
   * Release or stop: go to the exact moment. If the seek in progress is the exact frame of another moment (slow), do not wait for it and switch over directly (only this once, so it never keeps interrupting);
   * if it is seeking to a keyframe (fast), wait for it to land, so a click on the progress bar shows a picture at once
   */
  const settle = () => {
    if (!v.seeking || issuedExact) go();
  };
  /** The file was replaced in place and reloaded, or errored: a half-finished seek will never get seeked, so do not keep remembering it */
  const drop = () => wanted.delete(v);
  v.addEventListener("seeking", onSeeking);
  v.addEventListener("seeked", onSeeked);
  v.addEventListener("emptied", drop);
  v.addEventListener("error", drop);

  const s: Scrubber = {
    to(t, rough = false) {
      // Not loaded yet (no duration): the browser remembers it and jumps there after loading, and does not fire seeked either
      if (v.readyState === 0) {
        v.currentTime = t;
        return;
      }
      const now = clock();
      if (trail.at(-1)?.t !== t) trail.push({ at: now, t });
      while (trail.length > 2 && now - trail[0].at > TRAIL) trail.shift();
      wanted.set(v, t);
      coarse = rough;
      clearTimeout(stopTimer);
      // The drag stopped and stayed there: the picture may still be a keyframe, so add the exact moment
      if (rough) stopTimer = setTimeout(settle, STILL + 10);
      if (!v.seeking) go();
    },
    release() {
      coarse = false;
      clearTimeout(stopTimer);
      trail.length = 0;
      settle();
    },
    dispose() {
      clearTimeout(stopTimer);
      v.removeEventListener("seeking", onSeeking);
      v.removeEventListener("seeked", onSeeked);
      v.removeEventListener("emptied", drop);
      v.removeEventListener("error", drop);
      drop();
    },
  };
  return s;
}
