import type { IntlShape } from "react-intl";
import { roundShape, type Annotation, type AnnotationStatus } from "@sniptoss/core";
import type { HandoffMode } from "./handoff";
import type { MaterialEntry } from "./host";
import {
  BanIcon,
  ClockIcon,
  CloseIcon,
  DoneIcon,
  EditIcon,
  EyeIcon,
  EyeOffIcon,
  FolderIcon,
  KindIcon,
  NoteIcon,
  PointIcon,
  ReopenIcon,
  SparkIcon,
  TrashIcon,
} from "./icons";
import { markColorRow } from "./markColors";
import { workSize } from "./mediaSize";
import type { MenuItem } from "./Menu";
import type { Item } from "./panelScope";
import type { Media } from "./Viewer";

// The context menu on the canvas (split out of Workspace): on a mark it is for that note, elsewhere for this item.
// The gray text on the right holds only counts and shortcuts, with explanations in hover tooltips (same as the library's context menu and the menu bar); icons follow the library's context menu

/** Where the right-click landed on the canvas (0–1, snapped to whole pixels, like the Pin tool) and the video moment: the video keeps playing while the menu is open */
export type StagePoint = { x: number; y: number; time?: number; clientX: number; clientY: number };

/** Where "Add Note Here…" lands: none when the click is outside the picture or on the zoom bar (items that cannot be drawn on are ruled out by the caller first) */
export function stagePointAt(e: React.MouseEvent, stage: HTMLElement | null, media: Media | null, time?: number): StagePoint | undefined {
  const target = e.target as HTMLElement;
  const layer = stage?.querySelector(".annot-layer");
  if (!layer || !media || !target.closest(".zoom-view") || target.closest(".zoom-control")) return undefined;
  // Snap to whole pixels of the drawn size, same as the note layer (size in AnnotationLayer)
  const { w, h } = workSize(media);
  const r = layer.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width;
  const y = (e.clientY - r.top) / r.height;
  if (!w || !h || x < 0 || x > 1 || y < 0 || y > 1) return undefined;
  const p = roundShape({ type: "point", x: Math.round(x * w) / w, y: Math.round(y * h) / h }, w, h);
  return p.type === "point" ? { x: p.x, y: p.y, time, clientX: e.clientX, clientY: e.clientY } : undefined;
}

/** The menu for one note (right-click on a mark on the canvas, right-click in the notes panel and "⋯") */
export function annotationMenu(
  intl: IntlShape,
  it: Item,
  ctx: {
    checked: boolean;
    /** Whether any are checked: D and Delete act on the checked ones, so no shortcut is shown then, to avoid implying that D changes this one note */
    anyChecked: boolean;
    /** The full disk path of this note's snapshot (none if there is no snapshot) */
    shotPath?: string;
    copyOne: (it: Item, mode?: HandoffMode) => void;
    toggleCheck: (it: Item) => void;
    edit: (it: Item) => void;
    revealInExplorer: (path: string) => void;
    setStatus: (a: Annotation, status: AnnotationStatus, key: string) => void;
    remove: (a: Annotation, key: string) => void;
    /** For a note with marks on the canvas (the canvas-marks section): hide / show it on the canvas (hide the upper one when marks overlap) */
    mark?: { hidden: boolean; toggle: () => void };
    /**
     * For a note with marks on the canvas: change its color (current is the color it is drawn in now, absent when its marks differ; default is the one in Settings; pick with undefined = follow Settings).
     * place: the right-click on the canvas hit one of several marks, and only that mark changes; no number key is shown then (number keys change the mark hit by a left click)
     */
    color?: { current?: string; default: string; place?: boolean; pick: (color: string | undefined) => void };
    /** The right-click on the canvas hit one of several marks: remove only that mark (ADR-0009; not given when only one is left, which would delete the whole note) */
    removePlace?: () => void;
  },
): (MenuItem | "-")[] {
  const { a, key } = it;
  const { anyChecked, shotPath, mark, color } = ctx;
  return [
    {
      label: intl.formatMessage({ id: "app.copy.toAi" }),
      icon: <SparkIcon />,
      hint: intl.formatMessage({ id: "library.menu.copyCount" }, { materials: 1, count: 1 }),
      title: intl.formatMessage({ id: "app.copy.asText.hint" }),
      onClick: () => ctx.copyOne(it),
    },
    {
      label: intl.formatMessage({ id: "app.copy.asImages" }),
      icon: <KindIcon kind="image" />,
      title: intl.formatMessage({ id: "app.copy.asImages.hint" }),
      onClick: () => ctx.copyOne(it, "images"),
    },
    {
      label: intl.formatMessage({ id: ctx.checked ? "card.menu.uncheck" : "card.menu.check" }),
      hint: "X",
      onClick: () => ctx.toggleCheck(it),
    },
    "-",
    { label: intl.formatMessage({ id: "card.menu.edit" }), icon: <EditIcon />, hint: "Enter", onClick: () => ctx.edit(it) },
    ...(mark
      ? [
          {
            label: intl.formatMessage({ id: mark.hidden ? "card.menu.showMark" : "card.menu.hideMark" }),
            icon: mark.hidden ? <EyeIcon /> : <EyeOffIcon />,
            title: intl.formatMessage({ id: "card.mark.title" }),
            onClick: mark.toggle,
          },
        ]
      : []),
    ...(color
      ? [
          markColorRow(intl, {
            label: intl.formatMessage({ id: color.place ? "stage.menu.placeColor" : "card.menu.color" }),
            current: color.current,
            defaultColor: color.default,
            keys: !anyChecked && !color.place,
            pick: color.pick,
          }),
        ]
      : []),
    // Where this note's snapshot is: select the image directly in File Explorer (so people can see where notes are stored and open it)
    ...(shotPath
      ? [{ label: intl.formatMessage({ id: "app.card.revealShot" }), icon: <FolderIcon />, onClick: () => ctx.revealInExplorer(shotPath) }]
      : []),
    ...(a.status === "open"
      ? [
          {
            label: intl.formatMessage({ id: "menu.note.status" }, { status: "resolved" }),
            icon: <DoneIcon />,
            hint: anyChecked ? undefined : "D",
            onClick: () => ctx.setStatus(a, "resolved", key),
          },
          {
            label: intl.formatMessage({ id: "menu.note.status" }, { status: "wontfix" }),
            icon: <BanIcon />,
            hint: anyChecked ? undefined : "Shift D",
            onClick: () => ctx.setStatus(a, "wontfix", key),
          },
        ]
      : [
          {
            label: intl.formatMessage({ id: "menu.note.status" }, { status: "open" }),
            icon: <ReopenIcon />,
            onClick: () => ctx.setStatus(a, "open", key),
          },
        ]),
    "-",
    ...(ctx.removePlace
      ? [
          {
            label: intl.formatMessage({ id: "stage.menu.removePlace" }),
            icon: <CloseIcon />,
            title: intl.formatMessage({ id: "stage.menu.removePlaceTitle" }),
            onClick: ctx.removePlace,
          },
        ]
      : []),
    {
      label: intl.formatMessage({ id: "card.menu.delete" }),
      icon: <TrashIcon />,
      hint: anyChecked ? undefined : "Delete",
      danger: true,
      onClick: () => ctx.remove(a, key),
    },
  ];
}

