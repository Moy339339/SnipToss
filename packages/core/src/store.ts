// Pure logic, no file system access: shared by the desktop app (inside WebView2) and the CLI (Node).
// The actual reading and writing live in the app's Bridge and in cli/src/fs-store.ts.

import { READABLE_SCHEMAS, SCHEMA, type Anchor, type Annotation, type MaterialFile, type Shape, type TargetKind } from "./types.js";
import { checkMaterialFile, isObj, show } from "./validate.js";

/** The notes data directory, placed in the notes folder (the item's project) */
export const DATA_DIR = ".sniptoss";
/**
 * The name before the rename (docs/adr/0007-rename.md): the shell renames it to .sniptoss when it opens a project;
 * the CLI, meeting a project that has not been migrated, reads and writes it in place (cli/src/fs-store.ts) and creates nothing new in it
 */
export const LEGACY_DATA_DIR = ".pizhu";
export const ANNOTATIONS_DIR = `${DATA_DIR}/annotations`;
export const REVIEW_FILE = `${DATA_DIR}/REVIEW.md`;
/** The name of the command line for agents; the write-back script placed in the notes folder is .sniptoss/sniptoss.cmd */
export const CLI_NAME = "sniptoss";
export const SHIM_FILE = `${DATA_DIR}/${CLI_NAME}.cmd`;

/** The file name ending for folder comments. Items always have an extension (.png.json), so it cannot collide */
export const FOLDER_SUFFIX = "@folder.json";

/**
 * The maximum length of a notes file name in characters (UTF-16). NTFS allows 255 per name, and the suffix of the temporary file is
 * appended when writing (about 45 characters in the shell).
 * Without a limit, an item buried deep in the project (a relative path of over two hundred characters) could not have its notes saved
 */
export const MAX_SLUG = 200;
/** How many characters at the end to keep when the name is too long (enough to tell which item it is) */
const SLUG_TAIL = 120;

/**
 * assets/hero.png → assets__hero.png.json; folder assets/ui → assets__ui@folder.json,
 * and the folder that holds .sniptoss itself (.) → @folder.json.
 * Over MAX_SLUG: only the last SLUG_TAIL characters are kept, followed by ~ and a fingerprint of the whole path, e.g.
 * …__final-draft.png~1f3a9c0b7d2e4f68.json
 */
export function slugFor(path: string, kind?: TargetKind): string {
  const norm = path.replaceAll("\\", "/");
  const base = kind === "folder" && path === "." ? "" : norm.replaceAll("/", "__");
  const suffix = kind === "folder" ? FOLDER_SUFFIX : ".json";
  if (base.length + suffix.length <= MAX_SLUG) return base + suffix;
  let tail = base.slice(-SLUG_TAIL);
  if (/^[\uDC00-\uDFFF]/.test(tail)) tail = tail.slice(1); // do not cut in the middle of a two-character code point such as an emoji
  return `${tail}~${fingerprint(norm)}${suffix}`;
}

/**
 * A path fingerprint: 64-bit FNV-1a (over UTF-16 characters), 16 hex digits. Not for security, only so long names do not collide; the UI
 * and the CLI compute the same value
 */
function fingerprint(text: string): string {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) h = ((h ^ BigInt(text.charCodeAt(i))) * 0x100000001b3n) & 0xffffffffffffffffn;
  return h.toString(16).padStart(16, "0");
}

/** The notes file of an item (or folder), relative to the project root */
export function annotationFileFor(path: string, kind?: TargetKind): string {
  return `${ANNOTATIONS_DIR}/${slugFor(path, kind)}`;
}

/**
 * A notes file cannot be read. reason: json = not valid JSON; schema = an unrecognized format; invalid = wrong fields (itemized in detail);
 * newer = written by a newer version that this one cannot understand. detail holds only field paths and symbols; the UI and the CLI each
 * supply the explanatory text
 */
