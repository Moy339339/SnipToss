import { describe, expect, it, vi } from "vitest";

// library.ts imports host.ts, which looks for window.chrome.webview as soon as it loads; only pure functions are tested here, so an empty
// window is provided (as in host.test.ts)
vi.stubGlobal("window", {});
const { distinctPlaces, entryContaining, entryTrees, folderNote, groupProjects, kindOfExt, listRows, locateIn, projectPlace } =
  await import("../src/library");
type LibraryEntry = import("../src/host").LibraryEntry;
type MaterialEntry = import("../src/host").MaterialEntry;
type ScanResult = import("../src/host").ScanResult;
type Row = import("../src/library").Row;

describe("distinctPlaces: the subtitle of same-named projects goes up to the level that tells them apart", () => {
  it("the difference comes early: goes up to that level", () => {
    expect(distinctPlaces(["E:\\work\\clientA\\v1", "E:\\work\\clientB\\v1"])).toEqual(["clientA\\v1", "clientB\\v1"]);
  });
  it("the last level already differs: only the last level is written", () => {
    expect(distinctPlaces(["E:\\work\\a", "E:\\work\\b"])).toEqual(["a", "b"]);
  });
  it("case-insensitive: names that differ only in case count as equal, so it goes further up", () => {
    expect(distinctPlaces(["D:\\X\\Renders", "E:\\x\\renders"])).toEqual(["D:\\X\\Renders", "E:\\x\\renders"]);
  });
  it("two of three end the same: each goes only as far as it needs", () => {
    expect(distinctPlaces(["E:\\a\\p\\out", "E:\\b\\p\\out", "E:\\a\\q"])).toEqual(["a\\p\\out", "b\\p\\out", "q"]);
  });
  it("POSIX paths (macOS shell): the same rule, joined with slashes", () => {
    expect(distinctPlaces(["/Users/alex/work/clientA/v1", "/Users/alex/work/clientB/v1"])).toEqual(["clientA/v1", "clientB/v1"]);
    expect(distinctPlaces(["/Volumes/X/Renders", "/Volumes/x/renders"])).toEqual(["/Volumes/X/Renders", "/Volumes/x/renders"]);
  });
});

describe("folderNote: what a folder does not list", () => {
  const scan = { entry: "E:\\p", kind: "folder" as const, project: "E:\\p", materials: [] };
  it("neither: nothing is attached", () => {
    expect(folderNote(scan)).toBeUndefined();
    expect(folderNote({ ...scan, others: null, skippedDirs: [] })).toBeUndefined();
    expect(folderNote(undefined)).toBeUndefined();
  });
  it("unsupported files and skipped folders: both are attached", () => {
    expect(folderNote({ ...scan, others: { count: 3, exts: ["psd", "svg"] }, skippedDirs: ["dist"] })).toEqual({
      others: { count: 3, exts: ["psd", "svg"] },
      skipped: ["dist"],
    });
  });
});

describe("entryContaining: which entry an item belongs to (used by the library filter)", () => {
  const entry = (path: string) => ({ path, pinned: false, kind: "folder" as const });
  it("the entry itself and what is inside the entry's folder count; a name that merely starts the same does not", () => {
    const list = [entry("E:\\work\\a"), entry("E:\\work\\ab\\x.png")];
    expect(entryContaining(list, "E:\\work\\a\\sub\\1.png")?.path).toBe("E:\\work\\a");
    expect(entryContaining(list, "e:\\WORK\\ab\\x.png")?.path).toBe("E:\\work\\ab\\x.png");
    expect(entryContaining(list, "E:\\work\\abc\\1.png")).toBeUndefined();
  });
  it("an entry that is a drive root (E:\\): the items inside belong to it too (an extra \\ appended would make the filter result empty)", () => {
    expect(entryContaining([entry("E:\\")], "E:\\renders\\1.png")?.path).toBe("E:\\");
  });
});

