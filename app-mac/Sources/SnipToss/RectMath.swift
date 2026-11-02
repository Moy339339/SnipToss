import CoreGraphics
import Foundation

/// The rules of WPF's `Rect`, `Point` and `Vector` on CoreGraphics' types. The overlay's behavior depends on details where `CGRect`
/// differs: `CGRect.contains` leaves out the right and bottom edges, `CGRect.width` and `minX` normalize a negative size, `CGRect.isEmpty`
/// is true for any zero width, and there is no "empty rectangle" value that swallows a union. Everything here is named `wpf…` so it cannot
/// be mixed up with the CoreGraphics member of nearly the same name. A rectangle stays a `CGRect` (x, y, width, height are stored as given,
/// no normalizing); the overlay always works in points with the y axis pointing down
enum WPFRect {
    /// The empty rectangle: x and y at +∞, width and height at −∞. Test for it with `wpfIsEmpty`
    static let empty = CGRect(x: CGFloat.infinity, y: CGFloat.infinity, width: -CGFloat.infinity, height: -CGFloat.infinity)

    /// The rectangle between two corners, whichever way round they are given (a rectangle built from two points)
    static func spanning(_ a: CGPoint, _ b: CGPoint) -> CGRect {
        let x = min(a.x, b.x)
        let y = min(a.y, b.y)
        return CGRect(x: x, y: y, width: max(max(a.x, b.x) - x, 0), height: max(max(a.y, b.y) - y, 0))
    }
}

/// A value kept between two limits. Same as .NET's `Math.Clamp` but never throws: with the limits the wrong way round it returns one of
/// them
func clampValue(_ value: CGFloat, _ low: CGFloat, _ high: CGFloat) -> CGFloat {
    if value < low { return low }
    if value > high { return high }
    return value
}

extension CGRect {
    // The stored numbers as they are. `width` and `minX` of CGRect would turn the empty rectangle's −∞ size into +∞
    var wpfX: CGFloat { origin.x }
    var wpfY: CGFloat { origin.y }
    var wpfWidth: CGFloat { size.width }
    var wpfHeight: CGFloat { size.height }

    /// Only a negative width makes a rectangle empty; a width of 0 is a valid rectangle that holds its own edge
    var wpfIsEmpty: Bool { size.width < 0 }

    var wpfLeft: CGFloat { origin.x }
    var wpfTop: CGFloat { origin.y }
    var wpfRight: CGFloat { wpfIsEmpty ? -CGFloat.infinity : origin.x + size.width }
    var wpfBottom: CGFloat { wpfIsEmpty ? -CGFloat.infinity : origin.y + size.height }

    var wpfTopLeft: CGPoint { CGPoint(x: wpfLeft, y: wpfTop) }
    var wpfTopRight: CGPoint { CGPoint(x: wpfRight, y: wpfTop) }
    var wpfBottomRight: CGPoint { CGPoint(x: wpfRight, y: wpfBottom) }
    var wpfBottomLeft: CGPoint { CGPoint(x: wpfLeft, y: wpfBottom) }

    /// All four edges count as inside; the empty rectangle holds nothing. The right and bottom tests are written as `x - width <= left`
    /// (not `x <= left + width`) because the two can round differently
    func wpfContains(_ p: CGPoint) -> Bool {
        if wpfIsEmpty { return false }
        return p.x >= origin.x && p.x - size.width <= origin.x && p.y >= origin.y && p.y - size.height <= origin.y
    }

    /// Touching edges count as overlapping; the empty rectangle overlaps nothing
    func wpfIntersects(_ other: CGRect) -> Bool {
        if wpfIsEmpty || other.wpfIsEmpty { return false }
        return other.wpfLeft <= wpfRight && other.wpfRight >= wpfLeft && other.wpfTop <= wpfBottom && other.wpfBottom >= wpfTop
    }

    /// The overlap, or the empty rectangle when there is none
    func wpfIntersect(_ other: CGRect) -> CGRect {
        if !wpfIntersects(other) { return WPFRect.empty }
        let left = max(wpfLeft, other.wpfLeft)
        let top = max(wpfTop, other.wpfTop)
        // Never below 0, so rounding cannot turn an overlap that is a line into an empty rectangle
        let width = max(min(wpfRight, other.wpfRight) - left, 0)
        let height = max(min(wpfBottom, other.wpfBottom) - top, 0)
        return CGRect(x: left, y: top, width: width, height: height)
    }

    /// The smallest rectangle holding both; the empty rectangle is left out
    func wpfUnion(_ other: CGRect) -> CGRect {
        if wpfIsEmpty { return other }
        if other.wpfIsEmpty { return self }
        let left = min(wpfLeft, other.wpfLeft)
        let top = min(wpfTop, other.wpfTop)
        var width = CGFloat.infinity
        var height = CGFloat.infinity
        // Infinite sizes are kept infinite (∞ − ∞ would be NaN)
        if other.size.width != CGFloat.infinity && size.width != CGFloat.infinity {
            width = max(max(wpfRight, other.wpfRight) - left, 0)
        }
        if other.size.height != CGFloat.infinity && size.height != CGFloat.infinity {
            height = max(max(wpfBottom, other.wpfBottom) - top, 0)
        }
        return CGRect(x: left, y: top, width: width, height: height)
    }

    /// The smallest rectangle holding this one and the point
    func wpfUnion(_ p: CGPoint) -> CGRect {
        wpfUnion(WPFRect.spanning(p, p))
    }

    /// Grown by `width` on the left and right and by `height` on top and bottom (shrunk when negative). A result with a negative width or
    /// height is the empty rectangle, not a rectangle with a negative size. The empty rectangle stays empty
    func wpfInflated(by width: CGFloat, _ height: CGFloat) -> CGRect {
        if wpfIsEmpty { return self }
        var r = self
        r.origin.x -= width
        r.origin.y -= height
        // Two additions, not a multiplication by 2, so a huge value does not overflow early
        r.size.width += width
        r.size.width += width
        r.size.height += height
        r.size.height += height
        if !(r.size.width >= 0 && r.size.height >= 0) { return WPFRect.empty }
        return r
    }
}

extension CGPoint {
    /// The vector from `other` to this point
    func wpfVector(from other: CGPoint) -> CGVector {
        CGVector(dx: x - other.x, dy: y - other.y)
    }

    /// The length of the vector between the two points
    func wpfDistance(to other: CGPoint) -> CGFloat {
        wpfVector(from: other).wpfLength
    }

    /// This point moved by a vector
    func wpfOffset(by v: CGVector) -> CGPoint {
        CGPoint(x: x + v.dx, y: y + v.dy)
    }
}

extension CGVector {
    var wpfLengthSquared: CGFloat { dx * dx + dy * dy }

    /// `sqrt(x² + y²)` exactly (not `hypot`, which can differ in the last bit)
    var wpfLength: CGFloat { wpfLengthSquared.squareRoot() }

    /// The dot product
    func wpfDot(_ other: CGVector) -> CGFloat {
        dx * other.dx + dy * other.dy
    }

    func wpfScaled(by factor: CGFloat) -> CGVector {
        CGVector(dx: dx * factor, dy: dy * factor)
    }
}
