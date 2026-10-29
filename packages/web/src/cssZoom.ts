// Interface size (Settings → General) is a CSS zoom set on html (App.tsx). Measured positions (getBoundingClientRect, the mouse's
// clientX) are screen pixels, while an element's own sizes (offsetWidth, clientWidth, scrollTop) and the left / top / width values
// written back are pre-zoom: convert with this before mixing the two in a calculation. Without conversion, at 125% interface size the
// composer and tooltips are misplaced, and dragging the sidebar or marquee-selecting in the library lags behind the mouse

/**
 * Same definition as Element.currentCSSZoom, for engines without it (WebKit, which a macOS shell uses): the computed zoom of el multiplied with
 * those of all its ancestors. Computed zoom is each element's own value ("normal" or a number; a percentage is read as well)
 */
function zoomFromAncestors(el: Element): number {
  let zoom = 1;
  for (let e: Element | null = el; e; e = e.parentElement) {
    const value = (getComputedStyle(e) as CSSStyleDeclaration & { zoom: string }).zoom;
    const own = value.endsWith("%") ? parseFloat(value) / 100 : parseFloat(value);
    if (own > 0) zoom *= own; // "normal" parses to NaN, which is not > 0
  }
  return zoom;
}

/**
 * The zoom actually applied to el (its own zoom multiplied with all ancestors'); defaults to body, which in the UI is normally just the
 * interface size
 */
export const cssZoom = (el: Element = document.body) =>
  (el as Element & { currentCSSZoom?: number }).currentCSSZoom ?? zoomFromAncestors(el);
