import { joinPath } from "./paths.js";
import { DATA_DIR, MaterialFileError } from "./store.js";
import {
  MARK_COLOR_NAMES,
  MARK_COLORS,
  placeColors,
  shapesOf,
  type Annotation,
  type AnnotationCategory,
  type Material,
  type MaterialKind,
  type Shape,
} from "./types.js";

/**
 * Looks up one message (i18n/locales, ICU MessageFormat) and fills in its values. All text meant for AI goes through it, in the language
 * the caller gives (docs/adr/0001-i18n.md item 7): text copied for AI follows the UI language, REVIEW.md follows the language this notes
 * folder recorded
 * (.sniptoss/project.json).
 * core carries neither the messages nor a formatting library: the UI passes react-intl's formatMessage, and the CLI and tests wrap one
 * around the intl-messageformat package
 */
export type Translate = (id: string, values?: Record<string, string | number>) => string;

/** The category name (message category.*, shared by the UI and the capture overlay) */
export const categoryLabel = (c: AnnotationCategory, t: Translate) => t(`category.${c}`);
/** The item kind name (message kind.*) */
export const kindLabel = (k: MaterialKind, t: Translate) => t(`kind.${k}`);

/** Why a notes file cannot be read (for agents and the CLI; the UI's explanation is in the messages app.file.reason.*) */
export const describeUnreadable = (e: unknown, t: Translate) =>
  e instanceof MaterialFileError
    ? t("ai.unreadable.detail", { reason: t(`ai.unreadable.${e.reason}`), detail: e.detail })
    : e instanceof Error
      ? e.message
      : String(e);

// ---------- Whole-folder comments (pizhu/3) ----------

export const isFolder = (m: Material) => m.kind === "folder";
/** How a folder is written in REVIEW.md: assets/ui/; the folder that holds .sniptoss itself is written ./ */
const folderPath = (m: Material) => (m.path === "." ? "./" : `${m.path}/`);
/** A folder's name: the folder that holds .sniptoss uses its own name (root is its absolute path) */
const folderName = (m: Material, root: string) =>
  m.path === "."
    ? root
        .replace(/[\\/]+$/, "")
        .split(/[\\/]/)
        .pop() || root
    : m.path.split("/").pop()!;
/** Folder comments come first (the whole before each file), and the folder that holds .sniptoss comes before all the others */
function foldersFirst<T extends { material: Material }>(list: T[]): T[] {
  const rank = (m: Material) => (!isFolder(m) ? 2 : m.path === "." ? 0 : 1);
  return list
    .map((g, i) => ({ g, i }))
    .sort((a, b) => rank(a.g.material) - rank(b.g.material) || a.i - b.i)
    .map((x) => x.g);
}

/** The four categories, in the order shown in the UI */
export const CATEGORIES: readonly AnnotationCategory[] = ["change", "remove", "add", "question"];

/**
 * 63.2 → 01:03.200; an hour or more, 7140 → 1:59:00.000. hours = include the hours even under one hour (the seek bar of a long video: its
 * width does not jump when playback passes one hour)
 */
