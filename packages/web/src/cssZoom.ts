// Interface size (Settings → General) is a CSS zoom set on html (App.tsx). Measured positions (getBoundingClientRect, the mouse's
// clientX) are screen pixels, while an element's own sizes (offsetWidth, clientWidth, scrollTop) and the left / top / width values
// written back are pre-zoom: convert with this before mixing the two in a calculation. Without conversion, at 125% interface size the
// composer and tooltips are misplaced, and dragging the sidebar or marquee-selecting in the library lags behind the mouse

/**
 * The zoom actually applied to el (its own zoom multiplied with all ancestors'); defaults to body, which in the UI is normally just the
 * interface size
 */
export const cssZoom = (el: Element = document.body) => (el as Element & { currentCSSZoom?: number }).currentCSSZoom ?? 1;
