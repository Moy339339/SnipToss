import { useIntl } from "react-intl";
import { AppLogo } from "./icons";

// Product mark: the icon + the product name.
// A bitmap wordmark works poorly at small sizes:
// scaled down to 20px it blurs and the strokes go crooked. So the name is real text (a bundled Noto Sans SC Medium subset, scripts/build-brand-font.mjs),
// which is pixel-aligned at small sizes; the icon uses a version drawn on the pixel grid on 1x screens, with edges on whole pixels, and switches back to the vector master on high-DPI screens.

const BLUE = "#5b8cff"; // Same as design/icon/sniptoss.svg
const ORANGE = "#ff6a3d";

/**
 * The 20px pixel-grid icon: a four-corner viewfinder + a note box, line width 2, everything on whole pixels.
 * The note box's right vertical extends 2px further down as a speech-bubble tail (like the "q" shape of the master); without the tail it reads as a focus frame at this size
 */
function PixelMark() {
  const r = 0.5;
  const rect = (x: number, y: number, w: number, h: number, fill: string) => <rect x={x} y={y} width={w} height={h} rx={r} fill={fill} />;
  return (
    <svg className="wordmark-mark is-pixel" width="20" height="20" viewBox="0 0 20 20" aria-hidden>
      {rect(2, 2, 5, 2, BLUE)}
      {rect(2, 2, 2, 5, BLUE)}
      {rect(13, 2, 5, 2, BLUE)}
      {rect(16, 2, 2, 5, BLUE)}
      {rect(2, 16, 5, 2, BLUE)}
      {rect(2, 13, 2, 5, BLUE)}
      {rect(13, 16, 5, 2, BLUE)}
      {rect(16, 13, 2, 5, BLUE)}
      {rect(6, 6, 8, 2, ORANGE)}
      {rect(6, 6, 2, 8, ORANGE)}
      {rect(6, 12, 8, 2, ORANGE)}
      {rect(12, 6, 2, 10, ORANGE)}
    </svg>
  );
}

/** header: top of the library (icon 20 + text 15); about: Settings → About (icon 40 + text 30), same proportions */
export function Wordmark({ size }: { size: "header" | "about" }) {
  // The product name follows the interface language (message brand.name): the Chinese name for Chinese, SnipToss for other languages
  const name = useIntl().formatMessage({ id: "brand.name" });
  return (
    <span className={`wordmark is-${size}`} role="img" aria-label={name}>
      {size === "header" && <PixelMark />}
      <span className={`wordmark-mark${size === "header" ? " is-vector" : ""}`}>
        <AppLogo size={size === "header" ? 20 : 40} />
      </span>
      <span className="wordmark-name" aria-hidden>
        {name}
      </span>
    </span>
  );
}