export function formatTime(seconds: number, hours = false): string {
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const rest = ms % 1000;
  const mmss = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(rest).padStart(3, "0")}`;
  // An hour or more includes the hours (h:mm:ss.mmm), so 1:59:00 is not written as 119:00.000
  return h > 0 || hours ? `${h}:${mmss}` : mmss;
}

function frameSize(material: Material, page?: number): { width: number; height: number } | undefined {
  if (page !== undefined) return material.pages?.[page - 1];
  if (material.width && material.height) return { width: material.width, height: material.height };
  return undefined;
}

/**
 * Percentages and pixels are turned into strings before they go into a message: number arguments get locale thousands separators (1,920),
 * which coordinates for AI must not have (the capture overlay's ShapeText does the same)
 */
const pct = (v: number) => String(Math.round(Math.min(1, Math.max(0, v)) * 100));

const ACROSS = ["top", "middle", "bottom"];
const DOWN = ["left", "middle", "right"];
const PLACES = [
  ["topLeft", "top", "topRight"],
  ["left", "center", "right"],
  ["bottomLeft", "bottom", "bottomRight"],
];

/**
 * The rough position in the frame (a 3×3 grid): an AI that only reads text cannot picture "x=230 y=86", but "upper left of the frame" is
 * clear at once.
 * With w and h it is a region: a very wide or very tall one is described as spanning across / down. The capture overlay (app/ShapeText.cs)
 * follows this, and both sides run the same golden file tests/golden/where.zh-CN.json
 */
function placeName(t: Translate, cx: number, cy: number, w = 0, h = 0): string {
  const col = cx < 1 / 3 ? 0 : cx > 2 / 3 ? 2 : 1;
  const row = cy < 1 / 3 ? 0 : cy > 2 / 3 ? 2 : 1;
  if (w >= 0.66 && h >= 0.66) return t("ai.where.most");
  if (w >= 0.66) return t(`ai.where.across.${ACROSS[row]}`);
  if (h >= 0.66) return t(`ai.where.down.${DOWN[col]}`);
  return t(`ai.where.place.${PLACES[row][col]}`);
}

/**
 * "Region: upper left of the frame (x 12%–52%, y 8%–18%), x=230 y=86 w=768 h=108 px" (shown in English; the text follows the chosen
 * language): a plain-language position and percentages first, then the raw pixels
 * (an AI cropping with code or redrawing a part needs exact pixels). Without the item's size only percentages are given
 */
export function describeShape(shape: Shape, size: { width: number; height: number } | undefined, t: Translate): string {
  const px = (v: number, total: number) => String(Math.round(v * total));
  const span = (x: number, y: number, w: number, h: number) =>
    t("ai.where.span", { place: placeName(t, x + w / 2, y + h / 2, w, h), x1: pct(x), x2: pct(x + w), y1: pct(y), y2: pct(y + h) }) +
    (size ? t("ai.where.spanPx", { x: px(x, size.width), y: px(y, size.height), w: px(w, size.width), h: px(h, size.height) }) : "");
  const spot = (x: number, y: number) => t("ai.where.spot", { place: placeName(t, x, y), x: pct(x), y: pct(y) });
  switch (shape.type) {
    case "rect":
      return t("ai.where.rect", { span: span(shape.x, shape.y, shape.w, shape.h) });
    case "point":
      return (
        t("ai.where.point", { spot: spot(shape.x, shape.y) }) +
        (size ? t("ai.where.pointPx", { x: px(shape.x, size.width), y: px(shape.y, size.height) }) : "")
      );
    case "arrow": {
      const [fx, fy] = shape.from;
      const [tx, ty] = shape.to;
      return (
        t("ai.where.arrow", { from: spot(fx, fy), to: spot(tx, ty) }) +
        (size
          ? t("ai.where.arrowPx", { x1: px(fx, size.width), y1: px(fy, size.height), x2: px(tx, size.width), y2: px(ty, size.height) })
          : "")
      );
    }
    case "path": {
      const xs = shape.points.map((p) => p[0]);
      const ys = shape.points.map((p) => p[1]);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return t("ai.where.path", { span: span(x, y, Math.max(...xs) - x, Math.max(...ys) - y) });
    }
  }
}

/** How a color is described: the six presets by name (message markColor.name, per language), anything else (a hand-written color value) as is */
export function colorLabel(color: string, t: Translate): string {
  const i = MARK_COLORS.findIndex((c) => c.toLowerCase() === color.toLowerCase());
  return i < 0 ? color.toLowerCase() : t("markColor.name", { color: MARK_COLOR_NAMES[i] });
}

function describeMaterial(m: Material, t: Translate): string {
  if (m.kind === "folder") return t("ai.folderScope");
  const parts = [kindLabel(m.kind, t)];
  if (m.width && m.height) parts[0] += ` ${m.width}×${m.height}`;
  // The duration uses the same format as the times in notes (not "63.2s", which would not match the "minutes:seconds.milliseconds" the
  // intro describes)
  if (m.duration !== undefined) parts.push(formatTime(m.duration));
  if (m.pages) parts.push(t("ai.material.pages", { count: m.pages.length }));
  return parts.join(" · ");
}

/**
 * "00:12.500–00:15.000 · Region: upper left of the frame (…)" (shown in English; the text follows the chosen language): where it is (page,
 * time, position), without the category. Copy as Images colors the category separately.
 * bare: overall and timestamped comments are already listed under their own section, so the kind is not repeated (only page and time
 * remain, possibly empty)
 */
export function describeWhere(a: Annotation, m: Material, t: Translate, bare = false): string {
  const parts: string[] = [];
  const { page, time } = a.anchor;
  const shapes = shapesOf(a);
  if (page !== undefined) parts.push(t("ai.anchor.page", { page: String(page) }));
  if (time) parts.push(time.end !== undefined ? `${formatTime(time.start)}–${formatTime(time.end)}` : formatTime(time.start));
  // A note with several places: "2 places: Region …; Point …", and the comment applies to every place (ADR-0009; the intro says so too, see
  // manyHint).
  // When the places have different colors, each is prefixed with its color, "(Yellow) Point …": a color is changed so that the comment can
  // say which place to change how, by color
  if (shapes.length === 1) parts.push(describeShape(shapes[0], frameSize(m, page), t));
  else if (shapes.length > 1) {
    const colors = placeColors(a);
    const named = colors.every((c) => c !== undefined) && new Set(colors.map((c) => c!.toLowerCase())).size > 1;
    const one = (s: Shape, i: number) => {
      const where = describeShape(s, frameSize(m, page), t);
      return named ? t("ai.where.colored", { color: colorLabel(colors[i]!, t), where }) : where;
    };
    parts.push(t("ai.where.many", { count: shapes.length, list: shapes.map(one).join(t("ai.where.manySeparator")) }));
  } else if (!bare) parts.push(t(isFolder(m) ? "ai.anchor.wholeFolder" : time ? "ai.anchor.timed" : "ai.anchor.overall"));
  return parts.join(" · ");
}

/** A one-line position description such as "Change · 00:12.500–00:15.000 · Region x=… px" (bare as in describeWhere) */
export function describeAnchor(a: Annotation, m: Material, t: Translate, bare = false): string {
  const where = describeWhere(a, m, t, bare);
  return where ? `${categoryLabel(a.category, t)} · ${where}` : categoryLabel(a.category, t);
}

/** The replies and snapshot path under a note: shared by the text copied for AI and REVIEW.md */
function notesBelow(a: Annotation, dataDir: string, t: Translate): string[] {
  const lines = a.replies.map((r) => t("ai.reply", { author: r.author, body: r.body }));
  if (a.snapshot) lines.push(t("ai.snapshot", { path: `${dataDir}/${a.snapshot}` }));
  return lines;
}

function renderAnnotation(a: Annotation, m: Material, dataDir: string, t: Translate, earlier: boolean): string {
  return [`### [${a.id}] ${describeAnchor(a, m, t)}${earlier ? t("ai.earlier") : ""}`, a.body, ...notesBelow(a, dataDir, t)].join("\n");
}

