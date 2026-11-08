import type { IntlShape } from "react-intl";
import { formatTime, formatTimecode, frameAt } from "@sniptoss/core";

// How video times are shown in the UI (Settings → Annotations, or a click on the playback bar's time): seconds (00:12.500), timecode
// (00:00:12:15) or frame numbers. Timecode and frames need a constant frame rate read from the file; without one, seconds are shown.
// Only the display changes: notes store seconds, and the text for AI always gives seconds plus frames (core's review.ts)

export type TimeFormat = "seconds" | "timecode" | "frames";
export const TIME_FORMATS: readonly TimeFormat[] = ["seconds", "timecode", "frames"];

/** The next format when the time on the playback bar is clicked */
export const nextTimeFormat = (f: TimeFormat): TimeFormat => TIME_FORMATS[(TIME_FORMATS.indexOf(f) + 1) % TIME_FORMATS.length];

/** The format in effect for a video: the chosen one when its frame rate is known and constant, otherwise seconds */
export const formatFor = (chosen: TimeFormat, fps: number | undefined): TimeFormat => (fps ? chosen : "seconds");

/**
 * One moment as a bare clock: 00:12.500 / 00:00:12:15 / 375. hours as in formatTime (the playback bar of a long video keeps its width).
 * A frame number is bare here; where it stands alone, frameText labels it
 */
export function clock(seconds: number, format: TimeFormat, fps: number | undefined, hours = false): string {
  const f = formatFor(format, fps);
  if (f === "seconds" || !fps) return formatTime(seconds, hours);
  const frame = frameAt(seconds, fps);
  return f === "timecode" ? formatTimecode(frame, fps) : String(frame);
}

/** A moment or a range where it stands alone (the note card): frames get their label, "Frame 375" / "Frames 375–450" */
export function timeText(intl: IntlShape, time: { start: number; end?: number }, format: TimeFormat, fps: number | undefined): string {
  if (formatFor(format, fps) === "frames" && fps) {
    const start = String(frameAt(time.start, fps));
    return time.end === undefined
      ? intl.formatMessage({ id: "time.frame" }, { frame: start })
      : intl.formatMessage({ id: "time.frames" }, { start, end: String(frameAt(time.end, fps)) });
  }
  const one = (t: number) => clock(t, format, fps);
  return time.end === undefined ? one(time.start) : `${one(time.start)}–${one(time.end)}`;
}
