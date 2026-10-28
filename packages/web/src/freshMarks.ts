import { useEffect, useMemo } from "react";
import { keyOf, type MaterialEntry } from "./host";
import type { Library } from "./library";
import { usePrefs } from "./prefs";

// The "New" markers in the library (split out of LibraryPanel): files that appeared after the folder was added to the library (by
// creation time); once opened they are no longer marked. Stored in the fresh entry of the settings: the moment each folder entry counts
// from (since) and the ones already seen (seen)

export function useFreshMarks(opts: { library: Library; selectedKey: string | undefined }) {
  const { library, selectedKey } = opts;
  const { prefs, setPrefs } = usePrefs();
  const freshSince = prefs.fresh.since;
  const freshSeen = useMemo(() => new Set(prefs.fresh.seen), [prefs.fresh.seen]);
  /** Items marked "New" (keyOf paths) */
  const newKeys = useMemo(() => {
    const out = new Set<string>();
    for (const e of library.entries) {
      const since = e.kind === "folder" ? freshSince[keyOf(e.path)] : undefined;
      if (since === undefined) continue;
      for (const m of library.scans.get(keyOf(e.path))?.materials ?? [])
        if (m.ctime !== undefined && m.ctime > since && !freshSeen.has(keyOf(m.path))) out.add(keyOf(m.path));
    }
    return out;
  }, [library.entries, library.scans, freshSince, freshSeen]);
  /** How many of these items are new */
  const newIn = (ms: MaterialEntry[]) => ms.reduce((n, m) => n + (newKeys.has(keyOf(m.path)) ? 1 : 0), 0);
  /** Records these items as seen. Only those still in the library are kept, so the record doesn't keep growing */
  const markSeen = (ms: MaterialEntry[]) => {
    const add = ms.map((m) => keyOf(m.path)).filter((k) => newKeys.has(k));
    if (add.length === 0) return;
    const alive = new Set(library.ordered.map((m) => keyOf(m.path)));
    setPrefs({ fresh: { since: freshSince, seen: [...new Set([...prefs.fresh.seen, ...add])].filter((k) => alive.has(k)) } });
  };
  // A folder entry seen for the first time counts from now on (files that existed before it was added aren't new; entries already in the
  // library when this feature first appeared also count from then). Entries removed from the library are dropped
  useEffect(() => {
    if (!library.loaded) return;
    const listed = new Set(library.entries.map((e) => keyOf(e.path)));
    const add = library.entries.filter((e) => e.kind === "folder" && freshSince[keyOf(e.path)] === undefined).map((e) => keyOf(e.path));
    const gone = Object.keys(freshSince).filter((k) => !listed.has(k));
    if (add.length === 0 && gone.length === 0) return;
    const now = Date.now();
    const since = Object.fromEntries([...Object.entries(freshSince).filter(([k]) => listed.has(k)), ...add.map((k) => [k, now] as const)]);
    setPrefs({ fresh: { ...prefs.fresh, since } });
    // Reconciled only when the entries or the starting moments change; a change to prefs.fresh.seen (one item seen) needs no redo
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [library.entries, library.loaded, freshSince]);
  // The item open on the canvas is new: it counts as seen
  useEffect(() => {
    const m = selectedKey ? library.byKey.get(selectedKey) : undefined;
    if (m) markSeen([m]);
    // Recorded only when the item changed or the set of "New" items changed; markSeen is a new function on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey, newKeys]);

  return { newIn, markSeen };
}
