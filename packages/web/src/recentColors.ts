import { useSyncExternalStore } from "react";
import { isMarkColor, MARK_COLORS } from "@sniptoss/core";
import { call, logError, onHostEvent } from "./host";

// The custom mark colors picked lately (newest first, at most 4), shown after the presets in every color row: the color bar on the canvas,
// the menus, Settings. Kept by the shell (Settings.RecentColors), shared with the capture overlay, so a color picked there shows up here too
// (the "recentColors" event). A shell without these methods (an older one) leaves the list in memory only

export const RECENT_COLORS_MAX = 4;

let colors: string[] = [];
const listeners = new Set<() => void>();

function set(next: string[]) {
  const clean = tidy(next);
  if (clean.join() === colors.join()) return;
  colors = clean;
  for (const l of listeners) l();
}

/** Well-formed, lowercase, no presets, no repeats, at most RECENT_COLORS_MAX (same as Settings.RecentColorList in the shell) */
function tidy(list: readonly unknown[]): string[] {
  const out: string[] = [];
  for (const c of list) {
    if (!isMarkColor(c)) continue;
    const v = c.toLowerCase();
    if (MARK_COLORS.includes(v) || out.includes(v)) continue;
    out.push(v);
  }
  return out.slice(0, RECENT_COLORS_MAX);
}

let started = false;

/** Called once at startup: reads the list and follows its changes */
export function startRecentColors() {
  if (started) return;
  started = true;
  onHostEvent("recentColors", ({ colors: next }) => set(next));
  call("recentColors").then(set, (e: unknown) => logError("Reading the recent colors", e, "warn"));
}

/** A custom color was picked (the color picker): it goes to the front of the recent colors here and in the shell */
export function addRecentColor(color: string) {
  if (!isMarkColor(color) || MARK_COLORS.includes(color.toLowerCase())) return;
  set([color, ...colors]);
  call("addRecentColor", { color: color.toLowerCase() }).then(set, (e: unknown) => logError("Saving a recent color", e, "warn"));
}

/** The list now (for building menus; a component that shows it re-renders through useRecentColors) */
export const getRecentColors = (): readonly string[] => colors;

export function useRecentColors(): readonly string[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => colors,
  );
}