/**
 * Right-click on one mark of the note being written on the canvas (not yet saved): it only concerns this note's unsaved marks. Change this mark's color (with several marks only this one changes, so the note text can refer to marks by color),
 * remove this mark (not offered when only one is left: what is wanted then is to discard the whole note), or discard the whole note (same as Esc)
 */
export function draftMarkMenu(
  intl: IntlShape,
  ctx: {
    places: number;
    editing: boolean;
    /** current is the color this mark is drawn in now, default is the one in Settings */
    color: { current: string; default: string; pick: (color: string | undefined) => void };
    remove: () => void;
    cancel: () => void;
  },
): (MenuItem | "-")[] {
  return [
    markColorRow(intl, {
      label: intl.formatMessage({ id: ctx.places > 1 ? "stage.menu.placeColor" : "card.menu.color" }),
      current: ctx.color.current,
      defaultColor: ctx.color.default,
      // While the composer is open the number keys type text
      keys: false,
      pick: ctx.color.pick,
    }),
    "-",
    ...(ctx.places > 1
      ? [
          {
            label: intl.formatMessage({ id: "stage.menu.removePlace" }),
            icon: <CloseIcon />,
            title: intl.formatMessage({ id: "stage.menu.removePlaceTitle" }),
            onClick: ctx.remove,
          },
        ]
      : []),
    { label: intl.formatMessage({ id: "stage.menu.cancelDraft" }, { edit: ctx.editing ? "yes" : "no" }), hint: "Esc", onClick: ctx.cancel },
  ];
}

/**
 * Right-click on blank canvas: it targets the one item on the canvas, so the menu holds only what concerns it (otherwise right-clicking an image would show a 'comment for folder "Downloads"' entry, which has nothing to do with the image and is puzzling).
 * Copy likewise hands over only this item, like this row in the library's right-click menu; the notes panel's bottom buttons and Ctrl+Shift+A still hand over what the notes panel lists.
 * The containing folder's comment (Shift N, menu Annotate, the folder row in the library) and the notes folder (menu File, the project row in the library, the bottom of the notes panel) are not here
 */
