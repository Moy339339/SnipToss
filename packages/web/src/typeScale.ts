// Text sizes (Settings → Appearance): every type level of a part of the window moves by the same number of pixels, its line height with it,
// so the hierarchy between the levels stays as it is (docs/design-rules.md S2). The defaults are the sizes in styles.css (:root).
// Three parts: the interface (set on <html>), the note text (--fs-content), the Settings dialog (set on .settings). Numbers drawn over the
// item keep their size (--fs-mark, --fs-tick), and so do menus and tooltips opened from Settings (they follow the interface)

/** The type tokens that follow a text size: [size token, its line height token, default size, default line height, smallest size] */
const LEVELS: readonly (readonly [string, string | null, number, number, number])[] = [
  ["--fs-micro", null, 11, 0, 11],
  ["--fs-caption", "--lh-caption", 12, 16, 12],
  ["--fs-body", "--lh-body", 14, 20, 12],
  ["--fs-label", "--lh-label", 14, 22, 12],
  ["--fs-title", "--lh-title", 16, 24, 12],
  ["--fs-heading", "--lh-heading", 20, 28, 12],
];
/** The 12px running-text line height moves with the caption */
const NOTE_LINE = 18;

/**
 * The next even pixel: controls are all even in height (20, 24, 28, 32, 44), so an even line centers its text on whole pixels;
 * with an odd one every label sits half a pixel off and Chromium draws it either blurred or one pixel high
 */
const even = (px: number) => px + (px % 2);

/** The text sizes in Settings → Appearance: the size the part's main text has in styles.css (css), the default, and the range a typed value is
 * pulled back into. The interface and Settings stop where text would no longer fit their fixed-height controls (buttons, rows, keycaps); the note
 * text sits in boxes that grow with it. Larger than that is what Interface size is for (it scales the controls too) */
export const TEXT_SIZES = {
  uiFontSize: { css: 14, base: 14, min: 12, max: 16 },
  noteFontSize: { css: 14, base: 14, min: 12, max: 18 },
  settingsFontSize: { css: 14, base: 14, min: 13, max: 16 },
} as const;

export type TextSize = keyof typeof TEXT_SIZES;

/** A typed or stored size pulled back into its range, in whole pixels; anything that is not a number gives the default */
export function clampTextSize(which: TextSize, v: unknown): number {
  const { base, min, max } = TEXT_SIZES[which];
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : base;
}

/**
 * The type tokens for a part whose main text is `size` instead of what styles.css writes. Empty when they are the same, unless `always`
 * (Settings sets all of them on itself, so that a changed interface size does not reach into it).
 * Captions and smaller never go below what they are (G1: Chinese below 12 clumps), so a smaller interface tightens the body, not the captions
 */
export function typeVars(which: "uiFontSize" | "settingsFontSize", size: number, always = false): Record<string, string> {
  const delta = clampTextSize(which, size) - TEXT_SIZES[which].css;
  if (!delta && !always) return {};
  const vars: Record<string, string> = {};
  for (const [fs, lh, px, line, floor] of LEVELS) {
    const sized = Math.max(floor, px + delta);
    vars[fs] = `${sized}px`;
    if (lh) vars[lh] = `${even(line + (sized - px))}px`;
  }
  vars["--lh-note"] = `${even(NOTE_LINE + (parseInt(vars["--fs-caption"]) - 12))}px`;
  return vars;
}

/** The note text tokens (--fs-content, --lh-content); empty when the size is what styles.css writes. A reading line: 8 above the size, even */
export function contentVars(size: number): Record<string, string> {
  const px = clampTextSize("noteFontSize", size);
  return px === TEXT_SIZES.noteFontSize.css ? {} : { "--fs-content": `${px}px`, "--lh-content": `${even(px + 8)}px` };
}

/**
 * Reduce motion is on (Settings → Appearance; App.tsx puts .reduce-motion on <html>, following Windows by default): for animations run by
 * script, which the styles cannot stop
 */
export const reduceMotion = () => document.documentElement.classList.contains("reduce-motion");

/** Every token any of the parts may set: what to clear on <html> before setting the current ones */
export const TYPE_TOKENS: readonly string[] = [
  ...LEVELS.flatMap(([fs, lh]) => (lh ? [fs, lh] : [fs])),
  "--lh-note",
  "--fs-content",
  "--lh-content",
];
