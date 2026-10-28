import type { Tool } from "./annotate";

// Mouse cursors for the annotation tools. A crosshair feels too "engineering", so it is replaced by a rounded pointer plus a small tool
// badge: the pointer tip is the landing point (still pixel-accurate), and the color follows the mark color. The point tool uses the pin
// directly, the same shape as the one that lands. One SVG each for 1x and 2x so high-DPI screens stay sharp; the canvas is 32×32 and the
// hotspot is given in 1x coordinates.

/** The shapes in the tool badge, the same set as the toolbar icons (16 units) */
const GLYPH: Partial<Record<Tool, string>> = {
  rect: '<rect x="2.5" y="3.5" width="11" height="9" rx="1.5"/>',
  pen: '<path d="M2.5 12.5c2.5-1 3-6 5.5-6s1.5 4 3.5 4 2-3 2-3"/>',
  arrow: '<path d="M3 13L13 3M7 3h6v6"/>',
};

/** Pointer: the tip at (2,2), a rounded arrow symmetric about the diagonal */
const POINTER = "M2 2L14.6 7.2Q15.6 7.7 14.6 8.2L10.3 9.8Q10 10 9.8 10.3L8.2 14.6Q7.7 15.6 7.2 14.6Z";
/** Pin: the tip at the bottom left (2,30), the other three corners rounded; the same shape as the pin that lands on the canvas */
const PIN = "M2 30V21.5A8.5 8.5 0 1 1 10.5 30Z";
/** A faint dark outline around the outside: the white edge stays visible on a light picture */
const HALO = "rgba(0,0,0,0.26)";

function pointerSvg(color: string, glyph: string) {
  return (
    `<path d="${POINTER}" fill="none" stroke="${HALO}" stroke-width="3.6" stroke-linejoin="round"/>` +
    `<path d="${POINTER}" fill="${color}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<circle cx="18.5" cy="18.5" r="7.8" fill="${HALO}"/>` +
    `<circle cx="18.5" cy="18.5" r="7" fill="#fff"/>` +
    `<g transform="translate(13.7 13.7) scale(0.6)" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>`
  );
}

function pinSvg(color: string) {
  return (
    `<path d="${PIN}" fill="none" stroke="${HALO}" stroke-width="3.6" stroke-linejoin="round"/>` +
    `<path d="${PIN}" fill="${color}" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>` +
    `<circle cx="10.5" cy="21.5" r="2.6" fill="#fff"/>`
  );
}

const url = (body: string, scale: number) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${32 * scale}" height="${32 * scale}" viewBox="0 0 32 32">${body}</svg>`,
  )}")`;

/** The CSS cursor value for a drawing tool; undefined for a tool that doesn't draw */
export function toolCursor(tool: Tool, color: string): string | undefined {
  const body = tool === "point" ? pinSvg(color) : GLYPH[tool] ? pointerSvg(color, GLYPH[tool]!) : undefined;
  if (!body) return undefined;
  const hot = tool === "point" ? "2 30" : "2 2";
  return `image-set(${url(body, 1)} 1x, ${url(body, 2)} 2x) ${hot}, crosshair`;
}

/** For previews: the data URL of a single SVG (used when taking self-check screenshots) */
export function cursorPreview(tool: Tool, color: string, scale = 4): string | undefined {
  const body = tool === "point" ? pinSvg(color) : GLYPH[tool] ? pointerSvg(color, GLYPH[tool]!) : undefined;
  return body && url(body, scale).slice(5, -2);
}
