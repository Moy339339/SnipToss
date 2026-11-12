import { DATA_DIR, describeWhere, sectionOf, type HandoffMaterial, type MaterialFile, type Translate } from "@sniptoss/core";
import { fileKey } from "./annotationStore";
import { drawingShowsAt } from "./drawings";
import { drawPage, loadImage, loadSnapshot, openVideo, pngOf, type Cell, type FrameSource } from "./handoffFrames";
import { planPages, type PlanNote, type PlanUnit } from "./handoffPlan";
import { baseName, call, keyOf, logError, type HandoffImageNote, type HandoffImagePage, type MaterialEntry } from "./host";
import { placeColorOf } from "./markColors";
import type { Prefs } from "./prefs";

// Copy as Images: from the notes handed over to the pages given to the shell. handoffPlan.ts decides which notes share an image,
// handoffFrames.ts draws the pictures; here the items are loaded (off screen: the canvas is left alone), the pictures are stashed with the
// shell one by one, and each page gets its title, its notes and its file name.

export interface PagesContext {
  /** The library entry of an item (its URL); undefined when it is not in the library */
  entryOf: (key: string) => MaterialEntry | undefined;
  fileOf: (key: string) => MaterialFile | undefined;
  /** Drawings made on an earlier version of the item are not drawn on the current frame */
  earlierOf: (key: string) => ReadonlySet<string>;
  prefs: Pick<Prefs, "markColor" | "snapshotMax" | "copyImages" | "copyImagesMax">;
  translate: Translate;
  /** "project / file", the top line of an image */
  titleOf: (g: HandoffMaterial) => string;
  /** The file name of an image that carries a single note */
  nameOf: (g: HandoffMaterial, n: PlanNote) => string;
}

const sectionOfNote = (n: PlanNote) => n.section ?? sectionOf(n.annotation);
const snapshotOf = (u: PlanUnit) => {
  const shot = u.notes.find((n) => n.annotation.snapshot)?.annotation.snapshot;
  return shot ? `${DATA_DIR}/${shot}` : null;
};

/** Draws and stashes the pictures and returns the pages for copyImages; over = more images than the limit from Settings */
export async function buildPages(
  list: readonly HandoffMaterial[],
  ctx: PagesContext,
): Promise<{ pages: HandoffImagePage[]; over: boolean }> {
  const { prefs, translate } = ctx;
  const plan = planPages(list, { each: prefs.copyImages === "each", max: prefs.copyImagesMax });
  const batch = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const keyOfGroup = (group: number) => fileKey(list[group].root, list[group].material);

  // Items are loaded once per copy; a failed load is remembered too (every frame of that item then falls back to the stored snapshots)
  const images = new Map<number, Promise<FrameSource | undefined>>();
  const videos = new Map<number, Promise<Awaited<ReturnType<typeof openVideo>> | undefined>>();
  const quiet = <T>(what: string, p: Promise<T>): Promise<T | undefined> =>
    p.catch((e: unknown) => {
      logError(`copy as images: ${what}`, e, "warn");
      return undefined;
    });
  const sourceOf = async (u: PlanUnit): Promise<FrameSource | undefined> => {
    const entry = ctx.entryOf(keyOfGroup(u.group));
    if (!entry) return undefined;
    if (u.time === undefined) {
      if (!images.has(u.group)) images.set(u.group, quiet("item cannot be loaded", loadImage(entry)));
      return images.get(u.group);
    }
    if (!videos.has(u.group)) videos.set(u.group, quiet("video cannot be loaded", openVideo(entry)));
    const video = await videos.get(u.group);
    return video && quiet("video frame cannot be read", video.at(u.time, prefs.snapshotMax));
  };

  const noteOf = (g: HandoffMaterial, n: PlanNote, group?: string): HandoffImageNote => {
    const section = sectionOfNote(n);
    return {
      number: section === "marked" ? n.index : 0,
      category: n.annotation.category,
      where: describeWhere(n.annotation, g.material, translate) + (section === "earlier" ? translate("ai.earlier") : ""),
      body: n.annotation.body,
      color: placeColorOf(n.annotation, 0, prefs.markColor),
      ...(group ? { group } : {}),
    };
  };

  const pages: HandoffImagePage[] = [];
  try {
    for (const units of plan.pages) {
      const first = list[units[0].group];
      const mixed = new Set(units.map((u) => u.group)).size > 1;
      const sameRoot = new Set(units.map((u) => keyOf(list[u.group].root))).size === 1;
      /** On a page that mixes items: what each item is called, above its frame and above its notes */
      const labelOf = (g: HandoffMaterial) => (sameRoot && g.material.kind !== "folder" ? g.material.path : ctx.titleOf(g));

      let image: string | null = null;
      let snapshot: string | null = null;
      const lone = units.length === 1 ? units[0] : undefined;
      if (lone && lone.kind !== "frame") snapshot = lone.kind === "snapshot" ? snapshotOf(lone) : null;
      else {
        const cells: Cell[] = [];
        for (const u of units) {
          if (u.kind === "text") continue;
          const g = list[u.group];
          const caption = mixed ? labelOf(g) : undefined;
          const source = u.kind === "frame" ? await sourceOf(u) : undefined;
          if (source) {
            const key = keyOfGroup(u.group);
            const file = ctx.fileOf(key);
            const earlier = ctx.earlierOf(key);
            cells.push({
              frame: {
                source,
                notes: u.notes.map((n) => ({ annotation: n.annotation, number: sectionOfNote(n) === "marked" ? n.index : 0 })),
                drawings: (file?.drawings ?? []).filter(
                  (d) => !earlier.has(d.id) && drawingShowsAt(d, u.time, file?.material.frame_rate ?? 30),
                ),
                time: u.time,
                markColor: prefs.markColor,
              },
              caption,
            });
            continue;
          }
          // The item could not be drawn (gone, unreadable, a frame that would not seek), or this is a stored snapshot anyway
          const stored = snapshotOf(u);
          if (lone) snapshot = stored;
          else {
            const picture = stored ? await quiet("snapshot cannot be loaded", loadSnapshot(g.root, stored)) : undefined;
            if (picture) cells.push({ picture, caption });
          }
        }
        const canvas = drawPage(cells, prefs.snapshotMax);
        const data = canvas ? pngOf(canvas) : "";
        if (data) image = (await call("stashImage", { batch, data })).id;
      }

      const notes = units.flatMap((u) => u.notes.map((n) => noteOf(list[u.group], n, mixed ? labelOf(list[u.group]) : undefined)));
      const material = first.material;
      const file = material.kind === "folder" ? baseName(material.path === "." ? first.root : material.path) : baseName(material.path);
      pages.push({
        title: !mixed ? ctx.titleOf(first) : sameRoot ? baseName(first.root) || first.root : "",
        image,
        home: first.root,
        snapshot,
        notes,
        name: notes.length === 1 ? ctx.nameOf(first, units[0].notes[0]) : !mixed ? file : sameRoot ? baseName(first.root) || file : file,
      });
    }
  } finally {
    for (const v of videos.values()) void v.then((video) => video?.close());
  }
  return { pages, over: plan.over };
}
