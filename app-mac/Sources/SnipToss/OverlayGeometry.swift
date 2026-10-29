import CoreGraphics
import Foundation

/// Geometry of the capture overlay as pure functions that unit tests can cover: selection handles, which handle is under the pointer,
/// resizing, snapping to physical pixels, nudging the selection, Shift-drawn squares, and where the toolbar and note box go.
/// All coordinates are points in the overlay view, y pointing down; scale = this display's scale (pixels per point); full = the bounds of
/// this display (the overlay view)
enum OverlayGeometry {
    /// The 8 handles: 0 top-left, 1 top-middle, 2 top-right, 3 right-middle, 4 bottom-right, 5 bottom-middle, 6 bottom-left, 7 left-middle
    static func handlePoints(_ r: CGRect) -> [CGPoint] {
        let middleX = r.wpfX + r.wpfWidth / 2
        let middleY = r.wpfY + r.wpfHeight / 2
        return [
            r.wpfTopLeft, CGPoint(x: middleX, y: r.wpfTop), r.wpfTopRight, CGPoint(x: r.wpfRight, y: middleY),
            r.wpfBottomRight, CGPoint(x: middleX, y: r.wpfBottom), r.wpfBottomLeft, CGPoint(x: r.wpfLeft, y: middleY),
        ]
    }

    /// Which handle the pointer is on: within 6 of a handle square; within 4 of an edge (not just its small middle square) also grabs,
    /// counting as that edge's middle handle. Returns -1 for neither
    static func hitHandle(_ sel: CGRect, _ p: CGPoint) -> Int {
        let pts = handlePoints(sel)
        for i in 0..<8 {
            if abs(p.x - pts[i].x) <= 6 && abs(p.y - pts[i].y) <= 6 { return i }
        }
        let edge: CGFloat = 4
        let inX = p.x >= sel.wpfLeft && p.x <= sel.wpfRight
        let inY = p.y >= sel.wpfTop && p.y <= sel.wpfBottom
        if inX && abs(p.y - sel.wpfTop) <= edge { return 1 }
        if inX && abs(p.y - sel.wpfBottom) <= edge { return 5 }
        if inY && abs(p.x - sel.wpfLeft) <= edge { return 7 }
        if inY && abs(p.x - sel.wpfRight) <= edge { return 3 }
        return -1
    }

    /// Drag handle h to p: dragging past the opposite side flips the rectangle (it is built from two corners)
    static func resized(_ r: CGRect, _ h: Int, _ p: CGPoint) -> CGRect {
        var l = r.wpfLeft
        var t = r.wpfTop
        var rt = r.wpfRight
        var b = r.wpfBottom
        if h == 0 || h == 6 || h == 7 { l = p.x }
        if h == 2 || h == 3 || h == 4 { rt = p.x }
        if h == 0 || h == 1 || h == 2 { t = p.y }
        if h == 4 || h == 5 || h == 6 { b = p.y }
        return WPFRect.spanning(CGPoint(x: l, y: t), CGPoint(x: rt, y: b))
    }

    /// Snap to physical pixels: the captured image has crisp edges and the pixel readout is an integer. Halves round to the even pixel
    static func snap(_ p: CGPoint, scale: CGFloat) -> CGPoint {
        CGPoint(
            x: (p.x * scale).rounded(.toNearestOrEven) / scale,
            y: (p.y * scale).rounded(.toNearestOrEven) / scale)
    }

    static func clamp(_ p: CGPoint, to full: CGRect) -> CGPoint {
        CGPoint(x: clampValue(p.x, full.wpfLeft, full.wpfRight), y: clampValue(p.y, full.wpfTop, full.wpfBottom))
    }

    /// Arrow keys nudge the selection: dx, dy are physical pixels (1 pixel on a 150% display is 2/3 point), and the whole selection stays
    /// on the screen
    static func nudge(_ sel: CGRect, dx: CGFloat, dy: CGFloat, scale: CGFloat, full: CGRect) -> CGRect {
        var moved = sel
        moved.origin.x = clampValue(sel.wpfX + dx / scale, full.wpfLeft, full.wpfRight - sel.wpfWidth)
        moved.origin.y = clampValue(sel.wpfY + dy / scale, full.wpfTop, full.wpfBottom - sel.wpfHeight)
        return moved
    }

    /// Shift held while drawing a rectangle or ellipse: draws a square from the start o toward p, with the side taken from the longer of
    /// the two sides, but never past the selection. Otherwise, with the start near the selection edge, the opposite corner lands outside it
    /// and the "width × height" given to the AI is larger than the image
    static func squareCorner(_ o: CGPoint, _ p: CGPoint, sel: CGRect) -> CGPoint {
        let dx: CGFloat = p.x >= o.x ? 1 : -1
        let dy: CGFloat = p.y >= o.y ? 1 : -1
        var side = max(abs(p.x - o.x), abs(p.y - o.y))
        let roomX = dx > 0 ? sel.wpfRight - o.x : o.x - sel.wpfLeft
        let roomY = dy > 0 ? sel.wpfBottom - o.y : o.y - sel.wpfTop
        side = max(0, min(side, min(roomX, roomY)))
        return CGPoint(x: o.x + dx * side, y: o.y + dy * side)
    }

    /// Where the toolbar goes: right-aligned below the selection; above it if there is no room below; inside the selection at the bottom if
    /// neither fits. The sub-toolbar (color, thickness) sits on the outer side of the toolbar and is absent when subbar's height is 0.
    /// At least 4 from the screen edge
    static func toolbarAt(_ sel: CGRect, toolbar: CGSize, subbar: CGSize, full: CGRect) -> (toolbar: CGPoint, subbar: CGPoint) {
        let need = toolbar.height + (subbar.height > 0 ? subbar.height + 6 : 0)
        let x = clampValue(
            sel.wpfRight - toolbar.width, full.wpfLeft + 4, max(full.wpfLeft + 4, full.wpfRight - 4 - toolbar.width))
        let y: CGFloat
        var below = false
        if sel.wpfBottom + 8 + need <= full.wpfBottom - 4 {
            y = sel.wpfBottom + 8
            below = true
        } else if sel.wpfTop - 8 - need >= full.wpfTop + 4 {
            y = sel.wpfTop - 8 - toolbar.height
        } else {
            y = sel.wpfBottom - 8 - toolbar.height
        }
        let sx = clampValue(x, full.wpfLeft + 4, max(full.wpfLeft + 4, full.wpfRight - 4 - subbar.width))
        let subY = below ? y + toolbar.height + 6 : y - 6 - subbar.height
        return (CGPoint(x: x, y: y), CGPoint(x: sx, y: subY))
    }

    /// Where the note box goes: first to the right of anchor (the mark grown by a margin, or the toolbar), else to its left, else below
    /// (above if that does not fit either); at least 8 from the screen edge
    static func noteAt(_ anchor: CGRect, size: CGSize, full: CGRect) -> CGPoint {
        var x = anchor.wpfRight + 8
        if x + size.width > full.wpfRight - 8 { x = anchor.wpfLeft - 8 - size.width }
        var y = anchor.wpfTop
        if x < full.wpfLeft + 8 {
            x = clampValue(anchor.wpfLeft, full.wpfLeft + 8, full.wpfRight - 8 - size.width)
            y = anchor.wpfBottom + 8
            if y + size.height > full.wpfBottom - 8 { y = anchor.wpfTop - 8 - size.height }
        }
        return CGPoint(x: x, y: clampValue(y, full.wpfTop + 8, full.wpfBottom - 8 - size.height))
    }
}
