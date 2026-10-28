import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { earlierVersions, knownSha, type MaterialFile, type Versions } from "@sniptoss/core";
import type { Stored } from "./annotationStore";
import { call, keyOf, logError, type MaterialEntry } from "./host";
import type { useLibrary } from "./library";

// After an item is overwritten in place, which notes were written on an older version (docs/adr/0008-earlier-versions.md; the rules are in core's versions.ts).
// Notes on older versions are not drawn on the canvas but get their own section in the notes panel, and in the text copied for AI and REVIEW.md they are flagged as relying on their snapshots.
// Whatever can be decided without reading a file is decided directly (normally items are untouched, so no file needs reading); the rest get their fingerprints computed one by one in the background, the item open on the canvas first,
// and until a fingerprint is ready the item is treated as "changed" (a modified time later than the note usually means a real change; an image is settled in tens of milliseconds). The shell stores computed fingerprints by path + size + modified time, so the next launch does not read them again.
// Waiting a second and computing only for the item open on the canvas would make a yellow bar appear and push the cards down

const NONE: ReadonlySet<string> = new Set();

export function useMaterialVersions(opts: {
  files: ReadonlyMap<string, Stored>;
  library: Pick<ReturnType<typeof useLibrary>, "byKey">;
  /** The item open on the canvas: its fingerprint is computed first */
  selectedKey: string | undefined;
  /** The notes on older versions in a notes folder have settled and differ from last time: rewrite its REVIEW.md */
  onChanged: (home: string) => void;
}) {
  const { files, library, selectedKey, onChanged } = opts;
  /** The item's current fingerprint: item key|modified time|size → sha256 (same as the shell's HashCache: with the same modified time, a changed size also means a different file) */
  const shas = useRef(new Map<string, string>());
  /** Fingerprints that could not be computed (unreadable): item key|modified time|size. Not retried, and treated as "unchanged" (unreadable means no warning) */
  const failed = useRef(new Set<string>());
  const [computed, setComputed] = useState(0);
  const tokenOf = (key: string, entry: MaterialEntry) => `${key}|${entry.mtime}|${entry.size}`;

  const versions = useMemo(() => {
    const out = new Map<string, Versions>();
    for (const [key, s] of files) {
      if (s.file.material.kind === "folder") continue;
      const entry = library.byKey.get(key);
      if (!entry) continue; // The item is gone: no modified time to compare and no fingerprint to compute
      const token = tokenOf(key, entry);
      const v = earlierVersions(s.file, entry.mtime, shas.current.get(token));
      out.set(key, v.pending && failed.current.has(token) ? { earlier: new Set(), pending: false } : v);
    }
    return out;
    // computed: re-evaluate whenever a fingerprint has been computed
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, library.byKey, computed]);

  // Compute one by one in the background: the item open on the canvas first, the rest in list order
  const busy = useRef(false);
  useEffect(() => {
    if (busy.current) return;
    const pending = [...versions].filter(([, v]) => v.pending).map(([key]) => key);
    const key = pending.includes(selectedKey ?? "") ? selectedKey! : pending[0];
    const entry = key ? library.byKey.get(key) : undefined;
    if (!key || !entry) return;
    const token = tokenOf(key, entry);
    busy.current = true;
    call("sha256", { path: entry.path })
      .then((sha) => shas.current.set(token, sha))
      .catch((e: unknown) => {
        failed.current.add(token);
        logError("Computing item fingerprint (matching notes on older versions)", e, "warn");
      })
      .finally(() => {
        busy.current = false;
        setComputed((n) => n + 1);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versions, selectedKey]);

  /** What each notes folder's (settled) notes on older versions looked like last time: rewrite REVIEW.md when it changes. Everything starts as empty, so a folder with no old notes when first read is not rewritten */
  const lastByHome = useRef(new Map<string, string>());
  useEffect(() => {
    const byHome = new Map<string, { home: string; parts: string[]; pending: boolean }>();
    for (const [key, s] of files) {
      const h = keyOf(s.home);
      const g = byHome.get(h) ?? { home: s.home, parts: [], pending: false };
      const v = versions.get(key);
      if (v?.pending) g.pending = true;
      if (v?.earlier.size) g.parts.push(`${s.file.material.path}:${[...v.earlier].sort().join(",")}`);
      byHome.set(h, g);
    }
    for (const [h, g] of byHome) {
      if (g.pending) continue; // Not finished computing: wait until it settles before writing, to avoid writing twice
      const sig = g.parts.sort().join("\n");
      if ((lastByHome.current.get(h) ?? "") === sig) continue;
      lastByHome.current.set(h, sig);
      onChanged(g.home);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versions]);

  /** The notes of this item written on older versions (ids) */
  const earlierOf = useCallback(
    (key: string | undefined): ReadonlySet<string> => (key ? versions.get(key)?.earlier : undefined) ?? NONE,
    [versions],
  );
  /** For REVIEW.md: the notes written on older versions for each item in this notes folder (material.path → id) */
  const earlierIn = (home: string): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    for (const [key, s] of files) {
      const v = versions.get(key);
      if (keyOf(s.home) === keyOf(home) && v?.earlier.size) out[s.file.material.path] = [...v.earlier];
    }
    return out;
  };

  /**
   * The item's current fingerprint (recorded in material_sha256 of a newly written note): what is known without reading the file is returned directly, then computed ones, and only if neither exists is it computed (seconds for a large video).
   * undefined when it cannot be computed (the note then records none and is matched by the rules for old notes)
   */
  const currentSha = async (entry: MaterialEntry, file: MaterialFile | undefined): Promise<string | undefined> => {
    const key = keyOf(entry.path);
    const token = tokenOf(key, entry);
    const hit = (file && knownSha(file, entry.mtime)) ?? shas.current.get(token);
    if (hit) return hit;
    try {
      const sha = await call("sha256", { path: entry.path });
      shas.current.set(token, sha);
      return sha;
    } catch (e) {
      logError("Computing item fingerprint (for a new note)", e, "warn");
      return undefined;
    }
  };
  /** Remember the fingerprint computed for the first note (computed along the way while reading item info) so it is not computed again */
  const rememberSha = (entry: MaterialEntry, sha: string) => shas.current.set(tokenOf(keyOf(entry.path), entry), sha);

  return { earlierOf, earlierIn, currentSha, rememberSha };
}