describe("projectPlace: the location line under a project row", () => {
  it("the parent of the project folder, with the user directory written as ~", () => {
    expect(projectPlace("C:\\Users\\alex\\work\\demo")).toBe("~\\work");
    expect(projectPlace("C:\\Users\\alex\\demo")).toBe("~");
    expect(projectPlace("E:\\projects\\demo")).toBe("E:\\projects");
    expect(projectPlace("E:\\demo")).toBe("E:\\");
  });
  it("a drive root has no parent: nothing is written (otherwise the name and this line would both be E:\\)", () => {
    expect(projectPlace("E:\\")).toBeUndefined();
  });
  it("POSIX paths (macOS shell): the home folder is ~ as well; the root has no parent", () => {
    expect(projectPlace("/Users/alex/work/demo")).toBe("~/work");
    expect(projectPlace("/Users/alex/demo")).toBe("~");
    expect(projectPlace("/Volumes/Work/demo")).toBe("/Volumes/Work");
    expect(projectPlace("/demo")).toBe("/");
    expect(projectPlace("/")).toBeUndefined();
  });
});

describe("kindOfExt: decides whether a file added on its own, but not listed, is an unsupported format", () => {
  it("same as the shell's MaterialScanner.Kinds; with or without the dot, either case", () => {
    expect(kindOfExt(".PNG")).toBe("image");
    expect(kindOfExt("jpeg")).toBe("image");
    expect(kindOfExt(".mov")).toBe("video");
    expect(kindOfExt(".pdf")).toBeUndefined();
  });
});

// ---------- How the list is ordered: groupProjects / listRows / locateIn (pure functions split out of useLibrary) ----------

/** An item: entry = the list entry it belongs to (for a single file, itself) */
function material(home: string, entry: string, path: string): MaterialEntry {
  const rel = path === entry ? path.split("\\").pop()! : path.slice(entry.length + 1).replaceAll("\\", "/");
  return { path, rel, kind: "image", size: 1, mtime: 0, home, homeRel: path.slice(home.length + 1).replaceAll("\\", "/"), url: "" };
}

const DEMO = "E:\\work\\demo";
const at = (rel: string) => `${DEMO}\\${rel}`;

/**
 * Three projects: demo (the project folder itself is an entry, its a.png was also added on its own, and so was out.png in the skipped dist),
 * renders (a pinned single file), and new (just added, not scanned yet). Newly added entries come first in the list
 */
function fixture() {
  const entries: LibraryEntry[] = [
    { path: "F:\\new\\y.png", pinned: false, kind: "file" },
    { path: DEMO, pinned: false, kind: "folder" },
    { path: at("a.png"), pinned: false, kind: "file" },
    { path: "D:\\renders\\x.png", pinned: true, kind: "file" },
    { path: at("dist\\out.png"), pinned: false, kind: "file" },
  ];
  const scans = new Map<string, ScanResult>();
  const put = (s: ScanResult) => scans.set(s.entry.toLowerCase(), s);
  put({
    entry: DEMO,
    kind: "folder",
    project: DEMO,
    materials: ["b.png", "shots\\2.png", "shots\\10.png", "a.png"].map((r) => material(DEMO, DEMO, at(r))),
    truncatedAt: 5000,
    others: { count: 1, exts: ["psd"] },
  });
  put({ entry: at("a.png"), kind: "file", project: DEMO, materials: [material(DEMO, at("a.png"), at("a.png"))] });
  put({ entry: at("dist\\out.png"), kind: "file", project: DEMO, materials: [material(DEMO, at("dist\\out.png"), at("dist\\out.png"))] });
  put({
    entry: "D:\\renders\\x.png",
    kind: "file",
    project: "D:\\renders",
    materials: [material("D:\\renders", "D:\\renders\\x.png", "D:\\renders\\x.png")],
  });
  const trees = entryTrees(entries, scans);
  const projects = groupProjects(entries, scans, trees);
  return { entries, scans, trees, projects };
}

const rowText = (r: Row) =>
  r.type === "project"
    ? `P ${r.project.home}`
    : r.type === "entry"
      ? `E ${r.entry.path}`
      : r.type === "folder"
        ? `D ${r.folder.path}`
        : `F ${r.material.path}`;

