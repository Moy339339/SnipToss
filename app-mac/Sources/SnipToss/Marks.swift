import AppKit
import CoreGraphics
import Foundation

/// Tools on the screenshot. `note` = place a numbered dot and write a note (the main app's Pin tool); `noTool` = no tool is selected
enum Tool {
    case noTool
    case rect
    case ellipse
    case arrow
    case pen
    case mosaic
    case text
    case note
}

/// A mark's color: red, green and blue, fully opaque
struct MarkColor: Hashable {
    let r: UInt8
    let g: UInt8
    let b: UInt8

    /// From 0xRRGGBB
    init(hex: Int) {
        self.init(r: UInt8(truncatingIfNeeded: hex >> 16), g: UInt8(truncatingIfNeeded: hex >> 8), b: UInt8(truncatingIfNeeded: hex))
    }

    init(r: UInt8, g: UInt8, b: UInt8) {
        self.r = r
        self.g = g
        self.b = b
    }

    /// `#rrggbb`, lower case
    var hexText: String {
        func two(_ v: UInt8) -> String {
            let digits = String(v, radix: 16)
            return digits.count == 1 ? "0" + digits : digits
        }
        return "#" + two(r) + two(g) + two(b)
    }
}

extension String {
    /// Without white space and line breaks at both ends
    var trimmedBothEnds: String {
        trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Without white space and line breaks at the end only
    var trimmedEnd: String {
        var rest = Substring(self)
        while let last = rest.last, last.unicodeScalars.allSatisfy({ CharacterSet.whitespacesAndNewlines.contains($0) }) {
            rest = rest.dropLast()
        }
        return String(rest)
    }
}

/// How big a text takes when it is drawn (hit testing needs it; the font is whatever the marks are drawn in)
protocol TextMeasuring {
    /// The size of the text at this font size: the width of the widest line, trailing white space included, and the lines' heights added up
    func size(of text: String, fontSize: CGFloat) -> CGSize
}

/// The measure the app uses: the system font through AppKit's string metrics (CoreText underneath)
struct SystemTextMeasure: TextMeasuring {
    func size(of text: String, fontSize: CGFloat) -> CGSize {
        let font = NSFont.systemFont(ofSize: fontSize)
        let attributes: [NSAttributedString.Key: Any] = [.font: font]
        let lineHeight = font.ascender - font.descender + font.leading
        var width: CGFloat = 0
        var lines: CGFloat = 0
        for line in text.split(omittingEmptySubsequences: false, whereSeparator: { $0 == "\n" || $0 == "\r\n" || $0 == "\r" }) {
            width = max(width, (String(line) as NSString).size(withAttributes: attributes).width)
            lines += 1
        }
        return CGSize(width: width, height: lines * lineHeight)
    }
}

/// One thing drawn on the screenshot. Coordinates are points in the overlay view (multiplied by the scale when composited into the image)
final class Mark {
    var kind: Tool
    var color: MarkColor
    /// Line width; for text, the font size; for Pixelate, the brush width
    var size: CGFloat
    /// Rectangle / ellipse / arrow: start and end points; pen / Pixelate: a series of points; text / numbered dot: one point (the text's
    /// top-left corner)
    var points: [CGPoint]
    /// The text the Text tool writes on the image
    var text: String
    /// The note for the AI; only a mark with one gets a number
    var note: String
    /// The note's category (change / remove / add / question), same as the main app's notes
    var category: String
    var number: Int
    /// The number shown while its note is being written (not saved yet): while writing you can see what is being marked, and the numbered
    /// dot especially needs it, or clicking would show nothing
    var pendingNumber: Int
    /// When one note marks several places, the places marked afterwards point to the first one (the note's text, category and number are
    /// kept on the first place, docs/adr/0009-several-places.md).
    /// It is nil for the first place and for marks without a note. A later place is always ordered after the first
    var lead: Mark?
    /// The order in which it was added to the screenshot (assigned by the state machine): undo compares it with color changes to see which
    /// is later
    var seq = 0

    init(
        kind: Tool = .noTool, color: MarkColor = MarkColor(r: 0, g: 0, b: 0), size: CGFloat = 0, points: [CGPoint] = [], text: String = "",
        note: String = "", category: String = "change", number: Int = 0, pendingNumber: Int = 0, lead: Mark? = nil
    ) {
        self.kind = kind
        self.color = color
        self.size = size
        self.points = points
        self.text = text
        self.note = note
        self.category = category
        self.number = number
        self.pendingNumber = pendingNumber
        self.lead = lead
    }

