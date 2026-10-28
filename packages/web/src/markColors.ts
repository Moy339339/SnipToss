import type { CSSProperties } from "react";
import type { IntlShape } from "react-intl";
import { isMarkColor, MARK_COLOR_NAMES, shapesOf, type Annotation, type Shape } from "@sniptoss/core";
import type { MenuItem } from "./Menu";
import { MARK_COLORS } from "./prefs";

// Per-note mark color: a note's color is stored only when it was changed individually; none = use the mark color from Settings.
// Switching back to the Settings color removes color, and the note follows Settings again. Number keys 1–6 follow the order of MARK_COLORS (Workspace).
// Each mark of a multi-mark note can also be changed on its own (shapes[i].color; so the note text can say which mark to change how, by color):
// when the marks have different colors, every mark stores its color, and when they are all the same none does (normalizePlaceColors), so core can name each mark's color without knowing Settings

/** The color the note's marks are drawn in (the whole note's; for a multi-mark note whose marks differ it is the first mark's, see placeColorOf) */
export const markColorOf = (a: Pick<Annotation, "color">, fallback: string) => (isMarkColor(a.color) ? a.color : fallback);

/** Set --mark on the element only for notes recolored individually; the others follow the outer value (the Settings color) */
export const markStyle = (a: Pick<Annotation, "color">): CSSProperties | undefined =>
  isMarkColor(a.color) ? ({ "--mark": a.color } as CSSProperties) : undefined;

/** The color of the mark with index part: its own, else the note's, else the one from Settings */
export const placeColorOf = (a: Pick<Annotation, "anchor" | "color">, part: number, fallback: string) => {
  const own = shapesOf(a)[part]?.color;
  return isMarkColor(own) ? own : markColorOf(a, fallback);
};

/** --mark for the mark with index part (used by badges, handles and the notes panel's numbers): set only if this mark or its note was recolored individually */
export const placeStyle = (a: Pick<Annotation, "anchor" | "color">, part: number): CSSProperties | undefined => {
  const own = shapesOf(a)[part]?.color;
  return isMarkColor(own) ? ({ "--mark": own } as CSSProperties) : markStyle(a);
};

/** The color of the whole note right now: defined only when all its marks share one color (that swatch is lit in the menu), undefined otherwise */
export function noteColorOf(a: Pick<Annotation, "anchor" | "color">, fallback: string): string | undefined {
  const n = Math.max(1, shapesOf(a).length);
  const all = new Set(Array.from({ length: n }, (_, i) => placeColorOf(a, i, fallback).toLowerCase()));
  return all.size === 1 ? [...all][0] : undefined;
}

export const sameColor = (a: string | undefined, b: string | undefined) => (a ?? "").toLowerCase() === (b ?? "").toLowerCase();

/** Remove each mark's individual color (when recoloring the whole note: all marks become that color together) */
export const withoutPlaceColors = (shapes: readonly Shape[]): Shape[] =>
  shapes.map((s) => {
    if (s.color === undefined) return s;
    const { color: _c, ...rest } = s;
    return rest as Shape;
  });

/**
 * Normalize each mark's color and the note's color into the stored form (docs/annotation-format.md, the per-mark color): noteColor is the note's color (none = follow Settings), fallback is the one from Settings.
 * All marks drawn in the same color → drop every mark's own color and store that color on the note (not stored if it is exactly the Settings color); different → store every mark's color and the first mark's on the note (older versions draw the whole note with it).
 * Returned unchanged when no mark stores a color of its own
 */
export function normalizePlaceColors(
  shapes: readonly Shape[],
  noteColor: string | undefined,
  fallback: string,
): { shapes: Shape[]; color: string | undefined } {
  if (!shapes.some((s) => isMarkColor(s.color))) return { shapes: [...shapes], color: noteColor };
  const drawn = shapes.map((s) => (isMarkColor(s.color) ? s.color : isMarkColor(noteColor) ? noteColor : fallback));
  const first = sameColor(drawn[0], fallback) ? undefined : drawn[0];
  if (drawn.every((c) => sameColor(c, drawn[0]))) return { shapes: withoutPlaceColors(shapes), color: first };
  return { shapes: shapes.map((s, i) => ({ ...s, color: drawn[i] })), color: first };
}

/** Change the mark with index part to color (undefined = the Settings color) and normalize the result (see normalizePlaceColors) */
export function recolorPlace(
  shapes: readonly Shape[],
  noteColor: string | undefined,
  part: number,
  color: string | undefined,
  fallback: string,
) {
  const drawn = shapes.map((s) => (isMarkColor(s.color) ? s.color : isMarkColor(noteColor) ? noteColor : fallback));
  drawn[part] = color ?? fallback;
  return normalizePlaceColors(
    shapes.map((s, i) => ({ ...s, color: drawn[i] })),
    noteColor,
    fallback,
  );
}

/** A color's name: presets use their name, others (written by hand in the settings or note files) use the color value */
export function colorName(intl: IntlShape, color: string): string {
  const i = MARK_COLORS.findIndex((c) => sameColor(c, color));
  return i < 0 ? color : intl.formatMessage({ id: "markColor.name" }, { color: MARK_COLOR_NAMES[i] });
}

/** A swatch's label: the name, with the one from Settings marked "default" */
export function swatchLabel(intl: IntlShape, color: string, defaultColor: string): string {
  const name = colorName(intl, color);
  return sameColor(color, defaultColor) ? intl.formatMessage({ id: "markColor.default" }, { name }) : name;
}

/**
 * The row of swatches in menus (right-click on a mark on the canvas, right-click on a note card and "⋯", the Annotate menu).
 * current: the color the notes to change are drawn in now (not given when they differ, so no swatch is lit). A click calls pick: when the Settings color is chosen it passes undefined (removing the individual color).
 * keys = false: the hover tooltip omits the number keys (when several are checked and one note is right-clicked, the number keys change the checked ones, not this one, just as the status items do not show D)
 */
export function markColorRow(
  intl: IntlShape,
  opts: {
    label: string;
    current?: string;
    defaultColor: string;
    disabled?: boolean;
    keys?: boolean;
    pick: (color: string | undefined) => void;
  },
): MenuItem {
  return {
    label: opts.label,
    title: intl.formatMessage({ id: "markColor.title" }),
    disabled: opts.disabled,
    // The row itself is not a button; the swatches are what get clicked
    onClick: () => {},
    swatches: MARK_COLORS.map((color, i) => ({
      color,
      label: swatchLabel(intl, color, opts.defaultColor),
      key: opts.keys === false ? undefined : String(i + 1),
      checked: !!opts.current && sameColor(color, opts.current),
      onClick: () => opts.pick(sameColor(color, opts.defaultColor) ? undefined : color),
    })),
  };
}