export function materialMenu(
  intl: IntlShape,
  material: MaterialEntry,
  ctx: {
    /** How many open notes this item has (these are what Copy hands over) */
    count: number;
    /** Where in the canvas the right-click landed: "Add Note Here…" is offered only when present */
    at?: StagePoint;
    canAnnotate: boolean;
    copy: (mode: HandoffMode) => void;
    pointAt: (at: StagePoint) => void;
    startWhole: () => void;
    /** Timestamped comment: given only for video (whose canvas can open); the menu item exists only when given */
    startTimed?: () => void;
    revealInExplorer: (path: string) => void;
  },
): (MenuItem | "-")[] {
  const { count: n, at } = ctx;
  return [
    {
      label: intl.formatMessage({ id: "app.copy.toAi" }),
      icon: <SparkIcon />,
      hint:
        n === 0
          ? intl.formatMessage({ id: "app.copy.hint.none" })
          : intl.formatMessage({ id: "library.menu.copyCount" }, { materials: 1, count: n }),
      title: intl.formatMessage({ id: "app.copy.asText.hint" }),
      onClick: () => ctx.copy("text"),
      disabled: n === 0,
    },
    {
      label: intl.formatMessage({ id: "app.copy.asImages" }),
      icon: <KindIcon kind="image" />,
      title: intl.formatMessage({ id: "app.copy.asImages.hint" }),
      onClick: () => ctx.copy("images"),
      disabled: n === 0,
    },
    "-",
    // Only when the right-click landed in the canvas: drop a pin right there (like the Pin tool, C) and write directly
    ...(at ? [{ label: intl.formatMessage({ id: "menu.note.here" }), icon: <PointIcon />, onClick: () => ctx.pointAt(at) }] : []),
    ...(ctx.startTimed
      ? [
          {
            label: intl.formatMessage({ id: "menu.note.timed" }),
            icon: <ClockIcon />,
            hint: "T",
            title: intl.formatMessage({ id: "menu.note.timedTitle" }),
            onClick: ctx.startTimed,
            disabled: !ctx.canAnnotate,
          },
        ]
      : []),
    {
      label: intl.formatMessage({ id: "menu.note.whole" }),
      icon: <NoteIcon />,
      hint: "N",
      title: intl.formatMessage({ id: "menu.note.wholeTitle" }),
      onClick: ctx.startWhole,
      disabled: !ctx.canAnnotate,
    },
    "-",
    {
      label: intl.formatMessage({ id: "settings.reveal" }),
      icon: <FolderIcon />,
      onClick: () => ctx.revealInExplorer(material.path),
    },
  ];
}

/**
 * Right-click on blank space in the notes panel: it applies to the batch the notes panel lists right now,
 * and copy and check work like the bottom buttons and the menu bar (some checked = the checked ones, none checked = all open ones listed); "Delete All Notes…" deletes everything listed (asks first, can be undone),
 * and anything not listed (resolved ones not shown, filtered out, collapsed, no search match) is left alone
 */
export function panelMenu(
  intl: IntlShape,
  ctx: {
    /** How many are listed (the visible ones, including resolved ones) */
    listed: number;
    checked: number;
    canCopy: boolean;
    copy: (mode: HandoffMode) => void;
    checkAll: () => void;
    uncheckAll: () => void;
    deleteAll: () => void;
  },
): (MenuItem | "-")[] {
  const t = (id: string, values?: Record<string, string | number>) => intl.formatMessage({ id }, values);
  const { listed, checked } = ctx;
  return [
    {
      label: checked > 0 ? t("menu.edit.copyChecked", { count: checked }) : t("app.copy.toAi"),
      icon: <SparkIcon />,
      hint: "Ctrl Shift A",
      title: ctx.canCopy ? t("app.copy.asText.hint") : t("app.copy.title.none"),
      onClick: () => ctx.copy("text"),
      disabled: !ctx.canCopy,
    },
    {
      label: checked > 0 ? t("menu.edit.copyCheckedImages", { count: checked }) : t("app.copy.asImages"),
      icon: <KindIcon kind="image" />,
      hint: "Ctrl Shift I",
      title: ctx.canCopy ? t("app.copy.asImages.hint") : t("app.copy.title.none"),
      onClick: () => ctx.copy("images"),
      disabled: !ctx.canCopy,
    },
    "-",
    { label: t("menu.note.checkAll"), onClick: ctx.checkAll, disabled: listed === 0 || checked >= listed },
    {
      label: t("menu.note.uncheckAll"),
      hint: checked > 0 ? t("panel.batch.count", { count: checked }) : undefined,
      onClick: ctx.uncheckAll,
      disabled: checked === 0,
    },
    "-",
    {
      label: t("menu.edit.deleteAll"),
      icon: <TrashIcon />,
      hint: listed > 0 ? t("library.menu.copyCount", { materials: 1, count: listed }) : undefined,
      title: t("menu.edit.deleteAllTitle"),
      onClick: ctx.deleteAll,
      disabled: listed === 0,
      danger: true,
    },
  ];
}
