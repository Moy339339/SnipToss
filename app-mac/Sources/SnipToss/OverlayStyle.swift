import AppKit

/// Colors and type of the capture overlay: the tokens of packages/web/src/styles.css, the same as the Windows overlay. `accent` is for lines
/// (the selection's outline, handles, selected text); `accentFill` is the solid background under white text and white shapes
enum OverlayStyle {
    static let accent = NSColor(hex: 0x5b8cff)
    static let accentFill = NSColor(hex: 0x386be0)
    static let accentFillHover = NSColor(hex: 0x3b6fe8)
    static let surface2 = NSColor(hex: 0x232327)
    static let hover = NSColor(hex: 0x2a2a2f)
    static let borderStrong = NSColor(hex: 0x3a3a40)
    static let border = NSColor(hex: 0x2c2c31)
    static let text = NSColor(hex: 0xe8e8ea)
    static let text2 = NSColor(hex: 0xa9a9b0)
    static let muted = NSColor(hex: 0x92929a)
    static let bg = NSColor(hex: 0x141416)
    static let danger = NSColor(hex: 0xff5f5f)

    /// The outside of the selection: black at half strength
    static let dim = NSColor.black.withAlphaComponent(0.5)

    /// The font of the overlay's own words and of the text written on a screenshot: the system's, which brings its own fonts for Chinese,
    /// Japanese and Korean
    static func font(_ size: CGFloat, weight: NSFont.Weight = .regular) -> NSFont {
        NSFont.systemFont(ofSize: size, weight: weight)
    }

    /// `a` mixed into `b`: t of `a`, the rest `b`
    static func mix(_ a: NSColor, _ b: NSColor, _ t: CGFloat) -> NSColor {
        let x = a.usingColorSpace(.sRGB) ?? a
        let y = b.usingColorSpace(.sRGB) ?? b
        return NSColor(
            srgbRed: x.redComponent * t + y.redComponent * (1 - t), green: x.greenComponent * t + y.greenComponent * (1 - t),
            blue: x.blueComponent * t + y.blueComponent * (1 - t), alpha: 1)
    }
}

extension NSColor {
    /// From 0xRRGGBB, in sRGB
    convenience init(hex: Int, alpha: CGFloat = 1) {
        self.init(
            srgbRed: CGFloat((hex >> 16) & 0xff) / 255, green: CGFloat((hex >> 8) & 0xff) / 255, blue: CGFloat(hex & 0xff) / 255, alpha: alpha)
    }
}

extension MarkColor {
    var nsColor: NSColor { NSColor(srgbRed: CGFloat(r) / 255, green: CGFloat(g) / 255, blue: CGFloat(b) / 255, alpha: 1) }

    /// From "#rrggbb" (either case); nil for anything else
    init?(hexText: String) {
        guard hexText.count == 7, hexText.hasPrefix("#"), let value = Int(hexText.dropFirst(), radix: 16) else { return nil }
        self.init(hex: value)
    }
}

/// Toolbar icons: 16 × 16, drawn with a 1.3 line (the same set as packages/web/src/icons.tsx and the Windows overlay). A leading F = filled
enum OverlayIcons {
    static let rect = ["M4 3.5 H12 A1.5 1.5 0 0 1 13.5 5 V11 A1.5 1.5 0 0 1 12 12.5 H4 A1.5 1.5 0 0 1 2.5 11 V5 A1.5 1.5 0 0 1 4 3.5 Z"]
    static let ellipse = ["M2.5 8 A5.5 4.5 0 1 0 13.5 8 A5.5 4.5 0 1 0 2.5 8 Z"]
    static let arrow = ["M3 13 L13 3 M7 3 H13 V9"]
    static let pen = ["M2.5 12.5 C5 11.5 5.5 6.5 8 6.5 S9.5 10.5 11.5 10.5 S13.5 7.5 13.5 7.5"]
    static let mosaic = ["M3 3 H13 V13 H3 Z", "FM3 3 H8 V8 H3 Z", "FM8 8 H13 V13 H8 Z"]
    static let text = ["M3.5 4.5 V3 H12.5 V4.5 M8 3 V13 M6 13 H10"]
    static let note = [
        "M8 14 C8 14 12.5 9.9 12.5 6.6 A4.5 4.5 0 0 0 3.5 6.6 C3.5 9.9 8 14 8 14 Z", "M9.6 6.6 A1.6 1.6 0 1 1 6.4 6.6 A1.6 1.6 0 1 1 9.6 6.6 Z",
    ]
    static let overall = [
        "M3 3.5 H13 A1 1 0 0 1 14 4.5 V10.5 A1 1 0 0 1 13 11.5 H7 L4 14 V11.5 H3 A1 1 0 0 1 2 10.5 V4.5 A1 1 0 0 1 3 3.5 Z", "M5 6.5 H11 M5 8.5 H9",
    ]
    static let undo = ["M5 4 L2.5 6.5 L5 9", "M2.5 6.5 H10 A3.5 3.5 0 0 1 10 13.5 H7"]
    static let close = ["M4.5 4.5 L11.5 11.5 M11.5 4.5 L4.5 11.5"]
    static let check = ["M3 8.5 L6.2 11.5 L13 4.5"]

    private static let lock = NSLock()
    private static var parsed: [String: CGPath] = [:]

    /// The path of one entry (without its F), parsed once
    static func path(_ entry: String) -> CGPath {
        let d = filled(entry) ? String(entry.dropFirst()) : entry
        lock.lock()
        defer { lock.unlock() }
        if let known = parsed[d] { return known }
        let made = SVGPath.parse(d)
        parsed[d] = made
        return made
    }

    static func filled(_ entry: String) -> Bool { entry.hasPrefix("F") }

    /// Draws an icon into a context whose y axis points down, at `origin`, scaled by `scale` (1 = 16 points), in one color
    static func draw(_ icon: [String], in context: CGContext, at origin: CGPoint, scale: CGFloat = 1, color: NSColor, lineWidth: CGFloat = 1.3) {
        context.saveGState()
        context.translateBy(x: origin.x, y: origin.y)
        context.scaleBy(x: scale, y: scale)
        context.setLineCap(.round)
        context.setLineJoin(.round)
        context.setLineWidth(lineWidth)
        context.setStrokeColor(color.cgColor)
        context.setFillColor(color.cgColor)
        for entry in icon {
            context.addPath(path(entry))
            if filled(entry) { context.fillPath() } else { context.strokePath() }
        }
        context.restoreGState()
    }
}
