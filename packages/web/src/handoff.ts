import { useEffect, useRef, useState, type RefObject } from "react";
import { useIntl } from "react-intl";
import { DATA_DIR, describeWhere, renderHandoff, type HandoffMaterial, type MaterialFile, type Translate } from "@sniptoss/core";
import { blockedReason, fileKey, type Stored } from "./annotationStore";
import { baseName, call, keyOf, logError, type HandoffImageItem, type MaterialEntry } from "./host";
import { relInside, type FolderTarget } from "./library";
import { placeColorOf } from "./markColors";
import { itemId, numbered, type Item } from "./panelScope";
import type { Prefs } from "./prefs";
import type { Notify, Report } from "./report";
import { shortWhen } from "./shortWhen";

// Handing over to AI (split out of Workspace): the checks in the notes panel (useChecks), and copy as text / images (useHandoff).
// ---------- Handing over to AI ----------
// A note is saved into the notes folder's .sniptoss (REVIEW.md + one snapshot per note) as soon as it is written. Copying for AI writes
// the note text and the absolute paths of the item and the snapshot straight into the text, so pasting it into a conversation lets the AI
// act without having to find files itself. Three levels, each with its own scope: a note card = that note; the buttons at the bottom of
// the notes panel = what the notes panel lists (with some checked, only those); a library project / folder = all items inside it.
// Checking (select-all is possible, choosing which notes go to the AI) is kept in memory only and cleared when the notes panel changes
// scope (so the button never mysteriously says "2 checked" when coming back). It remembers which scope it belongs to, so even in the
// frame right after switching, the previous scope's checks are not counted. When several items are listed, moving between them is not a
// scope change and the checks stay

/**
 * The two kinds of handoff: text = text for a local AI (Claude Code and Codex can read local files);
 * images = one image per note (for people using web-based AI or chat apps: they cannot read local paths and need images)
 */
export type HandoffMode = "text" | "images";

/**
 * Checks in the notes panel: groups are the groups the notes panel lists (cleared on a scope change), listForNav are the visible ones
 * (checks live only among these)
 */