/**
 * Which section of the notes panel a note belongs to; each section is numbered from 1 (docs/adr/0008-earlier-versions.md): marked = has
 * marks on the canvas (the numbers match the canvas), timed = timestamped comments (a moment or a range of a video, no position; about the
 * whole frame at that moment, as distinct from the whole video),
 * overall = overall comments (no time and no position; whole-folder comments belong here too), earlier = written on an earlier version of
 * the item (not drawn on the canvas)
 */
export type NoteSection = "marked" | "timed" | "overall" | "earlier";
export const NOTE_SECTIONS: readonly NoteSection[] = ["marked", "timed", "overall", "earlier"];
/** When no section is given, it is decided by whether the note has a position and a time */
export const sectionOf = (a: Annotation, section?: NoteSection): NoteSection =>
  section ?? (shapesOf(a).length ? "marked" : a.anchor.time ? "timed" : "overall");

/** When some note has several places, the intro says "the comment applies to every place" (Copy as Text, REVIEW.md) */
const manyHint = (list: readonly Annotation[], t: Translate) => (list.some((a) => shapesOf(a).length > 1) ? [t("ai.manyHint")] : []);

/** One item handed to an AI: the notes to hand over and their numbers in the UI */
export interface HandoffMaterial {
  material: Material;
  /** The notes folder (absolute path): paths of items and snapshots are relative to it */
  root: string;
  /** index is the number within its section; a missing section = decided by whether there is a position (see sectionOf) */
  items: { annotation: Annotation; index: number; section?: NoteSection }[];
  /** The item file cannot be found now (the group of missing items in the UI) */
  missing?: boolean;
}

export interface HandoffOptions {
  /** Text the user wrote in Settings to attach every time */
  extra?: string;
}

/**
 * The "category explanation: …" line: only explains the categories used this time; not needed when all are "Change" (without it, a
 * "Question" would also be swept under "please change according to the notes below")
 */
function categoryHint(used: AnnotationCategory[], t: Translate): string[] {
  const set = new Set(used);
  if ([...set].every((c) => c === "change")) return [];
  const list = CATEGORIES.filter((c) => set.has(c)).map((c) => t(`ai.categoryMeaning.${c}`));
  return [t("ai.categoryHint", { list: list.join(t("ai.categoryHint.separator")) })];
}

/** The name of the project folder (notes folder): the last path segment; for a drive root, the drive letter */
const projectName = (root: string) =>
  root
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop() || root;

