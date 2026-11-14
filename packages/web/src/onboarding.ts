import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { MaterialEntry } from "./host";
import { usePrefs } from "./prefs";

/**
 * The onboarding guide and first-use hints (the guide is kept short).
 * - The guide (Guide.tsx): starts the first time an item is shown on the canvas and is done by doing, in 4 steps: pick the rectangle tool → mark a place → write the note → copy for the AI;
 *   between writing and copying it labels the rest of the toolbar, and copying ends it: the last card, in the middle of the window,
 *   says what to do with what was copied (it is what the user sees on coming back from pasting, so nothing is left to find after it).
 *   A small window in the corner of the canvas plays an animation of the step (Demo.tsx); doing the step moves on to the next, "Next" skips one, "Skip" closes it.
 *   Only what the step is done on stays lit and usable, so a first-time user stays on the path. Help → "Tutorial" shows it again (on the sample, as the welcome page's button).
 * - Hints (Hint.tsx): shown once next to the relevant control when it is first used, dismissed by pressing elsewhere, and never blocking the operation: the first time a note is saved (the Copy button only appears then; not when the guide has just shown it), the first time a video is opened,
 *   after the guide, next to Capture (the screen can be annotated too),
 *   and on the Mac, while macOS has not allowed the app to record the screen, next to Capture (with a button that leads to where it is allowed);
 *   the first time the Pin tool is picked (a note can mark several places), and the first mark drawn after the guide, next to it while it is being written (a mark can be recolored).
 *   Each comes the first time its feature is passed by.
 *   Most of them play a short animation of the feature (Hint.tsx's DEMOS).
 * What has been seen is stored in the onboarding entry of the settings (it is not a setting, and "Restore Defaults" leaves it alone); it is recorded as soon as something appears, without waiting for it to close, so quitting midway does not bring it back
 */
export type HintId = "copy" | "video" | "drawing" | "capture" | "pin" | "color";

/** The name recorded in onboarding */
export const TOUR = "tour";
/** The dialog on the very first launch (FirstRun.tsx) */
export const WELCOME = "welcome";
export const hintKey = (id: HintId) => `hint.${id}`;

/**
 * The steps of the guide, in order. "tools", which labels everything on the toolbar at once (the marking tools and Overall Comment), comes
 * between writing and copying; "done", which says what to do with what was copied, comes after copying and is the end
 */
export type GuideStep = "tool" | "mark" | "write" | "copy";
export type GuideState = GuideStep | "done" | "tools";
export const GUIDE_STEPS: GuideStep[] = ["tool", "mark", "write", "copy"];
/** Where the marking step boxes on the sample picture: around its headline (fractions of the picture). Shown as a dashed box; "Next" draws it there */
export const SAMPLE_BOX = { x: 0.06, y: 0.24, w: 0.48, h: 0.2 };

/** Which control a hint attaches to */
export const HINT_TARGETS: Record<HintId, string> = {
  copy: ".panel-dock .dock-buttons",
  video: ".hdr-tools .tool-timed",
  capture: ".titlebar-split",
  // The invisible anchor at the start of a drawing (AnnotationLayer)
  drawing: ".annot-layer .annot-badge.is-ghost",
  pin: '.hdr-tools .tool-btn[data-tool="point"]',
  // The badge of the mark being drawn for a new note
  color: ".annot-layer .annot-badge.is-draft",
};

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export type Side = "below" | "above" | "left" | "right";

/**
 * Put a floating layer beside its target (design-rules: sit next to what it explains, without covering it): try the sides in the order given by order and take the first one with enough room,
 * centered on the target in the other direction and clamped inside area; if no side has room, use the first side and clamp the whole layer inside area.
 * Everything is in the same kind of pixels (screen pixels); returns the top-left corner and the side used
 */