export class MaterialFileError extends Error {
  constructor(
    readonly reason: "json" | "schema" | "invalid" | "newer",
    readonly detail: string,
    readonly file: string,
  ) {
    super(`${file}: ${reason}: ${detail}`);
  }
}

/** Whether schema is a sniptoss/N newer than this version (ADR-0006: what can be read is opened read-only and not changed) */
export function isNewerSchema(schema: unknown): boolean {
  const m = typeof schema === "string" ? /^sniptoss\/(\d+)$/.exec(schema) : null;
  return !!m && Number(m[1]) > Number(SCHEMA.split("/")[1]);
}

/**
 * Whether this version of the program may change the file: one written by a newer version is read-only, so it is not written back with an
 * outdated understanding (ADR-0006 item 4)
 */
export const isWritable = (file: MaterialFile) => file.schema === SCHEMA;

/**
 * Parses a notes file: validates the fields and fills in what can be filled in (rules in docs/annotation-format.md, "Reading rules").
 * An older version is a subset of the newer one and is used as the newer version directly (it is written back as the newer version); a
 * newer version keeps its own schema (isWritable is false).
 * Unrecognized fields are kept as they are, so writing back does not lose them
 */
export function parseMaterialFile(text: string, name = "annotations.json"): MaterialFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    throw new MaterialFileError("json", (e as Error).message, name);
  }
  const schema = isObj(data) ? data.schema : undefined;
  const newer = isNewerSchema(schema);
  if (!newer && !READABLE_SCHEMAS.includes(schema as string)) throw new MaterialFileError("schema", show(schema), name);
  const problems = checkMaterialFile(data);
  if (problems.length)
    throw new MaterialFileError(
      newer ? "newer" : "invalid",
      problems.slice(0, 5).join("; ") + (problems.length > 5 ? ` (+${problems.length - 5})` : ""),
      name,
    );
  const file = data as MaterialFile;
  if (newer) return file;
  for (const a of file.annotations) upgradeAnchor(a.anchor as Anchor & { shape?: Shape });
  return { ...file, schema: SCHEMA };
}

/**
 * Up to sniptoss/4 a note had a single shape: it becomes a shapes list with one item (docs/adr/0009-several-places.md).
 * A sniptoss/5 file that follows the old documentation, with shape written by hand and no shapes, is read the same way; if both are
 * present, shapes wins and shape is kept as an unrecognized field. An empty shapes counts as absent
 */
function upgradeAnchor(anchor: Anchor & { shape?: Shape }) {
  if (anchor.shape !== undefined && anchor.shapes === undefined) {
    anchor.shapes = [anchor.shape];
    delete anchor.shape;
  }
  if (anchor.shapes?.length === 0) delete anchor.shapes;
}

export function serializeMaterialFile(file: MaterialFile): string {
  return JSON.stringify(file, null, 2) + "\n";
}

/** Creates an empty notes file for an item */
export function emptyMaterialFile(material: MaterialFile["material"]): MaterialFile {
  return { schema: SCHEMA, material, annotations: [] };
}

/** Replaces the note with the same id, or appends it if there is none; returns a new object and leaves the original alone */
export function upsertAnnotation(file: MaterialFile, annotation: Annotation): MaterialFile {
  const i = file.annotations.findIndex((a) => a.id === annotation.id);
  const annotations = [...file.annotations];
  if (i < 0) annotations.push(annotation);
  else annotations[i] = annotation;
  return { ...file, annotations };
}

export function removeAnnotation(file: MaterialFile, id: string): MaterialFile {
  return { ...file, annotations: file.annotations.filter((a) => a.id !== id) };
}

const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Six lowercase letters or digits, avoiding the ones already in taken */
export function newAnnotationId(taken: ReadonlySet<string>, random: () => number = Math.random): string {
  for (;;) {
    let id = "";
    for (let i = 0; i < 6; i++) id += ID_CHARS[Math.floor(random() * ID_CHARS.length)];
    if (!taken.has(id)) return id;
  }
}