/**
 * The text that Copy as Text puts on the clipboard: the notes themselves are written into it, so pasting it into any agent's conversation
 * is enough to start working, without the agent looking for .sniptoss. Used for one note, one item or a whole project.
 * Files are written as their "location in the project"; the project folder's full path is given at the start and again after each file. If
 * the project was moved or the AI works elsewhere, the full paths no longer match, but the location in the project still finds the file (so
 * the AI can match things up after a folder move too).
 * The AI is not told to run a command to mark notes "Done" afterwards: this only hands the AI what to change, and the notes stay as a
 * record, not marked off or collapsed. The language follows the UI (t)
 */
export function renderHandoff(list: HandoffMaterial[], t: Translate, options: HandoffOptions = {}): string {
  const groups = foldersFirst(list.filter((g) => g.items.length > 0));
  const items = groups.flatMap((g) => g.items);
  const total = items.length;
  // Resolved notes can be checked and copied too: they must be marked as such, or the agent would treat them as to-dos and redo them
  const done = items.filter((i) => i.annotation.status !== "open").length;
  const folders = groups.filter((g) => isFolder(g.material)).length;
  const out: string[] = [];

  const only = groups.length === 1 ? groups[0].material : undefined;
  if (done === total) out.push(t("ai.handoff.allDone", { count: total }));
  else if (only && isFolder(only)) out.push(t("ai.handoff.folder", { count: total }));
  else if (total === 1) out.push(t("ai.handoff.one"));
  else if (only) out.push(t("ai.handoff.material", { count: total, thisKind: t("app.kind.this", { kind: only.kind }) }));
  else {
    const parts = [
      ...(folders ? [t("ai.handoff.folders", { count: folders })] : []),
      ...(groups.length > folders ? [t("ai.handoff.items", { count: groups.length - folders })] : []),
    ];
    out.push(t("ai.handoff.mixed", { parts: parts.join(t("ai.listJoin")), count: total }));
  }
  if (done > 0 && done < total) out.push(t("ai.handoff.someDone", { count: done }));
  if (folders) out.push(t("ai.handoff.folderHint"));
  out.push(
    ...manyHint(
      items.map((i) => i.annotation),
      t,
    ),
  );
  out.push(
    ...categoryHint(
      items.filter((i) => i.annotation.status === "open").map((i) => i.annotation.category),
      t,
    ),
  );
  // Folder comments have no snapshot, snapshots may be turned off, and some may not have been generated: only say "every note has one
  // attached" when every note really has
  const shots = items.filter((i) => i.annotation.snapshot).length;
  const shotHint = shots === 0 ? "" : shots === total ? t("ai.handoff.shotsAll", { count: total }) : t("ai.handoff.shotsSome");
  out.push(t("ai.handoff.hints", { shots: shotHint, position: t("ai.positionHint") }).trim());

  // Where the project folders are: one gets a single sentence; several are listed, and each file also says which project it belongs to
  const roots = [...new Set(groups.map((g) => g.root.replace(/[\\/]+$/, "")))];
  const several = roots.length > 1;
  if (several) out.push(t("ai.handoff.roots"), ...roots.map((r) => t("ai.handoff.rootLine", { name: projectName(r), path: r })));
  else out.push(t("ai.handoff.oneRoot", { name: projectName(roots[0]), path: roots[0] }));
  out.push(t("ai.handoff.relative"), "");

  for (const g of groups) {
    const m = g.material;
    const project = projectName(g.root);
    const name = isFolder(m) ? folderName(m, g.root) : m.path.split("/").pop()!;
    const where = !isFolder(m)
      ? t(several ? "ai.handoff.fileIn" : "ai.handoff.file", { path: m.path, project })
      : m.path === "."
        ? t(several ? "ai.handoff.folderSelfIn" : "ai.handoff.folderSelf", { project })
        : t(several ? "ai.handoff.folderIn" : "ai.handoff.folderPath", { path: `${m.path}/`, project });
    out.push(
      `## ${isFolder(m) ? t("ai.handoff.folderHeading", { name }) : name}  ·  ${describeMaterial(m, t)}`,
      t("ai.handoff.fullPath", { where, path: joinPath(g.root, m.path) }),
      ...(g.missing ? [t("ai.handoff.gone", { gone: t("ai.gone") })] : []),
      "",
    );
    // Sections follow the notes panel: on the canvas → timestamped comments → overall comments → on earlier versions, each numbered on its
    // own (ADR-0008).
    // A folder's group heading already says it is the whole folder, so it is not split into sections
    const rank = (x: (typeof g.items)[number]) => NOTE_SECTIONS.indexOf(sectionOf(x.annotation, x.section));
    const ordered = isFolder(m)
      ? g.items
      : g.items
          .map((x, i) => ({ x, i }))
          .sort((a, b) => rank(a.x) - rank(b.x) || a.i - b.i)
          .map(({ x }) => x);
    let last: NoteSection = "marked";
    for (const { annotation: a, index, section } of ordered) {
      const s = sectionOf(a, section);
      if (!isFolder(m) && s !== last) out.push(`### ${t(`ai.handoff.section.${s}`)}`, "");
      last = s;
      const status = a.status === "resolved" ? t("ai.status.resolved") : a.status === "wontfix" ? t("ai.status.wontfix") : "";
      out.push(
        `${index}.${status} ${describeAnchor(a, m, t, (s === "overall" || s === "timed") && !isFolder(m))}`,
        a.body,
        ...notesBelow(a, DATA_DIR, t),
        "",
      );
    }
  }

  const extra = options.extra?.trim();
  if (extra) out.push(extra);
  return out.join("\n").trimEnd();
}

