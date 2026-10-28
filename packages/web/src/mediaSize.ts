// The two sizes of an item on the canvas:
//  - original size (natural): recorded in the note file (material.width / height), used for the pixel coordinates given to AI, and shown in the toolbar
//  - drawn size (work): the canvas area lays out by it, marks snap to whole pixels of it, and screenshots are drawn at it
// For ordinary images and videos the two are the same (the element's own naturalWidth / videoWidth). They differ for:
//  - SVG: the original size is its declared width / height (the viewBox when undeclared), and the drawn size is enlarged so the long side is at least VECTOR_SIDE (a vector enlarges without blur, marks snap finely enough, and screenshots stay legible)
//  - images the shell converted to PNG (TIFF, HEIC) that were scaled down because they were too large: the shell supplies the original size, and what is drawn is the converted PNG

export type Size = { w: number; h: number };
type Media = HTMLImageElement | HTMLVideoElement;

/** The long side of an SVG's drawn size is at least this */
export const VECTOR_SIDE = 2048;

interface Known {
  natural: Size;
  work: Size;
  /** Vector image: enlarging must not show blocky pixels */
  vector: boolean;
  /** Has transparent areas: a checkerboard is laid behind it on the canvas and in screenshots (a dark icon stays visible on a dark background) */
  transparent: boolean;
}

const known = new WeakMap<Media, Known>();

/** The size the element itself reports */
function own(media: Media): Size {
  return media instanceof HTMLVideoElement
    ? { w: media.videoWidth, h: media.videoHeight }
    : { w: media.naturalWidth, h: media.naturalHeight };
}

/** Recorded when an image finishes loading (recorded again if the same img gets a new src); not needed for video */
export function rememberSize(media: Media, info: Known): void {
  known.set(media, info);
}

/** Original size: recorded in the note file and used for the pixels given to AI */
export const naturalSize = (media: Media): Size => known.get(media)?.natural ?? own(media);

/** Drawn size: for layout, snapping to whole pixels, and screenshots */
export const workSize = (media: Media): Size => known.get(media)?.work ?? own(media);

export const isTransparent = (media: Media): boolean => known.get(media)?.transparent ?? false;

/** Whether an image has transparent areas: scale it to 32 × 32 and check alpha (if the pixels cannot be read, treat it as opaque) */
export function hasAlpha(img: HTMLImageElement): boolean {
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 32;
    const g = c.getContext("2d", { willReadFrequently: true });
    if (!g) return false;
    g.drawImage(img, 0, 0, 32, 32);
    const d = g.getImageData(0, 0, 32, 32).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
  } catch {
    // Cross-origin pixels cannot be read (item URLs all carry CORS, so this should not happen)
  }
  return false;
}

/** An SVG's drawn size: the long side enlarged to VECTOR_SIDE (ones already larger are left alone), rounded to integers */
export function vectorWork(natural: Size): Size {
  const k = Math.max(1, VECTOR_SIDE / Math.max(natural.w, natural.h));
  return { w: Math.max(1, Math.round(natural.w * k)), h: Math.max(1, Math.round(natural.h * k)) };
}

/** An absolute length (px, pt, mm, ...; a bare number counts too); percentages, auto and unspecified do not count */
const ABSOLUTE = /^\s*[+]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?\s*(px|pt|pc|mm|cm|in|q|em|ex|rem)?\s*$/i;

/**
 * An SVG's original size. The browser's naturalWidth / Height are right when width and height both have absolute lengths (units already converted),
 * and also right when only one is given, since the other is filled in from the viewBox ratio; when **neither** is given, the browser fits the ratio into the default 300 × 150 box (viewBox="0 0 24 24" reports 150 × 150),
 * so then the viewBox's width and height are used: that is the coordinate system an agent sees when editing the SVG. text is the SVG source (only the root element's opening tag is read)
 */
export function svgNaturalSize(text: string, browser: Size): Size {
  const tag = /<svg\b((?:[^>"']|"[^"]*"|'[^']*')*)>/i.exec(text)?.[1];
  if (!tag) return browser;
  const attr = (name: string) =>
    new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i")
      .exec(tag)
      ?.slice(1)
      .find((v) => v !== undefined);
  const width = attr("width");
  const height = attr("height");
  if ((width !== undefined && ABSOLUTE.test(width)) || (height !== undefined && ABSOLUTE.test(height))) return browser;
  const box = attr("viewBox")
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (box?.length === 4 && box[2] > 0 && box[3] > 0 && box.every(Number.isFinite)) return { w: round2(box[2]), h: round2(box[3]) };
  return browser;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