export function placeNear(target: Box, size: { w: number; h: number }, area: Box, gap: number, order: Side[]) {
  const clampX = (x: number) => Math.max(area.left, Math.min(x, area.right - size.w));
  const clampY = (y: number) => Math.max(area.top, Math.min(y, area.bottom - size.h));
  const cx = (target.left + target.right) / 2 - size.w / 2;
  const cy = (target.top + target.bottom) / 2 - size.h / 2;
  const at = (side: Side) => {
    switch (side) {
      case "below":
        return { x: clampX(cx), y: target.bottom + gap, fits: target.bottom + gap + size.h <= area.bottom };
      case "above":
        return { x: clampX(cx), y: target.top - gap - size.h, fits: target.top - gap - size.h >= area.top };
      case "left":
        return { x: target.left - gap - size.w, y: clampY(cy), fits: target.left - gap - size.w >= area.left };
      case "right":
        return { x: target.right + gap, y: clampY(cy), fits: target.right + gap + size.w <= area.right };
    }
  };
  for (const side of order) {
    const p = at(side);
    if (p.fits) return { x: Math.round(p.x), y: Math.round(p.y), side };
  }
  const p = at(order[0]);
  return { x: Math.round(clampX(p.x)), y: Math.round(clampY(p.y)), side: order[0] };
}

/** The element is visible on screen (a collapsed side panel, or a button folded into "⋯" in a narrow window, does not count; a collapsed side panel is inert, and it still has width during the collapse animation) */
export function visibleBox(selector: string): DOMRect | undefined {
  const el = document.querySelector(selector);
  if (!el || el.closest("[inert]")) return undefined;
  const r = el.getBoundingClientRect();
  return r.width >= 1 && r.height >= 1 ? r : undefined;
}

/** The interface is idle and a tour or hint may appear: no dialog, menu, note composer or drop hint, and the window is not hidden */
export function interfaceIdle() {
  return document.visibilityState === "visible" && !document.querySelector(".overlay, .menu, .composer, .drop-overlay");
}

/**
 * "The tutorial was asked for" has to outlive a reload of the page: adding the sample on a volume the shell has not mapped yet reloads it
 * (host-api.md), and what was asked would be forgotten on the way. Kept for this session only, and only for half a minute (adding the
 * sample failed: a picture opened much later must not start the tutorial)
 */
const ASKED = "sniptoss.tour.asked";
const ASKED_MS = 30_000;
function tourAsked() {
  try {
    return Date.now() - Number(sessionStorage.getItem(ASKED) ?? 0) < ASKED_MS;
  } catch {
    return false;
  }
}
function askTour(on: boolean) {
  try {
    if (on) sessionStorage.setItem(ASKED, String(Date.now()));
    else sessionStorage.removeItem(ASKED);
  } catch {
    // No storage: the tutorial still starts when the page is not reloaded
  }
}

/** Wait until the interface is idle (at least delay milliseconds later) and then run; returns a function that cancels */
function whenIdle(delay: number, run: () => void) {
  let timer = 0;
  const started = Date.now();
  const tick = () => {
    if (Date.now() - started >= delay && interfaceIdle()) run();
    else timer = window.setTimeout(tick, 250);
  };
  timer = window.setTimeout(tick, Math.min(delay, 250));
  return () => clearTimeout(timer);
}

/**
 * When the tour and hints appear (used by Workspace). current: the item on the canvas; video: the canvas shows a video that can be opened;
 * fresh: the very first launch (the library is empty and the shell can add the sample picture);
 * composing: the composer is open on a new note (the guide moves from marking to writing, and back if it closes without a note);
 * returns the guide's step (undefined: not on), start / next / stop the guide, which hint is showing now, savedNew, to be called when a new
 * note is saved, and copied, when notes were copied
 */
