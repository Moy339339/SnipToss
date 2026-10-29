import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { MaterialEntry } from "./host";
import { usePrefs } from "./prefs";

/**
 * The onboarding tour and first-use hints (the tour is kept short).
 * - The tour (Tour.tsx): runs automatically the first time an item is shown on the canvas, in 3 steps: drawing tools → notes panel → Screen Capture; Help → "Feature Tour" shows it again.
 * - Hints (Hint.tsx): shown once next to the relevant control when it is first used, dismissed by pressing elsewhere, and never blocking the operation: the first time a note is saved (the Copy button only appears then), the first time a video is opened,
 *   and on the Mac, while macOS has not allowed the app to record the screen, next to Capture (with a button that leads to where it is allowed).
 * What has been seen is stored in the onboarding entry of the settings (it is not a setting, and "Restore Defaults" leaves it alone); it is recorded as soon as something appears, without waiting for it to close, so quitting midway does not bring it back
 */
export type HintId = "copy" | "video" | "screenAccess";

/** The name recorded in onboarding */
export const TOUR = "tour";
export const hintKey = (id: HintId) => `hint.${id}`;

/** The steps of the tour: which element to highlight (a step whose target cannot be found or seen is skipped, e.g. when the notes panel is collapsed) */
export interface TourStep {
  id: "tools" | "panel" | "capture";
  target: string;
}
export const TOUR_STEPS: TourStep[] = [
  { id: "tools", target: ".hdr-tools" },
  { id: "panel", target: "aside.panel" },
  { id: "capture", target: ".titlebar-split" },
];

/** Which control a hint attaches to */
export const HINT_TARGETS: Record<HintId, string> = {
  copy: ".panel-dock .dock-buttons",
  video: ".hdr-tools .tool-timed",
  screenAccess: ".titlebar-split",
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
  return document.visibilityState === "visible" && !document.querySelector(".overlay, .menu, .composer, .drop-overlay, .tour");
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
 * noScreenAccess: on the Mac, macOS has not allowed the app to record the screen (Screen Capture cannot start until it does);
 * returns whether the tour is on, start / stop the tour, which hint is showing now, and savedNew, to be called when a new note is saved
 */
export function useOnboarding(opts: { current?: MaterialEntry; selectedKey?: string; video: boolean; noScreenAccess?: boolean }) {
  const { prefs, setPrefs } = usePrefs();
  const seen = prefs.onboarding;
  const [touring, setTouring] = useState(false);
  /** The hint that is showing and the item it appeared on: after the item changes it no longer counts (no separate dismissal) */
  const [shown, setShown] = useState<{ id: HintId; on?: string }>();
  const hint = shown && shown.on === opts.selectedKey ? shown.id : undefined;
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
  const beginTour = () => {
    markSeen(TOUR);
    setShown(undefined);
    setTouring(true);
  };
  const showHint = (id: HintId) => {
    if (touring || seenRef.current.includes(hintKey(id)) || !visibleBox(HINT_TARGETS[id])) return;
    markSeen(hintKey(id));
    setShown({ id, on: opts.selectedKey });
  };
  // Called from a timer: uses the state of the latest render
  const beginTourLater = useEffectEvent(beginTour);
  const showHintLater = useEffectEvent(showHint);

  // The tour: the first time an item is shown on the canvas (the first item was added, or one is already selected at startup)
  const autoTour = !!opts.current && !seen.includes(TOUR) && !touring;
  useEffect(() => {
    if (!autoTour) return;
    return whenIdle(600, () => beginTourLater());
  }, [autoTour]);

  // The first time a video is opened (it can be opened and the tour is finished): where timestamped comments are, and that a mark belongs only to this frame
  // Switching to another video waits again (the previous one failed to show it, e.g. when the timestamped comment button was folded into "⋯")
  const videoKey = opts.video && !touring && !hint && !seen.includes(hintKey("video")) ? opts.selectedKey : undefined;
  useEffect(() => {
    if (!videoKey) return;
    return whenIdle(600, () => showHintLater("video"));
  }, [videoKey]);

  // The Mac without the permission to record the screen: once, next to Capture, before it is first used (not part of the tour, which may come first)
  const accessHint = !!opts.noScreenAccess && !touring && !hint && !seen.includes(hintKey("screenAccess"));
  useEffect(() => {
    if (!accessHint) return;
    return whenIdle(600, () => showHintLater("screenAccess"));
  }, [accessHint]);

  /** A new note was saved (not an edit of an old one): the first time, point out the Copy button (it only appears then). Shown after the composer closes and the notes panel has scrolled into place */
  const pendingCopy = useRef<() => void>(undefined);
  const savedNew = () => {
    if (seenRef.current.includes(hintKey("copy"))) return;
    pendingCopy.current?.();
    pendingCopy.current = whenIdle(400, () => showHint("copy"));
  };
  useEffect(() => () => pendingCopy.current?.(), []);

  return {
    touring,
    startTour: beginTour,
    closeTour: () => setTouring(false),
    hint,
    closeHint: () => setShown(undefined),
    savedNew,
  };
}