export interface ReviewOptions {
  /** Also list resolved (done / won't fix) notes at the end; off by default */
  includeResolved?: boolean;
  /**
   * The data directory in front of snapshot paths, .sniptoss by default; the CLI passes .pizhu when it writes REVIEW.md in a legacy project
   * that has not been migrated
   */
  dataDir?: string;
  /**
   * Notes files that cannot be read (broken, or written by a newer version and not understood): file is the path relative to the project,
   * reason as in describeUnreadable.
   * The notes inside cannot be listed, so the top must say so, or an agent would assume these are all the notes
   */
  unreadable?: { file: string; reason: string }[];
  /** material.path of items that are gone (deleted, renamed, moved): marked after the heading so the agent does not assume the file is there */
  missing?: string[];
  /**
   * Notes written on an earlier version of the item: material.path → note ids (as recognized by versions.ts). Each is marked as having its
   * position defined by the snapshot (ADR-0008)
   */
  earlier?: Record<string, readonly string[]>;
}

/**
 * Generates REVIEW.md: open notes grouped by item with whole-folder comments first; resolved ones can be appended. The language is the one
 * this notes folder recorded (t, see reviewLanguage)
 */
export function renderReview(
  files: { material: Material; annotations: Annotation[] }[],
  t: Translate,
  options: ReviewOptions = {},
): string {
  const group = (pick: (a: Annotation) => boolean) =>
    foldersFirst(files.map((f) => ({ material: f.material, list: f.annotations.filter(pick) })).filter((g) => g.list.length > 0));
  const open = group((a) => a.status === "open");
  const total = open.reduce((n, g) => n + g.list.length, 0);
  const title = (m: Material) => (isFolder(m) ? folderPath(m) : m.path);
  const bad = options.unreadable ?? [];
  const missing = new Set(options.missing ?? []);
  const gone = (m: Material) => (!isFolder(m) && missing.has(m.path) ? t("ai.review.gone", { gone: t("ai.gone") }) : "");

  const out = [t("ai.review.title", { count: total }), ""];
  if (bad.length) {
    out.push(
      t("ai.review.unreadable", { count: bad.length }),
      ...bad.map((b) => t("ai.review.unreadableLine", { file: b.file, reason: b.reason })),
      "",
    );
  }
  if (total === 0) {
    out.push(t(bad.length ? "ai.review.noneReadable" : "ai.review.none"), "");
  } else {
    out.push(
      t("ai.review.intro"),
      ...(open.some((g) => isFolder(g.material)) ? [t("ai.review.folderHint")] : []),
      ...manyHint(
        open.flatMap((g) => g.list),
        t,
      ),
      ...categoryHint(
        open.flatMap((g) => g.list.map((a) => a.category)),
        t,
      ),
      t("ai.review.paths", { position: t("ai.positionHint") }),
      "",
    );
    for (const g of open) {
      out.push(`## ${title(g.material)}  ·  ${describeMaterial(g.material, t)}${gone(g.material)}`, "");
      const earlier = new Set(options.earlier?.[g.material.path] ?? []);
      for (const a of g.list) out.push(renderAnnotation(a, g.material, options.dataDir ?? DATA_DIR, t, earlier.has(a.id)), "");
    }
  }

  if (options.includeResolved) {
    const done = group((a) => a.status !== "open");
    if (done.length) {
      out.push("---", "", t("ai.review.done"), "");
      for (const g of done) {
        out.push(`## ${title(g.material)}${isFolder(g.material) ? t("ai.review.folderSuffix") : ""}`, "");
        for (const a of g.list) out.push(t("ai.review.doneLine", { id: a.id, status: a.status, body: a.body }));
        out.push("");
      }
    }
  }
  return out.join("\n");
}
