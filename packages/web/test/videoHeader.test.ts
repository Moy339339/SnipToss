import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { videoHeaderFrom } from "../src/videoHeader";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));

/** Reads the file in ranges and records which ranges were read (mdat must not be read in whole) */
function reader(bytes: Uint8Array) {
  const reads: [number, number][] = [];
  return {
    reads,
    read: async (start: number, end: number) => {
      reads.push([start, end]);
      return bytes.subarray(start, end);
    },
  };
}

describe("videoHeaderFrom: reading the frame rate from the moov of an MP4 / MOV", () => {
  it("60fps, moov at the front (faststart)", async () => {
    const f = fixture("60fps-faststart.mp4");
    expect((await videoHeaderFrom(reader(f).read, f.length)).fps).toBeCloseTo(60, 6);
  });

  it("29.97fps, moov at the end of the file: skips over mdat and does not read it in whole", async () => {
    const f = fixture("29.97fps-moov-at-end.mp4");
    const r = reader(f);
    expect((await videoHeaderFrom(r.read, f.length)).fps).toBeCloseTo(30000 / 1001, 6);
    // Only the box headers (16 bytes) and moov are read: the big mdat range is not
    const big = r.reads.filter(([a, b]) => b - a > 16);
    expect(big).toHaveLength(1);
    expect(r.reads.at(-1)![1]).toBe(f.length);
  });

  it("WebM (not MP4): nothing can be read, so nothing is returned", async () => {
    const f = fixture("24fps.webm");
    expect(await videoHeaderFrom(reader(f).read, f.length)).toEqual({});
  });

  it("the file size is unknown (Content-Range is not available cross-origin): still read", async () => {
    const f = fixture("29.97fps-moov-at-end.mp4");
    expect((await videoHeaderFrom(reader(f).read)).fps).toBeCloseTo(30000 / 1001, 6);
    const w = fixture("24fps.webm");
    expect(await videoHeaderFrom(reader(w).read)).toEqual({});
  });

  it("a broken or empty file: nothing is returned and nothing throws", async () => {
    expect(await videoHeaderFrom(reader(new Uint8Array([0, 0, 0, 1, 1, 2, 3])).read, 7)).toEqual({});
    expect(await videoHeaderFrom(reader(new Uint8Array()).read, 0)).toEqual({});
    const junk = new Uint8Array(64).fill(0xff);
    expect(await videoHeaderFrom(reader(junk).read, junk.length)).toEqual({});
  });
});

describe("videoHeaderFrom: keyframe times (a drag of the seek bar jumps to keyframes first)", () => {
  it("unevenly spaced keyframes with B-frames (presentation times need ctts and the edit list): the same as ffprobe reads", async () => {
    // ffmpeg -f lavfi -i testsrc2=size=64x36:rate=60:duration=3 -c:v libx264 -bf 3 -g 1000 -sc_threshold 0
    //   -force_key_frames 0,0.4,1.25,2.1; ffprobe -skip_frame nokey reads 0 / 0.4 / 1.25 / 2.1
    const f = fixture("60fps-keyframes.mp4");
    const h = await videoHeaderFrom(reader(f).read, f.length);
    expect(h.fps).toBeCloseTo(60, 6);
    expect(h.keyframes).toHaveLength(4);
    [0, 0.4, 1.25, 2.1].forEach((t, i) => expect(h.keyframes![i]).toBeCloseTo(t, 6));
  });

  it("only one keyframe, at the start", async () => {
    const f = fixture("29.97fps-moov-at-end.mp4");
    expect((await videoHeaderFrom(reader(f).read, f.length)).keyframes).toEqual([0]);
  });
});
