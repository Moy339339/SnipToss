// Reads two things about the video track from the moov of an MP4 / MOV:
// - The frame rate (stts records the duration of each frame). The browser does not expose the frame rate, and estimating it only from the time difference between adjacent frames during playback, with 30 until estimated, would make a 60fps video that was never played step two frames at a time.
// - The moments of the keyframes (stss). When the progress bar is dragged fast, it first seeks to a keyframe (decoding only one frame), see scrub.ts.
// When they cannot be read (WebM, an odd file) they are absent, and the player falls back to estimating the frame rate during playback and seeking only to exact moments while dragging.

/** Read the [start, end) range of the file */
export type ReadRange = (start: number, end: number) => Promise<Uint8Array>;

export interface VideoHeader {
  fps?: number;
  /** The keyframe moments (seconds, ascending). Absent when there is no stss (every frame is a keyframe) or it cannot be read */
  keyframes?: number[];
}

/** A moov larger than this is not read (a normal video of tens of seconds has a moov of only tens of KB, and one of several hours only a few MB) */
const MAX_MOOV = 64 * 1024 * 1024;
/** Beyond this many frames the keyframes are not computed (a 60fps video would be over forty hours long) */
const MAX_SAMPLES = 10_000_000;

/**
 * Item URL (the shell's virtual host, which supports Range) → frame rate and keyframes; whichever cannot be read is absent.
 * The item is on another host name, so Content-Range is not available cross-origin (no Expose-Headers), hence it does not rely on the file size: it skips from box to box and stops when it reaches the end
 */
