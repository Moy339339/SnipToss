import { afterEach, describe, expect, it, vi } from "vitest";
import { SNAPSHOT_MAX_PIXELS, SNAPSHOT_MAX_SIDE, seekForCapture, snapshotScale, timeLabelSpot } from "../src/annotate";

/** A fake video that is enough for seekForCapture: after currentTime is set, the test decides whether to fire seeked / error */
function fakeVideo() {
  const target = new EventTarget();
  let t = 0;
  return Object.assign(target, {
    paused: false,
    pause() {
      this.paused = true;
    },
    get currentTime() {
      return t;
    },
    set currentTime(v: number) {
      t = v;
    },
    fire(type: string) {
      target.dispatchEvent(new Event(type));
    },
  });
}
const asVideo = (v: ReturnType<typeof fakeVideo>) => v as unknown as HTMLVideoElement;

describe("seekForCapture (waits for the video to reach the frame before a snapshot)", () => {
  afterEach(() => vi.useRealTimers());

  it("seeked fires: done", async () => {
    const v = fakeVideo();
    const p = seekForCapture(asVideo(v), 1.5);
    expect(v.currentTime).toBe(1.5);
    expect(v.paused).toBe(true);
    v.fire("seeked");
    await expect(p).resolves.toBeUndefined();
  });

  it("already on that frame: no waiting", async () => {
    const v = fakeVideo();
    v.currentTime = 1.5;
    await expect(seekForCapture(asVideo(v), 1.51)).resolves.toBeUndefined();
  });

  it("video error: gives up instead of waiting forever (otherwise saving would hang)", async () => {
    const v = fakeVideo();
    const p = seekForCapture(asVideo(v), 1.5);
    v.fire("error");
    await expect(p).rejects.toThrow("video error");
  });

  it("never reaches the frame: gives up after a time limit", async () => {
    vi.useFakeTimers();
    const v = fakeVideo();
    const p = seekForCapture(asVideo(v), 1.5, 5000);
    const check = expect(p).rejects.toThrow("seek timeout");
    await vi.advanceTimersByTimeAsync(5000);
    await check;
  });
});

describe("snapshotScale", () => {
  it("scales to the longest side set in Settings and never enlarges a small image", () => {
    expect(snapshotScale(3200, 1800, 1600)).toBe(0.5);
    expect(snapshotScale(800, 600, 1600)).toBe(1);
    expect(snapshotScale(800, 600, 0)).toBe(1);
  });

  it("original size (0) also stays within the canvas limit: a 20,000 × 15,000 image could not be drawn and its snapshot would be saved as 0 bytes", () => {
    const s = snapshotScale(20_000, 15_000, 0);
    expect(Math.round(20_000 * s) * Math.round(15_000 * s)).toBeLessThanOrEqual(SNAPSHOT_MAX_PIXELS);
    expect(Math.round(20_000 * s)).toBeLessThanOrEqual(SNAPSHOT_MAX_SIDE);
    const long = snapshotScale(40_000, 500, 0);
    expect(Math.round(40_000 * long)).toBeLessThanOrEqual(SNAPSHOT_MAX_SIDE);
  });
});

describe("timeLabelSpot (which corner the time label goes in on a video snapshot)", () => {
  // A 1600×900 snapshot, a 160×40 label, 10 / 20 from the edge, marks counted 15 further out
  const spot = (shape: Parameters<typeof timeLabelSpot>[0][number] | undefined, ...more: Parameters<typeof timeLabelSpot>[0]) =>
    timeLabelSpot(shape ? [shape, ...more] : [], { w: 1600, h: 900 }, { w: 160, h: 40 }, { x: 10, y: 20 }, 15);
  const bottomLeft = { x: 10, y: 840 };
  const bottomRight = { x: 1430, y: 840 };
  const topLeft = { x: 10, y: 20 };

  it("bottom left by default, and also when the marks are far away", () => {
    expect(spot(undefined)).toEqual(bottomLeft);
    expect(spot({ type: "rect", x: 0.4, y: 0.2, w: 0.2, h: 0.2 })).toEqual(bottomLeft);
    expect(spot({ type: "point", x: 0.5, y: 0.5 })).toEqual(bottomLeft);
  });

  it("a rectangle in the bottom left: moves to the bottom right so it does not cover the inside of the rectangle", () => {
    expect(spot({ type: "rect", x: 0, y: 0.8, w: 0.2, h: 0.2 })).toEqual(bottomRight);
  });

  it("overlap is not only about the bounding box: a pin's circle and an arrow's head count too (counted margin further out)", () => {
    // The pin's center is 10 pixels from the label's right edge: the center is not inside the label, but the circle is
    expect(spot({ type: "point", x: 180 / 1600, y: 860 / 900 })).toEqual(bottomRight);
    expect(spot({ type: "arrow", from: [0.5, 0.5], to: [0.05, 0.97] })).toEqual(bottomRight);
  });

  it("the whole bottom strip is covered: moves to the top; when all four corners overlap, picks the least overlapped", () => {
    expect(
      spot({
        type: "path",
        points: [
          [0, 0.95],
          [0.5, 0.9],
          [1, 0.95],
        ],
      }),
    ).toEqual(topLeft);
    // One rectangle over the whole frame: all four corners overlap equally, so it stays in the bottom left
    expect(spot({ type: "rect", x: 0, y: 0, w: 1, h: 1 })).toEqual(bottomLeft);
  });

  it("a note with several places: every place counts (ADR-0009); with one in the bottom left and one in the bottom right, it moves to the top", () => {
    expect(spot({ type: "rect", x: 0, y: 0.8, w: 0.2, h: 0.2 }, { type: "rect", x: 0.8, y: 0.8, w: 0.2, h: 0.2 })).toEqual(topLeft);
    // Looking only at the first place would leave it in the bottom right
    expect(spot({ type: "point", x: 0.5, y: 0.5 }, { type: "rect", x: 0, y: 0.8, w: 0.2, h: 0.2 })).toEqual(bottomRight);
  });
});
