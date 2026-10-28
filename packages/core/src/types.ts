// Corresponds one to one with docs/annotation-format.md; change the document first, then this file.

export const SCHEMA = "sniptoss/5";
/**
 * The versions that can still be read. Every older version is a subset of the newer one (pizhu/1 has no path.breaks, pizhu/2 has no folder
 * comments) and is used as the newer version once read.
 * sniptoss/4 and pizhu/3 have the same content and differ only by the rename (docs/adr/0007-rename.md); up to sniptoss/4 a note had a
 * single anchor.shape, which is converted to an anchor.shapes with one item when read (parseMaterialFile in store.ts,
 * docs/adr/0009-several-places.md)
 */
export const READABLE_SCHEMAS: readonly string[] = ["pizhu/1", "pizhu/2", "pizhu/3", "sniptoss/4", SCHEMA];

export type MaterialKind = "image" | "video" | "pdf" | "slides";
/** What a notes file is about: one item, or a whole folder (pizhu/3, a "whole-folder comment" covering every item inside) */
export type TargetKind = MaterialKind | "folder";
export type AnnotationStatus = "open" | "resolved" | "wontfix";
export type AnnotationCategory = "change" | "remove" | "add" | "question";

export interface PageSize {
  width: number;
  height: number;
}

export interface Material {
  /**
   * A forward-slash path relative to the directory that holds .sniptoss/; for a folder, the folder's path, and . = the folder that holds
   * .sniptoss itself
   */
  path: string;
  kind: TargetKind;
  /**
   * The item's SHA-256 when the first note was written; none for folders. Each note records its own too (Annotation.material_sha256), and
   * the note's own wins
   */
  sha256?: string;
  width?: number;
  height?: number;
  /** Video only, in seconds */
  duration?: number;
  /** pdf/slides only */
  pages?: PageSize[];
}

/** Coordinates are normalized to 0–1, origin at the top left */
export type Shape = (
  | { type: "rect"; x: number; y: number; w: number; h: number }
  | { type: "point"; x: number; y: number }
  | { type: "arrow"; from: [number, number]; to: [number, number] }
  /**
   * breaks (pizhu/2): a new run starts at these indexes and is not connected to the previous point. A stroke that leaves the frame and
   * comes back is split into several runs
   */
  | { type: "path"; points: [number, number][]; breaks?: number[] }
) & {
  /**
   * A color #rrggbb set for this place alone (optional): without it, the note's color is used, and without that, the one in Settings.
   * In files the app writes, every place carries one when the places differ in color and none does when they are the same (rule:
   * normalizePlaceColors in the UI's markColors.ts)
   */
  color?: string;
};

export interface Anchor {
  /** pdf/slides only, starting at 1 */
  page?: number;
  /** Video only, in seconds */
  time?: { start: number; end?: number };
  /**
   * The places this comment marks; the comment applies to every one of them, in the order they were drawn (since sniptoss/5; earlier
   * versions had a single shape).
   * Omitted = about the whole image / page / time range; it is never an empty array once read
   */
  shapes?: Shape[];
}

/** The places one note marks (empty for a note without a position) */
export const shapesOf = (a: { anchor: Anchor }): readonly Shape[] => a.anchor.shapes ?? [];

export interface Reply {
  author: string;
  body: string;
  at: string;
}

export interface Annotation {
  id: string;
  status: AnnotationStatus;
  category: AnnotationCategory;
  body: string;
  anchor: Anchor;
  /** Relative to .sniptoss/ */
  snapshot?: string;
  author: string;
  created_at: string;
  updated_at: string;
  /** When the note was last copied out (Copy as Text, Copy as Images); not an edit, so updated_at stays (optional, added later within sniptoss/4) */
  handed_off_at?: string;
  /**
   * The item's SHA-256 when this note was written; different from the item's current one = written on an earlier version (optional;
   * rules in versions.ts)
   */
  material_sha256?: string;
  /**
   * A color #rrggbb for this note's marks alone; without it, the mark color in Settings is used. It only affects drawing, not the comment
   * (optional)
   */
  color?: string;
  replies: Reply[];
}

/** The mark color format: # plus 6 hex digits (either case). The color is put into SVG, so no other form is accepted */
export const isMarkColor = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

/**
 * The preset mark colors in Settings, the context menu and the capture overlay (in order = number keys 1–6), and their names (the options
 * of the message markColor.name)
 */
export const MARK_COLORS: readonly string[] = ["#ff6a3d", "#ff4d6d", "#ffc233", "#3ddc84", "#5b8cff", "#b07cff"];
export const MARK_COLOR_NAMES: readonly string[] = ["orange", "red", "yellow", "green", "blue", "purple"];

/**
 * The color each place of a note is drawn in: the place's own, else the note's; undefined if neither (it follows the mark color in
 * Settings, which core does not know).
 * Malformed colors have already been dropped when reading (validate.ts)
 */
export const placeColors = (a: { anchor: Anchor; color?: string }): (string | undefined)[] =>
  shapesOf(a).map((s) => (isMarkColor(s.color) ? s.color : isMarkColor(a.color) ? a.color : undefined));

export interface MaterialFile {
  /** An older version that was read has already been converted to SCHEMA; a newer one is kept as is (read-only, see isWritable in store.ts) */
  schema: string;
  material: Material;
  annotations: Annotation[];
}
