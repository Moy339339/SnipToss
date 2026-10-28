import { afterEach, describe, expect, it, vi } from "vitest";
import { scrubber, scrubStop, wantedTime } from "../src/scrub";

/**
 * A fake video: setting currentTime starts a seek (seeking is set and the "seeking" event is fired a little later, as in a browser), and
 * done() = this seek has finished.
 * seeks records every time that was set on it
 */
function fakeVideo(duration = 180) {
  const v = new EventTarget() as EventTarget & { readyState: number; duration: number; seeking: boolean; currentTime: number };
  const seeks: number[] = [];
  let t = 0;
  Object.assign(v, { readyState: 4, duration, seeking: false });
  Object.defineProperty(v, "currentTime", {
    get: () => t,
    set: (x: number) => {
      t = x;
      v.seeking = true;
      seeks.push(x);
      queueMicrotask(() => v.dispatchEvent(new Event("seeking")));
    },
  });
  const done = async () => {
    await Promise.resolve();
    v.seeking = false;
    v.dispatchEvent(new Event("seeked"));
  };
  return { video: v as unknown as HTMLVideoElement, seeks, done };
}

/** A keyframe every 4 seconds, 100 seconds in all */
const KEYS = Array.from({ length: 25 }, (_, i) => i * 4);

afterEach(() => {
  vi.useRealTimers();
});

describe("scrubStop: where this step of a drag goes", () => {
  it("keyframes unknown: the exact moment", () => {
    expect(scrubStop(undefined, 50, 0, 100, 100, 1)).toBe(50);
    expect(scrubStop([], 50, 0, 100, 100, 1)).toBe(50);
  });

  it("a slow drag: by the time the exact frame is decoded the mouse has not moved half a segment (half of 4 seconds), so the exact frame is used", () => {
    expect(scrubStop(KEYS, 9, 8, 100, 1, 0.5)).toBe(9);
  });

  it("a video that decodes fast gets the exact frame however fast the drag", () => {
    expect(scrubStop(KEYS, 9, 0, 100, 50, 0.03)).toBe(9);
  });

  it("a fast drag and slow decoding: the nearest keyframe is used, landing a little after it (landing exactly on it could, with rounding, start decoding from the previous keyframe)", () => {
    expect(scrubStop(KEYS, 9, 0, 100, 20, 0.5)).toBeCloseTo(8.001, 6);
    expect(scrubStop(KEYS, 11, 0, 100, 20, 0.5)).toBeCloseTo(12.001, 6);
  });

  it("that keyframe is already on screen: no seek yet, wait until the mouse moves further or stops", () => {
    expect(scrubStop(KEYS, 9, 8.001, 100, 20, 0.5)).toBeUndefined();
  });

  it("the last segment (no keyframe after it): counted up to the end, and only the previous keyframe is used", () => {
    expect(scrubStop(KEYS, 99, 0, 100, 20, 0.5)).toBeCloseTo(96.001, 6);
  });
});