describe("groupProjects: entries are grouped into projects by notes folder", () => {
  it("pinned projects come first, the rest in the order their entries first appear in the list; entries not scanned yet are grouped by their folder for now", () => {
    expect(fixture().projects.map((p) => p.home)).toEqual(["D:\\renders", "F:\\new", DEMO]);
  });
  it("the project folder itself is an entry: its content is listed directly under the project, entries already in the tree are not listed again, and ones not in the tree (skipped) are listed separately afterwards", () => {
    const demo = fixture().projects[2];
    expect(demo.root?.path).toBe(DEMO);
    expect(demo.tree?.folders.map((f) => f.name)).toEqual(["shots"]);
    expect(demo.shown.map((e) => e.path)).toEqual([at("dist\\out.png")]);
    expect(demo.truncatedAt).toBe(5000);
  });
  it("all items of a project are in display order: folders first, numbers in names compared by value; the same file counts once", () => {
    expect(fixture().projects[2].materials.map((m) => m.path)).toEqual([
      at("shots\\2.png"),
      at("shots\\10.png"),
      at("a.png"),
      at("b.png"),
      at("dist\\out.png"),
    ]);
  });
});

describe("listRows: which rows the list shows", () => {
  it("projects are expanded and folders collapsed by default; what is not listed hangs off the last row of an expanded folder entry", () => {
    const { projects, scans, trees } = fixture();
    const rows = listRows(projects, scans, trees, new Set(), new Set());
    expect(rows.map(rowText)).toEqual([
      "P D:\\renders",
      "E D:\\renders\\x.png",
      "P F:\\new",
      "E F:\\new\\y.png",
      `P ${DEMO}`,
      `D ${at("shots")}`,
      `F ${at("a.png")}`,
      `F ${at("b.png")}`,
      `E ${at("dist\\out.png")}`,
    ]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1, 0, 1, 0, 1, 1, 1, 1]);
    expect(rows[7]).toMatchObject({ note: { others: { count: 1, exts: ["psd"] } } });
    // An entry for a single file carries its item; one that is not scanned yet has none
    expect(rows[1]).toMatchObject({ material: { path: "D:\\renders\\x.png" } });
    expect(rows[3]).toMatchObject({ material: undefined });
  });
  it("an expanded folder lists what is inside; a collapsed project leaves only the project row", () => {
    const { projects, scans, trees } = fixture();
    const rows = listRows(projects, scans, trees, new Set([at("shots").toLowerCase()]), new Set([DEMO.toLowerCase()]));
    expect(rows.map(rowText)).toEqual(["P D:\\renders", "E D:\\renders\\x.png", "P F:\\new", "E F:\\new\\y.png", `P ${DEMO}`]);
    const open = listRows(projects, scans, trees, new Set([at("shots").toLowerCase()]), new Set());
    expect(open.slice(5, 8).map((r) => [rowText(r), r.depth])).toEqual([
      [`D ${at("shots")}`, 1],
      [`F ${at("shots\\2.png")}`, 2],
      [`F ${at("shots\\10.png")}`, 2],
    ]);
  });
});

describe("locateIn: where a path is in the list (for paths brought in by the command line or the context menu, located once loaded)", () => {
  it("a file inside a folder: the folders on the way are expanded (not the project folder itself) and it is selected", () => {
    const { projects, scans, trees } = fixture();
    expect(locateIn(at("SHOTS\\10.png"), projects, scans, trees)).toMatchObject({
      project: DEMO,
      open: [at("shots")],
      material: { path: at("shots\\10.png") },
    });
  });
  it("a folder: selects the first item inside, and the subfolders on the way are expanded too", () => {
    const { projects, scans, trees } = fixture();
    expect(locateIn(DEMO, projects, scans, trees)).toMatchObject({
      project: DEMO,
      open: [at("shots")],
      material: { path: at("shots\\2.png") },
    });
  });
  it("an entry for a single file: that file; a path not in the list: nothing", () => {
    const { projects, scans, trees } = fixture();
    expect(locateIn("D:\\renders\\x.png", projects, scans, trees)).toMatchObject({
      project: "D:\\renders",
      open: [],
      material: { path: "D:\\renders\\x.png" },
    });
    expect(locateIn(at("dist\\out.png"), projects, scans, trees)).toMatchObject({ project: DEMO, open: [] });
    expect(locateIn("E:\\elsewhere\\z.png", projects, scans, trees)).toBeUndefined();
  });
});