export function useChecks(groups: readonly { key: string }[], listForNav: Item[]) {
  const scopeToken = groups.map((g) => g.key).join("\n");
  const [checks, setChecks] = useState<{ token?: string; ids: ReadonlySet<string> }>({ ids: new Set() });
  /** Checked and visible in the notes panel (after switching back to "open", checked resolved notes don't count) */
  const checkedList = checks.token === scopeToken ? listForNav.filter((it) => checks.ids.has(itemId(it))) : [];
  const checkedIds = new Set(checkedList.map(itemId));
  const lastChecked = useRef<string | undefined>(undefined);
  useEffect(() => {
    setChecks({ ids: new Set() });
    lastChecked.current = undefined;
  }, [scopeToken]);
  // Checks that are no longer visible (resolved notes collapsed, no search match, deleted) are dropped, so no invisible checks remain:
  // collapsing and showing again used to keep them sometimes and lose them after other checks in between, which was inconsistent
  const hiddenChecked = checks.token === scopeToken && checks.ids.size > checkedList.length;
  useEffect(() => {
    if (hiddenChecked) setChecks({ token: scopeToken, ids: new Set(checkedIds) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenChecked]);
  const setChecked = (ids: Iterable<string>) => setChecks({ token: scopeToken, ids: new Set(ids) });
  /**
   * Check / uncheck one note; range = Shift-click: everything from the note clicked last to this one takes this note's new state (it can
   * span items)
   */
  const toggleCheck = (it: Item, range = false) => {
    const ids = new Set(checkedIds);
    const id = itemId(it);
    const on = !ids.has(id);
    const from = range && lastChecked.current ? listForNav.findIndex((x) => itemId(x) === lastChecked.current) : -1;
    const to = listForNav.findIndex((x) => itemId(x) === id);
    const span = from >= 0 && to >= 0 ? listForNav.slice(Math.min(from, to), Math.max(from, to) + 1) : [it];
    for (const x of span) {
      if (on) ids.add(itemId(x));
      else ids.delete(itemId(x));
    }
    lastChecked.current = id;
    setChecked(ids);
  };
  const allChecked = listForNav.length > 0 && checkedList.length === listForNav.length;
  const toggleAll = () => setChecked(allChecked ? [] : listForNav.map(itemId));
  /** Check / uncheck a whole group (one item) */
  const toggleGroup = (items: Item[]) => {
    const ids = new Set(checkedIds);
    const all = items.every((it) => ids.has(itemId(it)));
    for (const it of items) {
      if (all) ids.delete(itemId(it));
      else ids.add(itemId(it));
    }
    setChecked(ids);
  };

  return { checkedList, checkedIds, setChecked, toggleCheck, allChecked, toggleAll, toggleGroup };
}

export function useHandoff(opts: {
  filesRef: RefObject<Map<string, Stored>>;
  unreadableRef: RefObject<Map<string, string>>;
  missing: ReadonlySet<string>;
  commit: (home: string, after: MaterialFile, how?: { base?: MaterialFile; record?: boolean; quiet?: boolean }) => Promise<unknown>;
  /**
   * Notes of this item written on earlier versions (materialVersions.ts): a section of their own with separate numbering, and the
   * explanation says the snapshot is authoritative
   */
  earlierOf: (key: string) => ReadonlySet<string>;
  current: MaterialEntry | undefined;
  grouped: boolean;
  openList: Item[];
  checkedList: Item[];
  prefs: Pick<Prefs, "promptExtra" | "markColor">;
  onNotify: Notify;
  report: Pick<Report, "notifyError" | "copyReason">;
}) {
  const { filesRef, unreadableRef, missing, commit, earlierOf, current, grouped, openList, checkedList, prefs, onNotify } = opts;
  const { notifyError, copyReason } = opts.report;
  const intl = useIntl();
  /** The text handed over follows the UI language (core's renderHandoff and describeWhere fetch messages through it) */
  const translate: Translate = (id, values) => intl.formatMessage({ id }, values);
  /** What the bottom button and Ctrl+Shift+A hand over: the checked notes if any are checked, otherwise all open notes the notes panel lists */
  const toCopy = checkedList.length > 0 ? checkedList : openList;
  /** The button shows "Copied": this records which copy it was, and another copy within 1.6 seconds restarts the timer */
  const [copiedAt, setCopiedAt] = useState(0);
  const copied = copiedAt > 0;
  useEffect(() => {
    if (!copiedAt) return;
    const t = setTimeout(() => setCopiedAt(0), 1600);
    return () => clearTimeout(t);
  }, [copiedAt]);
  /** "this image" / "this video": called the same in the notes panel, in toasts and in the text copied for AI */
  const thisKind = (kind: string) => intl.formatMessage({ id: "app.kind.this" }, { kind });
  /**
   * Hand these notes to AI: put them on the clipboard and show a toast saying how many. done is the "Copied …" half sentence (a message)
   * and receives the count handed over (also written as "1 note" when one is checked). Returns true if the copy succeeded
   */
  const handOff = async (list: HandoffMaterial[], done: (count: number) => string, mode: HandoffMode = "text") => {
    const n = list.reduce((s, g) => s + g.items.length, 0);
    try {
      let text: string;
      if (mode === "images") {
        const { count } = await call("copyImages", { items: imageItems(list), extra: prefs.promptExtra });
        text = intl.formatMessage({ id: "app.copy.images.hint" }, { done: done(n), images: count });
      } else {
        await navigator.clipboard.writeText(renderHandoff(list, translate, { extra: prefs.promptExtra }));
        text = intl.formatMessage({ id: "app.copy.done.hint" }, { done: done(n) });
      }
      // Say so if they were copied before (copying the same batch twice used to give no hint)
      const again = list.flatMap((g) => g.items.map((x) => x.annotation.handed_off_at).filter((t): t is string => !!t));
      if (again.length > 0) {
        const when = shortWhen(
          intl,
          again.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b)),
          true,
        );
        const note =
          again.length === n
            ? intl.formatMessage({ id: "app.copy.again.all" }, { count: n, when })
            : intl.formatMessage({ id: "app.copy.again.some" }, { count: again.length });
        text = intl.formatMessage({ id: "app.copy.withNote" }, { text, note });
      }
      onNotify(text);
      markHandedOff(list);
      return true;
    } catch (e) {
      logError(mode === "images" ? "copy as images" : "copy for AI", e, "warn");
      notifyError(intl.formatMessage({ id: "app.copy.failed" }, { reason: copyReason(e, list[0]?.root ?? "") }), e, undefined, {
        label: intl.formatMessage({ id: "app.copy.retry" }),
        run: () => void handOff(list, done, mode),
      });
      return false;
    }
  };
  /**
   * Copied out: the time is recorded for each note and the card shows "Copied · 10:32".
   * It doesn't count as a modification of the note: it doesn't go on the undo stack and doesn't touch updated_at; if it can't be written
   * (a read-only drive) it only logs, since the copy itself already succeeded
   */
  const markHandedOff = (list: HandoffMaterial[]) => {
    const at = new Date().toISOString();
    for (const g of list) {
      const key = fileKey(g.root, g.material);
      const stored = filesRef.current.get(key);
      if (!stored || blockedReason(unreadableRef.current, stored.home, stored.file.material, stored.file)) continue;
      const ids = new Set(g.items.map((x) => x.annotation.id));
      const next: MaterialFile = {
        ...stored.file,
        annotations: stored.file.annotations.map((a) => (ids.has(a.id) ? { ...a, handed_off_at: at } : a)),
      };
      void commit(stored.home, next, { base: stored.file, record: false, quiet: true });
    }
  };
  /**
   * Each entry of Copy as Images (drawn by the shell's HandoffImages): "project / file" on top, the note's own snapshot, and a caption area
   * with the category, the position and the text. People using web-based AI or chat apps cannot see local paths, so the image has to say
   * which file it is
   */
  const imageItems = (list: HandoffMaterial[]): HandoffImageItem[] =>
    list.flatMap((g) => {
      const m = g.material;
      const project = baseName(g.root) || g.root;
      const title =
        m.kind !== "folder"
          ? intl.formatMessage({ id: "app.images.title.file" }, { project, path: m.path })
          : m.path === "."
            ? intl.formatMessage({ id: "app.images.title.root" }, { project })
            : intl.formatMessage({ id: "app.images.title.folder" }, { project, path: m.path });
      const file = m.kind === "folder" ? baseName(m.path === "." ? g.root : m.path) : baseName(m.path);
      // Only notes on the canvas get a numbered circle (matching the marks in the snapshot and the orange numbers in the notes panel);
      // timestamped comments, overall comments and notes on earlier versions get no circle, and the file name says which section and
      // which number it is (ADR-0008)
      return g.items.map(({ annotation: a, index, section }) => ({
        home: g.root,
        snapshot: a.snapshot ? `${DATA_DIR}/${a.snapshot}` : null,
        title,
        number: section === "marked" ? index : 0,
        category: a.category,
        where: describeWhere(a, m, translate) + (section === "earlier" ? translate("ai.earlier") : ""),
        body: a.body,
        color: placeColorOf(a, 0, prefs.markColor),
        name: intl.formatMessage(
          {
            id:
              section === "timed"
                ? "app.images.nameTimed"
                : section === "overall" && m.kind !== "folder"
                  ? "app.images.nameOverall"
                  : section === "earlier"
                    ? "app.images.nameEarlier"
                    : "app.images.name",
          },
          { file, number: index },
        ),
      }));
    });
  /** The open notes of one notes file, with numbering and sections matching the notes panel */
  const openOf = (key: string, s: Stored): HandoffMaterial["items"] =>
    numbered(key, s.file.annotations, earlierOf(key))
      .filter((it) => it.a.status === "open")
      .map((it) => ({ annotation: it.a, index: it.index, section: it.section }));
  /** The open notes of these items (numbering matches the notes panel) */
  const openItems = (materials: MaterialEntry[]): HandoffMaterial[] =>
    materials.flatMap((m) => {
      const key = keyOf(m.path);
      const stored = filesRef.current.get(key);
      if (!stored) return [];
      const items = openOf(key, stored);
      return items.length
        ? [{ material: stored.file.material, root: stored.home, items, ...(missing.has(key) ? { missing: true } : {}) }]
        : [];
    });
  /** The open folder comments of this folder (including subfolders) */
  const folderItems = (folder: FolderTarget): HandoffMaterial[] =>
    [...filesRef.current].flatMap(([key, s]) => {
      const m = s.file.material;
      if (m.kind !== "folder" || keyOf(s.home) !== keyOf(folder.home) || !relInside(m.path, folder.rel)) return [];
      const items = openOf(key, s);
      return items.length ? [{ material: m, root: s.home, items }] : [];
    });
  /** Some notes from the notes panel, split into segments by item (same order as the notes panel) */
  const handoffOf = (items: Item[]): HandoffMaterial[] => {
    const byKey = new Map<string, Item[]>();
    for (const it of items) byKey.set(it.key, [...(byKey.get(it.key) ?? []), it]);
    return [...byKey].flatMap(([key, its]) => {
      const stored = filesRef.current.get(key);
      return stored
        ? [
            {
              material: stored.file.material,
              root: stored.home,
              items: its.map((it) => ({ annotation: it.a, index: it.index, section: it.section })),
              ...(missing.has(key) ? { missing: true } : {}),
            },
          ]
        : [];
    });
  };
  const copyOne = (it: Item, mode: HandoffMode = "text") =>
    void handOff(handoffOf([it]), () => intl.formatMessage({ id: "app.copy.done.one" }), mode);
  /** How many items the notes to copy are spread over */
  const copyMaterialCount = new Set(toCopy.map((it) => it.key)).size;
  /**
   * How many items the open notes listed in the notes panel are spread over (what right-click copy hands over when several rows are
   * selected in the library)
   */
  const listedMaterialCount = new Set(openList.map((it) => it.key)).size;
  /**
   * There is a single rule for the copy scope: the checked notes if any are checked, otherwise all open notes the notes panel lists.
   * The bottom button of the notes panel, Ctrl+Shift+A, the Edit menu and right-click on blank canvas space all go through here.
   * listed: ignores the checks and hands over all open notes the notes panel lists, for right-click copy with several library rows selected
   * (the notes panel then lists exactly the selected ones)
   */
  const copyCurrent = async (mode: HandoffMode = "text", listed = false) => {
    if (!current && !grouped) return onNotify(intl.formatMessage({ id: "app.copy.pickFirst" }));
    const byCheck = !listed && checkedList.length > 0;
    const items = byCheck ? checkedList : openList;
    if (items.length === 0)
      return onNotify(
        grouped
          ? intl.formatMessage({ id: "app.copy.noneListed" })
          : intl.formatMessage({ id: "app.copy.noneThis" }, { this: thisKind(current!.kind) }),
      );
    const materials = new Set(items.map((it) => it.key)).size;
    // "Copied 3 checked notes" / "Copied 4 notes on this video" / "Copied 9 notes on 3 items"
    const done = (count: number) =>
      byCheck
        ? intl.formatMessage({ id: "app.copy.done.checked" }, { count })
        : !grouped
          ? intl.formatMessage({ id: "app.copy.done.this" }, { this: thisKind(current!.kind), count })
          : materials > 1
            ? intl.formatMessage({ id: "app.copy.done.materials" }, { materials, count })
            : intl.formatMessage({ id: "app.copy.done.count" }, { count });
    if ((await handOff(handoffOf(items), done, mode)) && mode === "text" && !listed) setCopiedAt((n) => n + 1);
  };
  // The bottom button shows no count and always says "Copy for AI"; how many are checked is shown on the left as "N selected"
  // (a button saying "1 note" with nothing checked looks like one is checked; the number either follows the checks or is not on the button at all,
  // so it is shown on the left as "N selected"). How many were handed over is written in the toast after copying
  const copyTitle =
    toCopy.length === 0
      ? intl.formatMessage({ id: "app.copy.title.none" })
      : checkedList.length > 0
        ? intl.formatMessage({ id: "app.copy.title.checked" }, { count: toCopy.length })
        : grouped
          ? intl.formatMessage({ id: "app.copy.title.allMaterials" }, { materials: copyMaterialCount, count: toCopy.length })
          : intl.formatMessage({ id: "app.copy.title.allThis" }, { this: thisKind(current?.kind ?? ""), count: toCopy.length });
  /** The open notes in this notes folder whose item can't be found (the last group of "Entire Project" in the notes panel) */
  const missingItems = (home: string): HandoffMaterial[] =>
    [...missing].flatMap((key) => {
      const s = filesRef.current.get(key);
      if (!s || keyOf(s.home) !== keyOf(home)) return [];
      const items = openOf(key, s);
      return items.length ? [{ material: s.file.material, root: s.home, items, missing: true }] : [];
    });
  /**
   * Right-click copy on a library row: label is the name of the project / folder / item. folder: the row clicked is a project / folder row,
   * so its folder comments are handed over too; the project row also adds the group of items that can't be found, the same as what
   * "Entire Project" in the notes panel hands over (the library used to lack that group, so the counts on the two sides differed)
   */
  const copyMaterials = (materials: MaterialEntry[], label: string, folder?: FolderTarget, mode: HandoffMode = "text") => {
    const list = [
      ...(folder ? folderItems(folder) : []),
      ...openItems(materials),
      ...(folder?.rel === "." ? missingItems(folder.home) : []),
    ];
    if (list.length === 0) return onNotify(intl.formatMessage({ id: "app.copy.noneIn" }, { name: label }));
    // "N items" counts items only: the folder-comment group doesn't count (like "2 items, 3 notes" in the context menu; it used to count
    // groups, so folder comments counted as an item)
    const withNotes = list.filter((g) => g.material.kind !== "folder").length;
    void handOff(
      list,
      (count) =>
        withNotes <= 1
          ? intl.formatMessage({ id: "app.copy.done.named" }, { name: label, count })
          : intl.formatMessage({ id: "app.copy.done.namedMany" }, { name: label, materials: withNotes, count }),
      mode,
    );
  };

  return { toCopy, copied, thisKind, copyOne, copyCurrent, copyMaterials, copyTitle, listedMaterialCount, openItems };
}