describe("scrubber: how seeks happen when dragging the seek bar or holding an arrow key", () => {
  it("an unfinished seek is not interrupted: only the latest target is remembered, and when it finishes it goes straight there (the ones in between are skipped)", async () => {
    const { video, seeks, done } = fakeVideo();
    const s = scrubber(video);
    s.to(10);
    s.to(20);
    s.to(30);
    expect(seeks).toEqual([10]);
    // The playhead, the timecode and the time a note takes are the moment being sought, not the moment the picture is still showing
    expect(wantedTime(video)).toBe(30);
    await done();
    expect(seeks).toEqual([10, 30]);
    await done();
    expect(seeks).toEqual([10, 30]);
    expect(wantedTime(video)).toBe(30);
  });

  it("a fast drag and slow decoding: only keyframes are used (no seek if the nearest one is already on screen); 0.1 seconds after the drag stops it goes to the exact moment", async () => {
    vi.useFakeTimers();
    let now = 0;
    const { video, seeks, done } = fakeVideo(100);
    const s = scrubber(video, () => now);
    s.keyframes = KEYS;
    // Press: it is not yet known how long one decode takes, so it goes to the exact moment; this one took 500ms
    s.to(10, true);
    now = 500;
    await done();
    // Start dragging: 1 second every 10ms (100 seconds per second). The first step is still treated as slow (the drag has just started and
    // its speed is unknown), so it goes to the exact 11
    for (let i = 1; i <= 50; i++) {
      now = 1000 + i * 10;
      s.to(10 + i, true);
    }
    expect(seeks).toEqual([10, 11]);
    // When 11 finishes the mouse is already at 60: the exact frame would take another 0.5 seconds, in which the mouse moves another 50
    // seconds, so the keyframe at 60 is used
    await done();
    expect(seeks.at(-1)).toBeCloseTo(60.001, 6);
    now += 10;
    s.to(61, true);
    await done();
    // The keyframe nearest 61 is still 60, which is already on screen: no seek
    expect(seeks).toHaveLength(3);
    now += 10;
    s.to(63, true);
    expect(seeks.at(-1)).toBeCloseTo(64.001, 6);
    await done();
    // It stops at 63
    now += 120;
    vi.advanceTimersByTime(120);
    expect(seeks.at(-1)).toBe(63);
    await done();
    expect(seeks).toHaveLength(5);
    expect(wantedTime(video)).toBe(63);
  });

  it("a click on the seek bar jumps far and decodes slowly: a keyframe first (so there is a picture at once), then the exact moment", async () => {
    let now = 0;
    const { video, seeks, done } = fakeVideo(100);
    const s = scrubber(video, () => now);
    s.keyframes = KEYS;
    s.to(10, true);
    now = 500;
    await done();
    s.release();
    now = 5000;
    s.to(50, true);
    expect(seeks.at(-1)).toBeCloseTo(48.001, 6);
    s.release();
    await done();
    expect(seeks.at(-1)).toBe(50);
  });

  it("on release: if it is on a keyframe it goes at once to the exact moment", async () => {
    let now = 0;
    const { video, seeks, done } = fakeVideo(100);
    const s = scrubber(video, () => now);
    s.keyframes = KEYS;
    s.to(10, true);
    now = 500;
    await done();
    for (let i = 1; i <= 50; i++) {
      now = 1000 + i * 10;
      s.to(10 + i, true);
    }
    await done();
    expect(seeks.at(-1)).toBeCloseTo(60.001, 6);
    s.to(61, true);
    s.release();
    await done();
    expect(seeks.at(-1)).toBe(61);
  });

  it("on release while still seeking the exact frame of another moment (slow): it does not wait and goes straight to the moment of release", () => {
    let now = 0;
    const { video, seeks } = fakeVideo(100);
    const s = scrubber(video, () => now);
    s.keyframes = KEYS;
    s.to(0.5, true);
    now = 100;
    s.to(1, true);
    expect(seeks).toEqual([0.5]);
    s.release();
    expect(seeks).toEqual([0.5, 1]);
  });

  it("when the drag stops while still seeking the exact frame of another moment: switches over after 0.1 seconds", () => {
    vi.useFakeTimers();
    let now = 0;
    const { video, seeks } = fakeVideo(100);
    const s = scrubber(video, () => now);
    s.to(0.5, true);
    now = 100;
    s.to(1, true);
    now = 220;
    vi.advanceTimersByTime(120);
    expect(seeks).toEqual([0.5, 1]);
  });

  it("dragging slowly (looking for a particular frame): always goes to the exact moment", async () => {
    let now = 0;
    const { video, seeks, done } = fakeVideo(100);
    const s = scrubber(video, () => now);
    s.keyframes = KEYS;
    for (const t of [0.5, 1, 1.5, 2]) {
      s.to(t, true);
      now += 500;
      await done();
    }
    expect(seeks).toEqual([0.5, 1, 1.5, 2]);
  });

  it("already at that moment: no second seek", () => {
    const { video, seeks } = fakeVideo();
    scrubber(video).to(0);
    expect(seeks).toEqual([]);
  });

  it("a seek from elsewhere (clicking a note card, jumping before a snapshot): the other one wins and the earlier target is dropped", async () => {
    const { video, seeks, done } = fakeVideo();
    const s = scrubber(video);
    s.to(10);
    s.to(20);
    video.currentTime = 5;
    await done();
    expect(seeks).toEqual([10, 5]);
    expect(wantedTime(video)).toBe(5);
    // Dragging afterwards works as usual
    s.to(40);
    expect(seeks).toEqual([10, 5, 40]);
  });

  it("a drag starting while another seek is in progress: when the other seek finishes it continues to where the drag is", async () => {
    const { video, seeks, done } = fakeVideo();
    const s = scrubber(video);
    video.currentTime = 5;
    await Promise.resolve();
    s.to(40);
    expect(seeks).toEqual([5]);
    await done();
    expect(seeks).toEqual([5, 40]);
  });

  it("the file is replaced in place and reloaded: a half-finished seek is forgotten", () => {
    const { video, seeks } = fakeVideo();
    const s = scrubber(video);
    s.to(10);
    s.to(20);
    video.dispatchEvent(new Event("emptied"));
    expect(wantedTime(video)).toBe(10);
    expect(seeks).toEqual([10]);
  });

  it("not loaded yet: handed straight to the browser (it seeks by itself once loaded) and not remembered", () => {
    const { video, seeks } = fakeVideo();
    Object.assign(video, { readyState: 0 });
    scrubber(video).to(12);
    expect(seeks).toEqual([12]);
    expect(wantedTime(video)).toBe(12);
  });
});