export function useOnboarding(opts: {
  current?: MaterialEntry;
  selectedKey?: string;
  video: boolean;
  composing: boolean;
  /** A new note's mark is on the canvas, being drawn or written (its badge is .annot-badge.is-draft) */
  marking: boolean;
  /** The tool in use: picking the rectangle is the guide's first step */
  tool: string;
  /** The very first launch: nothing in the library yet, and the shell can add the sample picture (the first-run dialog offers the tutorial) */
  fresh: boolean;
}) {
  const { prefs, setPrefs } = usePrefs();
  const seen = prefs.onboarding;
  /**
   * Beginner mode (Settings → General). Off: the first-run dialog, the guide and the hints do not appear by themselves, and nothing is
   * recorded as seen meanwhile (turned back on, what was never shown still comes). The guide can still be started from Help
   */
  const tips = prefs.beginner;
  const [at, setStep] = useState<GuideState>();
  // Picking the rectangle tool is the first step: once it is the tool in use, the guide is on marking
  const step = at === "tool" && opts.tool === "rect" ? "mark" : at;
  const [welcoming, setWelcoming] = useState(false);
  const touring = !!step;
  /** The hint that is showing, the item it appeared on (after the item changes it no longer counts; no separate dismissal) and, if not its usual one, what it points at */
  const [shown, setShown] = useState<{ id: HintId; on?: string; target?: string }>();
  const hint = shown && shown.on === opts.selectedKey && tips ? shown.id : undefined;
  // Record what has been seen: recording two in a row loses neither (setPrefs is a shallow merge, and the prefs read may still be from the previous render)
  const seenRef = useRef(seen);
  useEffect(() => {
    seenRef.current = seen;
  }, [seen]);
  const markSeen = (key: string) => {
    if (seenRef.current.includes(key)) return;
    seenRef.current = [...seenRef.current, key];
    setPrefs({ onboarding: seenRef.current });
  };
  /** The tutorial was asked for (the welcome page's button, which adds the sample first): it starts once an item is on the canvas, seen before or not, beginner mode on or off */
  const [asked, setAsked] = useState(tourAsked);
  const beginTour = () => {
    askTour(false);
    setAsked(false);
    markSeen(TOUR);
    setShown(undefined);
    setStep(opts.composing ? "write" : opts.tool === "rect" ? "mark" : "tool");
  };
  /** The guide is over (finished or skipped): once, say next to Capture that the screen can be annotated too (on the Mac without the permission, the hint about that says it) */
  const [guided, setGuided] = useState(false);
  const endTour = () => {
    setStep(undefined);
    setGuided(true);
  };
  // The guide shows where Copy is (and both ways of copying): the hint that says the same is not needed afterwards
  const toCopy = () => {
    markSeen(hintKey("copy"));
    setStep("copy");
  };
  const nextStep = () => {
    if (step === "done") return endTour();
    if (step === "tools") return toCopy();
    const i = step ? GUIDE_STEPS.indexOf(step) : -1;
    if (i < 0) return;
    if (i === GUIDE_STEPS.length - 1) return setStep("done");
    const to = GUIDE_STEPS[i + 1];
    if (to === "copy") return setStep("tools");
    setStep(to);
  };
  // Doing a step moves the guide on. The composer opened on a new note → writing; it closed without a note → back to marking
  const wasComposing = useRef(opts.composing);
  useEffect(() => {
    const was = wasComposing.current;
    wasComposing.current = opts.composing;
    if (opts.composing && !was) setStep((s) => (s === "mark" || s === "tool" ? "write" : s));
    else if (!opts.composing && was) setStep((s) => (s === "write" ? "mark" : s));
  }, [opts.composing]);
  const showHint = (id: HintId, target?: string) => {
    if (!tips) return;
    if (step || seenRef.current.includes(hintKey(id)) || !visibleBox(target ?? HINT_TARGETS[id])) return;
    markSeen(hintKey(id));
    setShown({ id, on: opts.selectedKey, target });
  };
  // Called from a timer: uses the state of the latest render
  const beginTourLater = useEffectEvent(beginTour);
  const showHintLater = useEffectEvent(showHint);

  // The first-run dialog: the very first launch, before anything was added or the guide was seen
  const beginWelcome = useEffectEvent(() => {
    markSeen(WELCOME);
    setWelcoming(true);
  });
  const firstRun = tips && opts.fresh && !seen.includes(WELCOME) && !seen.includes(TOUR) && !welcoming;
  useEffect(() => {
    if (!firstRun) return;
    return whenIdle(300, () => beginWelcome());
  }, [firstRun]);

  // The tour: the first time an item is shown on the canvas (the first item was added, or one is already selected at startup)
  const autoTour = !!opts.current && !touring && (asked || (tips && !seen.includes(TOUR)));
  useEffect(() => {
    if (!autoTour) return;
    return whenIdle(600, () => beginTourLater());
  }, [autoTour]);

  // The first time a video is opened (it can be opened and the tour is finished): where timestamped comments are, and that a mark belongs only to this frame
  // Switching to another video waits again (the previous one failed to show it, e.g. when the timestamped comment button was folded into "⋯")
  const videoKey = tips && opts.video && !touring && !hint && !seen.includes(hintKey("video")) ? opts.selectedKey : undefined;
  useEffect(() => {
    if (!videoKey) return;
    return whenIdle(600, () => showHintLater("video"));
  }, [videoKey]);

  // The Pin tool picked for the first time: it can mark several places of one note (shown while it is still the tool in use)
  const pinHint = tips && opts.tool === "point" && !touring && !hint && !seen.includes(hintKey("pin"));
  const pinStill = useEffectEvent(() => {
    if (opts.tool === "point") showHint("pin");
  });
  useEffect(() => {
    if (!pinHint) return;
    return whenIdle(250, () => pinStill());
  }, [pinHint]);

  // Also on a Mac that has not allowed screen recording yet: it is asked the first time Screen Capture is used, which this hint leads to
  const captureHint = tips && guided && !step && !hint && !seen.includes(hintKey("capture"));
  useEffect(() => {
    if (!captureHint) return;
    return whenIdle(800, () => showHintLater("capture"));
  }, [captureHint]);

  /**
   * The first mark drawn outside the guide (a box, a pin, a line…): right then, next to it, that a mark can be recolored. That is when the
   * feature is first passed by, so it does not wait for the composer to close (the hint takes no focus: typing goes on in the composer)
   */
  const colorHint = tips && opts.marking && !touring && !hint && !seen.includes(hintKey("color"));
  const colorNow = useEffectEvent(() => {
    if (opts.marking && document.visibilityState === "visible") showHint("color");
  });
  useEffect(() => {
    if (!colorHint) return;
    const timer = window.setTimeout(() => colorNow(), 350);
    return () => clearTimeout(timer);
  }, [colorHint]);

  /** A new note was saved (not an edit of an old one): the first time, point out the Copy buttons (they only appear then). Shown after the composer closes and the notes panel has scrolled into place */
  const pendingCopy = useRef<() => void>(undefined);
  const savedNew = () => {
    // During the guide: the note is written, on to the rest of the toolbar and then copying (the effect above sees the composer close after
    // this and leaves "tools" alone)
    if (step === "mark" || step === "write") {
      markSeen(hintKey("copy"));
      setStep("tools");
      return;
    }
    if (!tips || seenRef.current.includes(hintKey("copy"))) return;
    pendingCopy.current?.();
    pendingCopy.current = whenIdle(400, () => showHint("copy"));
  };
  useEffect(() => () => pendingCopy.current?.(), []);

  /** Marks were left without a word and stayed as drawings: the first time, say so next to the drawing (what it is, how to remove it or add words) */
  const pendingDrawing = useRef<() => void>(undefined);
  const keptDrawing = () => {
    if (!tips || seenRef.current.includes(hintKey("drawing"))) return;
    pendingDrawing.current?.();
    pendingDrawing.current = whenIdle(300, () => showHint("drawing"));
  };
  useEffect(() => () => pendingDrawing.current?.(), []);

  return {
    guide: step,
    startTour: beginTour,
    /** Start the guide as soon as an item is on the canvas (the sample is being added) */
    askTour: () => {
      askTour(true);
      setAsked(true);
    },
    nextStep,
    closeTour: endTour,
    /** Notes were copied: the last step of the guide is done */
    copied: () => {
      if (step === "copy") setStep("done");
    },
    welcoming,
    closeWelcome: () => setWelcoming(false),
    /**
     * "Skip" on the first-run dialog is a no to the tutorial: it is recorded as seen too, so it doesn't start by itself later on the user's
     * own first item (where "Next" would write sample notes into their project). The welcome page's Tutorial and Help bring it back; the
     * first-use hints still come one by one
     */
    skipWelcome: () => {
      markSeen(TOUR);
      setWelcoming(false);
    },
    hint,
    /** What the hint points at, when not its usual control (HINT_TARGETS) */
    hintTarget: hint ? shown?.target : undefined,
    closeHint: () => setShown(undefined),
    savedNew,
    keptDrawing,
  };
}
