import { useCallback, useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { useIntl } from "react-intl";
import { formatTime, type Annotation } from "@sniptoss/core";
import { Ambient } from "./Ambient";
import { logError } from "./host";
import { useKeys } from "./keys";
import { placeStyle } from "./markColors";
import { usePrefs } from "./prefs";
import { scrubber, wantedTime, type Scrubber } from "./scrub";
import { videoHeader } from "./videoHeader";
import { ZoomView } from "./ZoomView";

const RATES = [0.25, 0.5, 1, 1.5, 2];

/**
 * Where each video last stopped (keyed by URL, valid while the app is open). The player is unmounted entirely when the item changes,
 * so coming back resumes from the last position (otherwise after scrubbing, moving to the next item and returning, it would start over from the beginning)
 */
const lastTime = new Map<string, number>();

export interface SeekRequest {
  time: number;
  /** Makes a request count even when the same time is requested twice in a row */
  nonce: number;
}

/**
 * A video player with a custom control bar.
 * Things that change every frame, such as the playhead and timecode, are set on the DOM directly, not through React state, to avoid re-rendering the whole page during playback.
 */
export function VideoPlayer(props: {
  src: string;
  annotations: Annotation[];
  seek?: SeekRequest;
  /** The caller needs the video element (screenshots, reading the current time): told when it is attached / detached, and the caller's ref is the caller's to write (same as Viewer's onMedia) */
  onMedia?: (el: HTMLVideoElement | null) => void;
  /**
   * The note layer on the canvas; t is the current time (refreshed a few times a second, enough to decide which notes to show), playing = currently playing
   * (marks light up briefly during playback, and only on their own frame when paused), fps = frame rate (to tell whether the paused frame is the mark's frame)
   */
  overlay?: (t: number, size: { w: number; h: number }, playing: boolean, fps: number) => ReactNode;
  onSize?: (size: { w: number; h: number }) => void;
  selectedId?: string;
  onMarkClick?: (id: string) => void;
  /** Cannot play (broken file, unsupported codec): code is the MediaError code */
  onError?: (code?: number) => void;
  /**
   * A click on blank canvas: if a note is selected, deselect it first (return true, and this click does not play); otherwise play / pause.
   * Consistent with images; if it played directly, clicking a blank spot while looking at a note on a paused frame would make the video run away from that frame
   */
  onBackgroundClick?: () => boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const timeText = useRef<HTMLSpanElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const hoverTip = useRef<HTMLDivElement>(null);
  const hud = useRef<HTMLDivElement>(null);
  const hudTimer = useRef<number>(undefined);
  /**
   * Frame rate: for MP4 / MOV it is read from the file header (videoHeader.ts); when that fails it is estimated during playback from requestVideoFrameCallback, and 30 until estimated.
   * fromFile = it was read from the file, so no more estimating
   */
  const fps = useRef(30);
  const fromFile = useRef(false);
  /** The same frame rate for the note layer (refs are not read while rendering) */
  const [fpsNow, setFpsNow] = useState(30);
  const setFrameRate = (f: number) => {
    fps.current = f;
    setFpsNow(f);
  };

  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [duration, setDuration] = useState(0);
  const [size, setSize] = useState<{ w: number; h: number }>();
  const [now, setNow] = useState(0);
  const syncNow = () => video.current && setNow(video.current.currentTime);
  const { prefs, setPrefs } = usePrefs();
  const intl = useIntl();

  // Volume and mute are stored in Settings (kept across videos and restarts). While dragging the slider only the video changes; the value is stored 300ms after the drag stops, so the settings file is not written at every step
  const [volume, setVolume] = useState(prefs.volume);
  useEffect(() => setVolume(prefs.volume), [prefs.volume]);
  useEffect(() => {
    const v = video.current;
    if (v) {
      v.volume = volume;
      v.muted = prefs.muted;
    }
  }, [volume, prefs.muted]);
  useEffect(() => {
    if (volume === prefs.volume) return;
    const t = window.setTimeout(() => setPrefs({ volume }), 300);
    return () => clearTimeout(t);
  }, [volume, prefs.volume, setPrefs]);
  const silent = prefs.muted || volume === 0;

  // The playhead and timecode show the moment being sought: while scrubbing, the picture may lag a bit behind, and the playhead follows the mouse first (scrub.ts)
  const paint = useCallback(() => {
    const v = video.current;
    if (!v || !v.duration) return;
    const t = wantedTime(v);
    const p = t / v.duration;
    fill.current!.style.transform = `scaleX(${p})`;
    head.current!.style.left = `${p * 100}%`;
    timeText.current!.textContent = formatTime(t, v.duration >= 3600);
    // No "buffered up to here" bar: the files are local, so buffering is meaningless, and a lit segment sitting at 0 seconds would look as if some of it had already played
  }, []);

  // Refresh the playhead every frame during playback
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const loop = () => {
      paint();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing, paint]);

  // Estimate the frame rate: the media-time difference between adjacent frames during playback. Only estimate while playing: when stepping frame by frame while paused,
  // the difference between adjacent frames is exactly the step computed from the old frame rate, so the estimate would just confirm the old rate
  // (a 60fps video never played would keep stepping at 30, skipping two frames at a time)
  useEffect(() => {
    const v = video.current;
    if (!v || !("requestVideoFrameCallback" in v)) return;
    let last: { frames: number; time: number } | undefined;
    let handle = 0;
    const onFrame: VideoFrameRequestCallback = (_, meta) => {
      if (last && !v.paused && !fromFile.current && meta.presentedFrames - last.frames === 1) {
        const dt = meta.mediaTime - last.time;
        if (dt > 0.004 && dt < 0.2 && Math.round(1 / dt) !== fps.current) setFrameRate(Math.round(1 / dt));
      }
      last = { frames: meta.presentedFrames, time: meta.mediaTime };
      handle = v.requestVideoFrameCallback(onFrame);
    };
    handle = v.requestVideoFrameCallback(onFrame);
    return () => v.cancelVideoFrameCallback(handle);
  }, []);

  useEffect(() => {
    const v = video.current;
    if (v && props.seek) {
      v.pause();
      v.currentTime = props.seek.time;
    }
  }, [props.seek]);

  const { src } = props;
  // How to jump when scrubbing or holding an arrow key (scrub.ts). Ordered after the "remember where it stopped on unmount" effect: on unmount that one reads the target moment first, then this one cleans up
  const scrub = useRef<Scrubber>(undefined);

  // Read the frame rate and keyframes from the file header (re-read when the file changes, since the URL carries the modified time)
  useEffect(() => {
    let alive = true;
    setFrameRate(30);
    fromFile.current = false;
    if (scrub.current) scrub.current.keyframes = undefined;
    void videoHeader(src).then((h) => {
      if (!alive) return;
      if (scrub.current) scrub.current.keyframes = h.keyframes;
      if (!h.fps) return;
      setFrameRate(h.fps);
      fromFile.current = true;
    });
    return () => {
      alive = false;
    };
  }, [src]);

  // Return to the last position (an explicit time to seek to wins, e.g. coming from a note card); on unmount, remember where it stopped this time
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const saved = lastTime.get(src);
    if (saved && !props.seek) v.currentTime = saved;
    return () => {
      lastTime.set(src, wantedTime(v));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src]);

  useEffect(() => {
    const s = scrubber(video.current!);
    scrub.current = s;
    return () => s.dispose();
  }, []);

  const flash = (text: string) => {
    const el = hud.current!;
    el.textContent = text;
    el.classList.add("is-on");
    clearTimeout(hudTimer.current);
    hudTimer.current = window.setTimeout(() => el.classList.remove("is-on"), 600);
  };

  /**
   * Play. When pause follows play right away (repeated Space, a single click followed by a double click), the browser ends play() with AbortError: that is expected and not logged;
   * other reasons (cannot decode, blocked by the system) are logged. Left uncaught, they would end up as "unhandled Promise" errors in the log
   */
  const play = (v: HTMLVideoElement) =>
    void v.play().catch((e: unknown) => {
      if (!(e instanceof DOMException && e.name === "AbortError")) logError("Playing video", e, "warn");
    });
  const toggle = () => {
    const v = video.current!;
    if (v.paused || v.ended) play(v);
    else v.pause();
  };
  // A double-click on the canvas zooms, but the two single clicks before it each already toggled play / pause, so a paused picture would advance a few frames.
  // Record the state from before the first click of a run of clicks and return to it on double-click
  const beforeClicks = useRef<{ at: number; time: number; paused: boolean }>(undefined);
  const onStageClick = () => {
    const v = video.current!;
    const clickAt = performance.now();
    if (!beforeClicks.current || clickAt - beforeClicks.current.at > 600)
      beforeClicks.current = { at: clickAt, time: v.currentTime, paused: v.paused };
    if (props.onBackgroundClick?.()) return;
    toggle();
  };
  const onStageDoubleClick = () => {
    const b = beforeClicks.current;
    const v = video.current;
    beforeClicks.current = undefined;
    if (!b || !v || performance.now() - b.at > 1000) return;
    if (b.paused) {
      v.pause();
      v.currentTime = b.time;
    } else if (v.paused) play(v);
  };
  /** coarse = dragging the progress bar (when dragging fast it may jump to keyframes first, see scrub.ts) */
  const seekTo = (t: number, coarse = false) => {
    const v = video.current!;
    scrub.current!.to(Math.min(Math.max(0, t), v.duration || 0), coarse);
    paint();
  };
  // Computed from the moment being sought: while an arrow key is held the picture may lag a bit behind
  const at = () => wantedTime(video.current!);

  // The time bubble above the control bar: follows the mouse on hover, drag and click, and the playhead on keyboard jumps. One size larger than the timecode at the bottom left, so it is readable while dragging
  const tipTimer = useRef<number>(undefined);
  /** Put the bubble at t, clamped to the control bar's ends (it does not stick out over the timecode and playback rate). Width and position are in pre-zoom pixels (unaffected by the interface size) */
  const placeTip = (t: number) => {
    const tip = hoverTip.current!;
    const d = video.current!.duration || 0;
    tip.textContent = formatTime(t, d >= 3600);
    const w = track.current!.clientWidth;
    const half = tip.offsetWidth / 2;
    tip.style.left = `${Math.min(Math.max(d ? (t / d) * w : 0, half), w - half)}px`;
  };
  /** Lit (while dragging); with hold = false it fades out after 1 second. It stays up while the mouse rests on the control bar */
  const showTip = (hold: boolean) => {
    const tip = hoverTip.current!;
    clearTimeout(tipTimer.current);
    tip.classList.add("is-on");
    if (!hold) tipTimer.current = window.setTimeout(() => tip.classList.remove("is-on"), 1000);
  };
  /** Keyboard jump: seek there and flash the bubble on the playhead */
  const jump = (t: number) => {
    seekTo(t);
    placeTip(at());
    showTip(false);
  };
  const seekBy = (dt: number) => jump(at() + dt);
  const step = (dir: 1 | -1) => {
    video.current!.pause();
    const frame = Math.floor(at() * fps.current + 1e-6);
    // Land in the middle of a frame rather than on its boundary, so floating-point error does not show the adjacent frame
    jump((frame + dir + 0.5) / fps.current);
  };
  const applyRate = (r: number) => {
    // Set the default playback rate too: when the file is replaced in place (an agent re-exports it) the browser reloads and the rate returns to the default rate, so this keeps the one the user chose
    video.current!.defaultPlaybackRate = r;
    video.current!.playbackRate = r;
    setRate(r);
    flash(`${r}×`);
  };
  // Read the current rate from the video itself: with very fast repeated presses the React state has not updated yet
  const rateIndex = () => Math.max(0, RATES.indexOf(video.current!.playbackRate));
  const changeRate = (dir: 1 | -1) => applyRate(RATES[Math.min(RATES.length - 1, Math.max(0, rateIndex() + dir))]);
  const cycleRate = () => applyRate(RATES[(rateIndex() + 1) % RATES.length]);
  const toggleMute = () => {
    // Unmuting while the volume is dragged down to 0: go back to half, otherwise clicking would still give no sound
    if (silent && volume === 0) {
      setVolume(0.5);
      setPrefs({ muted: false, volume: 0.5 });
    } else setPrefs({ muted: !prefs.muted });
    flash(intl.formatMessage({ id: silent ? "video.unmuted" : "video.muted" }));
  };
  /** ↑ ↓: volume up / down 10%; while muted, ↑ also unmutes, and ↓ leaves the stored volume alone and only shows "Muted" (otherwise it quietly lowered the value and flashed "Volume N%" although neither the sound nor the slider changed) */
  const changeVolume = (delta: number) => {
    if (prefs.muted && delta < 0) return flash(intl.formatMessage({ id: "video.muted" }));
    const next = Math.round(Math.min(1, Math.max(0, volume + delta)) * 100) / 100;
    setVolume(next);
    if (prefs.muted && delta > 0) setPrefs({ muted: false });
    flash(intl.formatMessage({ id: "video.volume" }, { percent: Math.round(next * 100) }));
  };
  const toggleLoop = () => setPrefs({ loop: !video.current!.loop });
  // Changes made from the menu or Settings are announced too (not when a video opens)
  const loopShown = useRef(prefs.loop);
  // The announcement text uses an Effect Event to get the latest intl: announce only when the loop switch changes, not again after a language change
  const announceLoop = useEffectEvent((on: boolean) => flash(intl.formatMessage({ id: on ? "video.loopOn" : "video.loopOff" })));
  useEffect(() => {
    if (loopShown.current === prefs.loop) return;
    loopShown.current = prefs.loop;
    announceLoop(prefs.loop);
  }, [prefs.loop]);

  // Holding a key makes the system repeat the press; only the first counts, otherwise it would keep toggling between play and pause
  const toggleOnce = (e: KeyboardEvent) => {
    if (!e.repeat) toggle();
  };

  useKeys({
    Space: toggleOnce,
    K: toggleOnce,
    J: () => seekBy(-5),
    L: () => seekBy(5),
    ArrowLeft: () => step(-1),
    ArrowRight: () => step(1),
    "Shift+ArrowLeft": () => seekBy(-1),
    "Shift+ArrowRight": () => seekBy(1),
    Home: () => jump(0),
    End: () => jump(Infinity),
    ",": () => changeRate(-1),
    ".": () => changeRate(1),
    M: toggleMute,
    ArrowUp: () => changeVolume(0.1),
    ArrowDown: () => changeVolume(-0.1),
    // Ctrl+L lives in Workspace: loop playback can be toggled on images too
  });

  // Dragging the progress bar
  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return (Math.min(Math.max(0, clientX - r.left), r.width) / r.width) * (video.current!.duration || 0);
  };
  /** Currently dragging; resume = it was playing before the drag, so continue after release */
  const drag = useRef<{ resume: boolean }>(undefined);
  const onPointerDown = (e: React.PointerEvent) => {
    // Left button only: right-click is the canvas context menu and middle-click does nothing (otherwise a right-click would seek too)
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const v = video.current!;
    drag.current = { resume: !v.paused && !v.ended };
    // Pause while dragging: seeking during playback makes it run a few frames forward after every jump, so the moment dragged to is hard to judge, and decoding is split too
    v.pause();
    const t = timeAt(e.clientX);
    placeTip(t);
    showTip(true);
    seekTo(t, true);
  };
  const endDrag = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = undefined;
    scrub.current!.release();
    showTip(false);
    if (d.resume) play(video.current!);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const t = timeAt(e.clientX);
    placeTip(t);
    if (!drag.current) return;
    // The left button is no longer down (the release was not received, e.g. the window was switched away mid-drag): treat it as a release and stop following the hovering mouse
    if (!(e.buttons & 1)) return endDrag();
    seekTo(t, true);
  };

  // Notes beyond the video's duration (the item was trimmed) are not drawn; ones crossing the end are clipped to the end
  const marks = duration
    ? props.annotations
        .filter((a) => (a.status === "open" || a.id === props.selectedId) && a.anchor.time && a.anchor.time.start <= duration)
        .map((a) => ({
          id: a.id,
          start: a.anchor.time!.start,
          end: a.anchor.time!.end && Math.min(a.anchor.time!.end, duration),
          style: placeStyle(a, 0),
        }))
    : [];

  // The three icon-only buttons: the name also goes into aria-label. The window-wide tooltip takes the title off while the mouse rests (Tooltip.tsx), and at that moment the button would have no name
  const playLabel = intl.formatMessage({ id: playing ? "video.pause" : "video.play" });
  const loopLabel = intl.formatMessage({ id: prefs.loop ? "video.loopTitleOn" : "video.loopTitle" });
  const muteLabel = intl.formatMessage({ id: silent ? "video.unmute" : "video.mute" });

  return (
    <div className="video-player">
      <Ambient source={size ? video.current : null} size={size} />
      <div className="video-area">
        <ZoomView size={size} onClick={onStageClick} onDoubleClick={onStageDoubleClick} margin={0}>
          <video
            ref={(el) => {
              video.current = el;
              props.onMedia?.(el);
            }}
            className="zoom-media"
            src={props.src}
            crossOrigin="anonymous"
            preload="auto"
            loop={prefs.loop}
            onLoadedMetadata={(e) => {
              e.currentTarget.volume = volume;
              e.currentTarget.muted = prefs.muted;
              setDuration(e.currentTarget.duration);
              const s = { w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight };
              setSize(s);
              props.onSize?.(s);
              paint();
            }}
            onTimeUpdate={syncNow}
            onPlay={() => setPlaying(true)}
            onPause={() => {
              setPlaying(false);
              paint();
              syncNow();
            }}
            onSeeked={() => {
              paint();
              syncNow();
            }}
            // The file was replaced in place and reloaded: the browser stops the video without firing pause, so the play button must switch back to "Play" itself
            onEmptied={() => setPlaying(false)}
            onProgress={paint}
            onError={(e) => props.onError?.(e.currentTarget.error?.code)}
          />
          {size && props.overlay?.(now, size, playing, fpsNow)}
        </ZoomView>
        <div className="hud" ref={hud} />
      </div>

      <div className="transport">
        <button className="icon-btn" onClick={toggle} title={playLabel} aria-label={playLabel}>
          {playing ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <rect x="3.5" y="2.5" width="3" height="11" rx="1" />
              <rect x="9.5" y="2.5" width="3" height="11" rx="1" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4.5 2.8v10.4a.8.8 0 001.2.7l8.3-5.2a.8.8 0 000-1.4L5.7 2.1a.8.8 0 00-1.2.7z" />
            </svg>
          )}
        </button>
        <div className="timecode">
          {/* The text is set directly by paint (it changes every frame, not through React); after loading, the first paint switches to this video's format (with hours for an hour or longer) */}
          <span ref={timeText}>00:00.000</span>
          <span className="muted"> / {formatTime(duration)}</span>
        </div>
        <div
          className="track"
          ref={track}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onLostPointerCapture={endDrag}
        >
          <div className="track-rail">
            <div className="track-fill" ref={fill} />
          </div>
          {marks.map((m) => (
            <div
              key={m.id}
              className={`track-mark${m.id === props.selectedId ? " is-selected" : ""}`}
              style={{
                left: `${(m.start / duration) * 100}%`,
                width: m.end !== undefined ? `${((m.end - m.start) / duration) * 100}%` : undefined,
                ...m.style,
              }}
              onPointerDown={(e) => {
                // A click on a note mark on the control bar: select it and seek there, not treated as dragging the progress bar
                if (e.button !== 0) return;
                e.stopPropagation();
                props.onMarkClick?.(m.id);
              }}
            />
          ))}
          <div className="track-head" ref={head} />
          <div className="track-tip" ref={hoverTip} />
        </div>
        <button className="text-btn" onClick={cycleRate} title={intl.formatMessage({ id: "video.rate" })}>
          {rate}×
        </button>
        <button
          className={`icon-btn${prefs.loop ? " is-on" : ""}`}
          onClick={toggleLoop}
          title={loopLabel}
          aria-label={loopLabel}
          aria-pressed={prefs.loop}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M2.5 7.5v-1a2 2 0 012-2h8M10.5 2.5l2 2-2 2" />
            <path d="M13.5 8.5v1a2 2 0 01-2 2h-8M5.5 13.5l-2-2 2-2" />
          </svg>
        </button>
        <button className="icon-btn" onClick={toggleMute} title={muteLabel} aria-label={muteLabel} aria-pressed={prefs.muted}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
            <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" />
            {silent ? (
              <path d="M11 6l3.5 4M14.5 6L11 10" strokeLinecap="round" />
            ) : (
              <path d="M10.8 5.6a3.4 3.4 0 010 4.8M12.6 3.9a5.8 5.8 0 010 8.2" strokeLinecap="round" />
            )}
          </svg>
        </button>
        {/* Volume: a thin track like the control bar's. While the cursor is on it, ← → adjust the volume itself rather than stepping frames (keys.ts leaves single keys in inputs to the input) */}
        <input
          type="range"
          name="volume"
          className="volume-slider"
          min={0}
          max={1}
          step={0.05}
          value={prefs.muted ? 0 : volume}
          style={{ "--fill": `${(prefs.muted ? 0 : volume) * 100}%` } as React.CSSProperties}
          onChange={(e) => {
            setVolume(Number(e.target.value));
            if (prefs.muted) setPrefs({ muted: false });
          }}
          title={intl.formatMessage({ id: "video.volumeTitle" }, { percent: Math.round((prefs.muted ? 0 : volume) * 100) })}
          aria-label={intl.formatMessage({ id: "video.volumeLabel" })}
        />
      </div>
    </div>
  );
}
