import { useEffect, useRef } from "react";
import { workSize } from "./mediaSize";
import { usePrefs } from "./prefs";

/** Long side of the small image in pixels: it is blurred after scaling up, so a few dozen pixels are enough and drawing it costs almost nothing */
const LONG_SIDE = 64;
/** Fastest refresh interval during video playback (ms); the backdrop is blurred, so refreshing more often shows no difference */
const INTERVAL = 100;

/**
 * Ambient backdrop around the canvas: shrinks the current frame to a tiny image, stretches it over the canvas area, then blurs and
 * darkens it (like video sites showing a portrait video on a desktop). A portrait video or a long image that does not fill the
 * window no longer leaves a large plain gray area. Settings can switch back to a solid color.
 * Sits at the very bottom of the canvas area and ignores the mouse; fades in only after the first frame is drawn, so it never flashes.
 */
export function Ambient(props: {
  source: HTMLImageElement | HTMLVideoElement | null;
  /**
   * The item's size, a fresh object after every load: when the file is replaced in place (an agent re-exports it) the media element
   * stays the same one, so this is how the backdrop knows to redraw from the new image and recompute the canvas size
   * (otherwise the surroundings kept showing the old image)
   */
  size?: { w: number; h: number };
}) {
  const { prefs } = usePrefs();
  const on = prefs.backdrop === "blur";
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const src = props.source;
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!on || !src || !c || !ctx) return;
    const video = src instanceof HTMLVideoElement ? src : undefined;
    const { w, h } = workSize(src);
    if (!w || !h) return;
    const k = LONG_SIDE / Math.max(w, h);
    // Don't reassign an unchanged size: setting it clears the canvas, leaving the surroundings empty
    // while a reloaded video has no first frame yet
    const cw = Math.max(1, Math.round(w * k));
    const ch = Math.max(1, Math.round(h * k));
    if (c.width !== cw) c.width = cw;
    if (c.height !== ch) c.height = ch;

    let last = 0;
    const draw = () => {
      if (video && video.readyState < 2) return;
      ctx.drawImage(src, 0, 0, c.width, c.height);
      last = performance.now();
      wrap.current?.classList.add("is-on");
    };
    draw();
    if (!video) return;

    let handle = 0;
    const onFrame = () => {
      if (performance.now() - last >= INTERVAL) draw();
      handle = video.requestVideoFrameCallback(onFrame);
    };
    handle = video.requestVideoFrameCallback(onFrame);
    // The frame after pausing or seeking must be drawn (throttling during playback may skip exactly that one)
    const events = ["loadeddata", "seeked", "pause"] as const;
    for (const e of events) video.addEventListener(e, draw);
    return () => {
      video.cancelVideoFrameCallback(handle);
      for (const e of events) video.removeEventListener(e, draw);
    };
    // The effect never reads props.size; it only triggers a redraw when the item was replaced (see the note on size above),
    // so this extra dependency is deliberate
    // eslint-disable-next-line react/exhaustive-effect-dependencies
  }, [on, props.source, props.size]);

  if (!on) return null;
  return (
    <div className="ambient" ref={wrap} aria-hidden>
      <canvas ref={canvas} />
    </div>
  );
}