    /// Which note this place belongs to: a later place belongs to the first, any other to itself
    var head: Mark { lead ?? self }

    var hasNote: Bool { number > 0 }

    var bounds: CGRect {
        if points.isEmpty { return WPFRect.empty }
        var r = WPFRect.spanning(points[0], points[0])
        for p in points { r = r.wpfUnion(p) }
        return r
    }

    /// Too small to count (an accidental click)
    var isTiny: Bool {
        switch kind {
        case .rect, .ellipse:
            let box = bounds
            return box.wpfWidth < 4 || box.wpfHeight < 4
        case .arrow:
            return points[points.count - 1].wpfDistance(to: points[0]) < 8
        case .pen, .mosaic:
            return points.count < 2
        case .text:
            return text.trimmedBothEnds.isEmpty
        case .noTool, .note:
            return false
        }
    }

    /// Whether the point is on this mark (a hit selects it so its color can change): lines use half the thickness plus 4, the arrowhead is
    /// handled separately, text uses the text's extent. Pixelate has no color and does not count; a numbered dot only counts on its number
    /// circle (the state machine uses `MarkPainter.badgeCenter`, which clamps it into the selection)
    func hits(_ p: CGPoint, measure: TextMeasuring) -> Bool {
        let tolerance = size / 2 + 4
        switch kind {
        case .rect:
            let box = bounds
            let outer = box.wpfInflated(by: tolerance, tolerance)
            // Empty when the rectangle is too small: the whole rectangle counts
            let inner = box.wpfInflated(by: -tolerance, -tolerance)
            return outer.wpfContains(p) && !inner.wpfContains(p)
        case .ellipse:
            return Mark.ellipseDistance(bounds, p) <= tolerance
        case .arrow:
            // The head is at most twice the line width plus 5 wide (the arrow's drawing)
            let tip = points[points.count - 1]
            return Mark.segmentDistance(p, points[0], tip) <= tolerance || p.wpfDistance(to: tip) <= 2 * size + 9
        case .pen:
            if points.count == 1 { return p.wpfDistance(to: points[0]) <= tolerance }
            var i = 1
            while i < points.count {
                if Mark.segmentDistance(p, points[i - 1], points[i]) <= tolerance { return true }
                i += 1
            }
            return false
        case .text:
            let box = MarkPainter.textBounds(self, measure: measure).wpfInflated(by: 2, 2)
            return box.wpfContains(p)
        case .noTool, .mosaic, .note:
            return false
        }
    }

    private static func segmentDistance(_ p: CGPoint, _ a: CGPoint, _ b: CGPoint) -> CGFloat {
        let ab = b.wpfVector(from: a)
        let t: CGFloat = ab.wpfLengthSquared < 1e-9 ? 0 : clampValue(p.wpfVector(from: a).wpfDot(ab) / ab.wpfLengthSquared, 0, 1)
        let nearest = a.wpfOffset(by: ab.wpfScaled(by: t))
        return p.wpfDistance(to: nearest)
    }

    /// Distance from a point to the ellipse outline (first-order approximation: |f| / |∇f|, exact for a circle)
    private static func ellipseDistance(_ b: CGRect, _ p: CGPoint) -> CGFloat {
        let rx = max(b.wpfWidth / 2, 1)
        let ry = max(b.wpfHeight / 2, 1)
        let dx = p.x - (b.wpfX + b.wpfWidth / 2)
        let dy = p.y - (b.wpfY + b.wpfHeight / 2)
        let rx2 = rx * rx
        let ry2 = ry * ry
        let r = (dx * dx / rx2 + dy * dy / ry2).squareRoot()
        if r < 1e-9 { return min(rx, ry) }
        let rx4 = rx * rx * rx * rx
        let ry4 = ry * ry * ry * ry
        let grad = (dx * dx / rx4 + dy * dy / ry4).squareRoot() / r
        return abs(r - 1) / grad
    }

    /// Where the number is drawn: top-left corner for a rectangle or ellipse, the tail for an arrow, the starting point for a pen stroke,
    /// and the dot itself for a numbered dot
    var badgeAt: CGPoint {
        switch kind {
        case .rect, .ellipse: return bounds.wpfTopLeft
        default: return points[0]
        }
    }

