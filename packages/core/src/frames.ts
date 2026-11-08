// Frame numbers and timecode for videos with a constant frame rate (material.frame_rate). Frames count from 0 at the start of the video,
// as ffmpeg and code-driven video tools do: frame = floor(seconds × frame rate). Times are still stored in seconds; frames are derived

/**
 * Seconds → frame number (from 0). The small allowance keeps a time that sits exactly on a frame's start (rounded to milliseconds, or off
 * by a floating-point hair) on that frame instead of the one before
 */
export function frameAt(seconds: number, fps: number): number {
  return Math.max(0, Math.floor(seconds * fps + 1e-6));
}

/** 30 → "30", 30000/1001 → "29.97", 24000/1001 → "23.976": at most three decimals, trailing zeros dropped */
export function fpsLabel(fps: number): string {
  return String(Number(fps.toFixed(3)));
}

/** Frame rates that use drop-frame timecode: the NTSC rates 29.97 and 59.94 (two / four frame labels skipped each minute but every tenth) */
function dropFrames(fps: number): number {
  const base = Math.round(fps);
  return Math.abs(fps - base) > 0.001 && base % 30 === 0 ? base / 15 : 0;
}

/**
 * Frame number → SMPTE timecode hh:mm:ss:ff, as editing software shows it. Whole-number rates count ff from 0 to rate − 1; 29.97 and 59.94
 * use drop-frame (written with ; before the frames) so the timecode stays in step with the clock; other fractional rates such as 23.976
 * count as their rounded rate (non-drop, like editing software does)
 */
export function formatTimecode(frame: number, fps: number): string {
  const base = Math.max(1, Math.round(fps));
  const drop = dropFrames(fps);
  let n = Math.max(0, Math.floor(frame));
  if (drop) {
    const perTenMinutes = Math.round(fps * 600);
    const perMinute = base * 60 - drop;
    const tens = Math.floor(n / perTenMinutes);
    const rest = n % perTenMinutes;
    n += drop * 9 * tens + (rest > drop ? drop * Math.floor((rest - drop) / perMinute) : 0);
  }
  const pad = (v: number) => String(v).padStart(2, "0");
  const seconds = Math.floor(n / base);
  return `${pad(Math.floor(seconds / 3600))}:${pad(Math.floor(seconds / 60) % 60)}:${pad(seconds % 60)}${drop ? ";" : ":"}${pad(n % base)}`;
}
