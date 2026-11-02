import Foundation

/// A size in physical pixels
typealias PixelSize = (width: Int, height: Int)

/// The position wording for AI: "Region: top left of the frame (x 12%–52%, y 8%–18%), x=230 y=86 w=768 h=108 px": a plain-language bearing
/// and percentages first, then the raw pixels. Word for word the same as describeShape in the main app's core
/// (packages/core/src/review.ts): every shell runs the same golden file tests/golden/where.zh-CN.json, and the wording lives in the
/// ai.where.* messages, so Copy as Images and the Screen Capture notes area say it the same way. Coordinates are normalized to 0–1 (like
/// the notes file); size = the frame's size in pixels, and when unknown only percentages are given
enum ShapeText {
    enum Shape {
        case region(x: Double, y: Double, w: Double, h: Double)
        case spot(x: Double, y: Double)
        case arrow(fromX: Double, fromY: Double, toX: Double, toY: Double)
        case path([(x: Double, y: Double)])
    }

    /// Same as JS's Math.round: .5 rounds up (toward +∞), where the default rounding of many platforms goes to the even number (2.5 → 2)
    /// and the two sides would differ by 1. A value too large for an Int (never a real coordinate) becomes 0 instead of trapping
    private static func jsRound(_ v: Double) -> Int {
        let rounded = (v + 0.5).rounded(.down)
        if !rounded.isFinite || abs(rounded) >= 9.0e18 { return 0 }
        return Int(rounded)
    }

    private static func pct(_ v: Double) -> Int {
        jsRound(min(1, max(0, v)) * 100)
    }

    private static let places: [[String]] = [
        ["topLeft", "top", "topRight"],
        ["left", "center", "right"],
        ["bottomLeft", "bottom", "bottomRight"],
    ]

    private static let across = ["top", "middle", "bottom"]
    private static let down = ["left", "middle", "right"]

    /// The rough position in the frame (nine-grid). If w and h are given it is a region: very wide or very tall ones are described as
    /// spanning across / down
    private static func placeName(_ cx: Double, _ cy: Double, w: Double = 0, h: Double = 0) -> String {
        let col = cx < 1.0 / 3 ? 0 : cx > 2.0 / 3 ? 2 : 1
        let row = cy < 1.0 / 3 ? 0 : cy > 2.0 / 3 ? 2 : 1
        if w >= 0.66 && h >= 0.66 { return ShellText.t("ai.where.most") }
        if w >= 0.66 { return ShellText.t("ai.where.across." + across[row]) }
        if h >= 0.66 { return ShellText.t("ai.where.down." + down[col]) }
        return ShellText.t("ai.where.place." + places[row][col])
    }

    static func describe(_ shape: Shape, size: PixelSize?) -> String {
        // Pixel values are written as text, so no number format of the system's can add a separator or change the minus sign
        func px(_ v: Double, _ total: Int) -> String {
            String(jsRound(v * Double(total)))
        }
        func span(_ x: Double, _ y: Double, _ w: Double, _ h: Double) -> String {
            var text = ShellText.t(
                "ai.where.span",
                values: ["place": placeName(x + w / 2, y + h / 2, w: w, h: h), "x1": pct(x), "x2": pct(x + w), "y1": pct(y), "y2": pct(y + h)])
            if let z = size {
                text += ShellText.t("ai.where.spanPx", ["x": px(x, z.width), "y": px(y, z.height), "w": px(w, z.width), "h": px(h, z.height)])
            }
            return text
        }
        func spotText(_ x: Double, _ y: Double) -> String {
            ShellText.t("ai.where.spot", values: ["place": placeName(x, y), "x": pct(x), "y": pct(y)])
        }
        switch shape {
        case .region(let x, let y, let w, let h):
            return ShellText.t("ai.where.rect", ["span": span(x, y, w, h)])
        case .spot(let x, let y):
            var text = ShellText.t("ai.where.point", ["spot": spotText(x, y)])
            if let z = size { text += ShellText.t("ai.where.pointPx", ["x": px(x, z.width), "y": px(y, z.height)]) }
            return text
        case .arrow(let fromX, let fromY, let toX, let toY):
            var text = ShellText.t("ai.where.arrow", ["from": spotText(fromX, fromY), "to": spotText(toX, toY)])
            if let z = size {
                text += ShellText.t(
                    "ai.where.arrowPx",
                    ["x1": px(fromX, z.width), "y1": px(fromY, z.height), "x2": px(toX, z.width), "y2": px(toY, z.height)])
            }
            return text
        case .path(let points):
            let x = points.map { $0.x }.min() ?? 0
            let y = points.map { $0.y }.min() ?? 0
            let right = points.map { $0.x }.max() ?? 0
            let bottom = points.map { $0.y }.max() ?? 0
            return ShellText.t("ai.where.path", ["span": span(x, y, right - x, bottom - y)])
        }
    }
}