    /// How its position is described in the text given to the AI, the same scheme as the main app (ShapeText): sel = the selection (points;
    /// it is the screenshot), size = the screenshot's size in physical pixels. A rectangle or ellipse is described by its bounding region,
    /// a pen stroke or Pixelate by its bounding box, and text or a numbered dot by that point
    func whereText(sel: CGRect, size pixels: PixelSize) -> String {
        func normalized(_ p: CGPoint) -> (x: Double, y: Double) {
            (Double((p.x - sel.wpfX) / sel.wpfWidth), Double((p.y - sel.wpfY) / sel.wpfHeight))
        }
        let shape: ShapeText.Shape
        switch kind {
        case .rect, .ellipse:
            let box = bounds
            let corner = normalized(box.wpfTopLeft)
            shape = .region(x: corner.x, y: corner.y, w: Double(box.wpfWidth / sel.wpfWidth), h: Double(box.wpfHeight / sel.wpfHeight))
        case .pen, .mosaic:
            shape = .path(points.map { normalized($0) })
        case .arrow:
            let from = normalized(points[0])
            let to = normalized(points[points.count - 1])
            shape = .arrow(fromX: from.x, fromY: from.y, toX: to.x, toY: to.y)
        case .noTool, .text, .note:
            let spot = normalized(points[0])
            shape = .spot(x: spot.x, y: spot.y)
        }
        return ShapeText.describe(shape, size: pixels)
    }

    /// How the places this note marks (itself + the ones marked after it, in drawing order) are described: one place is the same as
    /// `whereText`, several read "3 places — Region: …; Point: …" (the message is the main app's ai.where.many). When the places differ in
    /// color, each one is prefixed with its color, "(Yellow) Point: …": users change colors so that the note can say which place gets which
    /// change
    func whereAll(_ all: [Mark], sel: CGRect, size pixels: PixelSize) -> String {
        let places = all.filter { $0.head === self }
        if places.count <= 1 { return whereText(sel: sel, size: pixels) }
        let colored = Set(places.map { $0.color }).count > 1
        let list = places.map { place -> String in
            let placeText = place.whereText(sel: sel, size: pixels)
            return colored ? ShellText.t("ai.where.colored", ["color": ToolPrefs.name(place.color), "where": placeText]) : placeText
        }.joined(separator: ShellText.t("ai.where.manySeparator"))
        return ShellText.t("ai.where.many", values: ["count": places.count, "list": list])
    }
}

/// The four note categories; names and colors match the main app (CATEGORY_LABEL in core, --cat-* in styles.css)
enum Categories {
    static let keys = ["change", "remove", "add", "question"]

    /// The category name (messages category.*, following the UI language); an unknown key is treated as Change
    static func label(_ key: String) -> String {
        ShellText.t("category." + valid(key))
    }

    static func color(_ key: String) -> MarkColor {
        switch key {
        case "remove": return MarkColor(r: 0xff, g: 0x90, b: 0x90)
        case "add": return MarkColor(r: 0x6f, g: 0xdc, b: 0x9f)
        case "question": return MarkColor(r: 0xff, g: 0xc8, b: 0x61)
        // --cat-change (purple: blue is kept for interaction)
        default: return MarkColor(r: 0xb3, g: 0x9d, b: 0xff)
        }
    }

    static func valid(_ key: String?) -> String {
        if let key, keys.contains(key) { return key }
        return "change"
    }
}

/// Where the marks' numbers and texts sit. Drawing uses the same functions, so what is drawn is what can be hit
enum MarkPainter {
    /// The center of the number circle: the mark's number position, clamped into the selection (at least 10 from the edge, or compositing
    /// would crop it in half). Drawing and hit-testing both use it: with the unclamped position for hit-testing, a rectangle right in the
    /// selection's corner would have its number drawn 10 inside yet not clickable
    static func badgeCenter(_ m: Mark, keepInside: CGRect) -> CGPoint {
        clamp(m.badgeAt, keepInside, margin: 10)
    }

    /// The area a text mark covers (drawn at points[0], the top-left corner)
    static func textBounds(_ m: Mark, measure: TextMeasuring) -> CGRect {
        let measured = measure.size(of: m.text, fontSize: m.size)
        return CGRect(origin: m.points[0], size: measured)
    }

    private static func clamp(_ p: CGPoint, _ r: CGRect, margin: CGFloat) -> CGPoint {
        if r.wpfIsEmpty { return p }
        return CGPoint(
            x: clampValue(p.x, r.wpfLeft + margin, max(r.wpfLeft + margin, r.wpfRight - margin)),
            y: clampValue(p.y, r.wpfTop + margin, max(r.wpfTop + margin, r.wpfBottom - margin)))
    }
}