export async function videoHeader(url: string): Promise<VideoHeader> {
  const read: ReadRange = async (start, end) => {
    const res = await fetch(url, { headers: { Range: `bytes=${start}-${end - 1}` } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = new Uint8Array(await res.arrayBuffer());
    // Range is not supported and the whole file was returned: slice it ourselves
    return res.status === 200 ? body.subarray(start, end) : body;
  };
  try {
    return await videoHeaderFrom(read);
  } catch {
    return {};
  }
}

/** Skip through the top-level boxes one by one to find the moov (without reading mdat), then read it in full. If size is unknown, keep reading until nothing more can be read */
export async function videoHeaderFrom(read: ReadRange, size = Infinity): Promise<VideoHeader> {
  let pos = 0;
  for (let n = 0; pos + 8 <= size && n < 64; n++) {
    const h = await read(pos, Math.min(size, pos + 16));
    const box = header(h, 0, size - pos);
    if (!box) return {};
    if (box.type === "moov") {
      if (box.size > MAX_MOOV) return {};
      const moov = (await read(pos, pos + box.size)).subarray(box.header);
      return { fps: frameRateOfMoov(moov), keyframes: keyframesOfMoov(moov) };
    }
    pos += box.size;
  }
  return {};
}

/** The mdia of the video track (hdlr is vide) and the trak it is in */
function videoTracks(moov: Uint8Array) {
  const out: { trak: Uint8Array; mdia: Uint8Array; stbl: Uint8Array; timescale: number }[] = [];
  for (const trak of boxes(moov, "trak")) {
    const mdia = boxes(trak, "mdia")[0];
    if (!mdia) continue;
    const hdlr = boxes(mdia, "hdlr")[0];
    if (!hdlr || text(hdlr, 8, 4) !== "vide") continue;
    const mdhd = boxes(mdia, "mdhd")[0];
    const stbl = boxes(boxes(mdia, "minf")[0] ?? new Uint8Array(), "stbl")[0];
    if (!mdhd || !stbl) continue;
    const timescale = u32(mdhd, mdhd[0] === 1 ? 20 : 12);
    if (timescale) out.push({ trak, mdia, stbl, timescale });
  }
  return out;
}

/** The contents of the moov (without the moov box's own header) → the video track's frame rate */
export function frameRateOfMoov(moov: Uint8Array): number | undefined {
  for (const { stbl, timescale } of videoTracks(moov)) {
    const stts = boxes(stbl, "stts")[0];
    if (!stts) continue;
    // Each entry is "this many consecutive frames, each this long": take the frame duration with the most frames (a few odd frames at the start or end do not count)
    const count = u32(stts, 4);
    let best = { frames: 0, delta: 0 };
    for (let i = 0; i < count && 8 + i * 8 + 8 <= stts.length; i++) {
      const frames = u32(stts, 8 + i * 8);
      const delta = u32(stts, 12 + i * 8);
      if (frames > best.frames && delta > 0) best = { frames, delta };
    }
    if (!best.delta) continue;
    const fps = timescale / best.delta;
    if (fps >= 1 && fps <= 1000) return fps;
  }
  return undefined;
}

/**
 * The contents of the moov → the display moments of the video track's keyframes (seconds, ascending).
 * Decode times are accumulated frame by frame from stts, display times add the ctts offset (when there are B-frames), and finally everything is shifted by the edit list (elst):
 * the browser's timeline counts 0 from the moment the edit list specifies (commonly to absorb the delay of the two frames passed over for B-frames), and an empty stretch at the front (media_time = -1) pushes everything later
 */
export function keyframesOfMoov(moov: Uint8Array): number[] | undefined {
  const mvhd = boxes(moov, "mvhd")[0];
  const movieScale = mvhd ? u32(mvhd, mvhd[0] === 1 ? 20 : 12) : 0;
  for (const { trak, stbl, timescale } of videoTracks(moov)) {
    const stts = boxes(stbl, "stts")[0];
    const stss = boxes(stbl, "stss")[0];
    // No stss = every frame is a keyframe, so seeking anywhere decodes just one frame and this is unnecessary
    if (!stts || !stss) return undefined;
    const ctts = boxes(stbl, "ctts")[0];
    const edit = editOffset(boxes(boxes(trak, "edts")[0] ?? new Uint8Array(), "elst")[0], movieScale);

    const syncCount = Math.min(u32(stss, 4), (stss.length - 8) / 4);
    const sttsCount = Math.min(u32(stts, 4), (stts.length - 8) / 8);
    const cttsCount = ctts ? Math.min(u32(ctts, 4), (ctts.length - 8) / 8) : 0;
    if (syncCount < 1 || sttsCount < 1) return undefined;

    const out: number[] = [];
    let sync = 0;
    let nextSync = u32(stss, 8);
    // Both tables are "this many consecutive frames, each this much": walk along with the frame number and move to the next entry at the end of one
    let sttsAt = 0;
    let sttsLeft = u32(stts, 8);
    let cttsAt = 0;
    let cttsLeft = cttsCount ? u32(ctts!, 8) : 0;
    let dts = 0;
    for (let sample = 1; sample <= MAX_SAMPLES && sync < syncCount; sample++) {
      // When one entry is used up (or it says 0 frames), move to the next
      while (sttsLeft === 0 && ++sttsAt < sttsCount) sttsLeft = u32(stts, 8 + sttsAt * 8);
      if (sttsAt >= sttsCount) break;
      while (cttsLeft === 0 && cttsAt + 1 < cttsCount) cttsLeft = u32(ctts!, 8 + ++cttsAt * 8);
      if (sample === nextSync) {
        // ctts version 0 is defined as unsigned, but some writers store negative values; read it as signed (a real offset of 2^31 or more would mean the file is not normal)
        const offset = cttsCount ? s32(ctts!, 12 + cttsAt * 8) : 0;
        const t = (dts + offset - edit.shift) / timescale + edit.delay;
        if (Number.isFinite(t)) out.push(Math.max(0, t));
        nextSync = ++sync < syncCount ? u32(stss, 8 + sync * 4) : 0;
      }
      dts += u32(stts, 12 + sttsAt * 8);
      sttsLeft--;
      if (cttsLeft > 0) cttsLeft--;
    }
    return out.length ? out.sort((a, b) => a - b) : undefined;
  }
  return undefined;
}

/**
 * Edit list → how the timeline shifts: shift = from which moment of the track (in the track's own time unit) playback starts, delay = how many seconds are left empty at the start.
 * Only the first entry that really plays content is considered (later edits are not needed here)
 */
function editOffset(elst: Uint8Array | undefined, movieScale: number): { shift: number; delay: number } {
  const none = { shift: 0, delay: 0 };
  if (!elst || elst.length < 8) return none;
  const v1 = elst[0] === 1;
  const count = u32(elst, 4);
  const entry = v1 ? 20 : 12;
  let delay = 0;
  for (let i = 0, at = 8; i < count && at + entry <= elst.length; i++, at += entry) {
    const duration = v1 ? u32(elst, at) * 2 ** 32 + u32(elst, at + 4) : u32(elst, at);
    const mediaTime = v1 ? s32(elst, at + 8) * 2 ** 32 + u32(elst, at + 12) : s32(elst, at + 4);
    if (mediaTime === -1) {
      if (movieScale) delay += duration / movieScale;
      continue;
    }
    return { shift: mediaTime, delay };
  }
  return { shift: 0, delay };
}

interface Header {
  type: string;
  /** How long the whole box is (including the header) */
  size: number;
  /** How long the header is: 8, or 16 for a large box */
  header: number;
}

/** A box header: length + type; length 1 = a 64-bit length follows, 0 = it runs to the end of the file (rest) */
function header(b: Uint8Array, at: number, rest: number): Header | undefined {
  if (at + 8 > b.length) return undefined;
  let size = u32(b, at);
  let head = 8;
  if (size === 1) {
    if (at + 16 > b.length) return undefined;
    size = u32(b, at + 8) * 2 ** 32 + u32(b, at + 12);
    head = 16;
  } else if (size === 0) size = rest;
  if (size < head) return undefined;
  return { type: text(b, at + 4, 4), size, header: head };
}

/** The contents (without the box header) of all boxes named type inside b */
function boxes(b: Uint8Array, type: string): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let at = 0; at + 8 <= b.length;) {
    const h = header(b, at, b.length - at);
    if (!h) break;
    if (h.type === type) out.push(b.subarray(at + h.header, Math.min(b.length, at + h.size)));
    at += h.size;
  }
  return out;
}

const s32 = (b: Uint8Array, at: number) => (b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3];
const u32 = (b: Uint8Array, at: number) => s32(b, at) >>> 0;
const text = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
