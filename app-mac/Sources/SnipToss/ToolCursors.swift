import AppKit

/// The pointers of the capture overlay. Drawing tools look the same as in the main app (packages/web/src/cursors.ts) and the Windows overlay:
/// a rounded pointer in the mark color with the tool's icon in a small white circle at its lower right; the Pin tool is a pin, the shape of
/// the numbered dot it places; Pixelate is a circle as large as the brush. The images are drawn on demand, so they are sharp at any scale.
/// The four-way arrow and the diagonal arrows are drawn here too: macOS 14 has no public cursor for them
enum ToolCursors {
    private static let pointer = "M2 2 L14.6 7.2 Q15.6 7.7 14.6 8.2 L10.3 9.8 Q10 10 9.8 10.3 L8.2 14.6 Q7.7 15.6 7.2 14.6 Z"
    private static let pin = "M2 30 V21.5 A8.5 8.5 0 1 1 10.5 30 Z"
    private static let halo = NSColor(white: 0, alpha: 0x42 / 255)

    /// Room left outside the Pixelate circle for its dark outline
    private static let brushPad: CGFloat = 3

    private static var cache: [String: NSCursor] = [:]

    /// The pointer of a drawing tool in a color; `brush` is the current brush width (the Pixelate circle is drawn at this size)
    static func forTool(_ tool: Tool, color: MarkColor, brush: CGFloat) -> NSCursor? {
        switch tool {
        case .noTool:
            return nil
        case .mosaic:
            return cached("brush-\(brush)") { brushCursor(brush) }
        case .note:
            return cached("pin-\(color.hexText)") {
                cursor(size: 32, hotSpot: CGPoint(x: 2, y: 30)) { context in drawPin(context, color: color.nsColor) }
            }
        default:
            let glyph = glyphOf(tool)
            return cached("tool-\(tool)-\(color.hexText)") {
                cursor(size: 32, hotSpot: CGPoint(x: 2, y: 2)) { context in drawPointer(context, color: color.nsColor, glyph: glyph) }
            }
        }
    }

    /// Four arrows: the selection can be moved
    static var move: NSCursor {
        cached("move") {
            cursor(size: 24, hotSpot: CGPoint(x: 12, y: 12)) { context in
                drawArrows(context, ["M12 3 L12 21 M3 12 L21 12", "FM12 1.5 L15.5 5.5 L8.5 5.5 Z", "FM12 22.5 L15.5 18.5 L8.5 18.5 Z",
                    "FM1.5 12 L5.5 8.5 L5.5 15.5 Z", "FM22.5 12 L18.5 8.5 L18.5 15.5 Z"])
            }
        }
    }

    /// The diagonal from top left to bottom right (the top-left and bottom-right handles)
    static var resizeNWSE: NSCursor {
        cached("nwse") {
            cursor(size: 24, hotSpot: CGPoint(x: 12, y: 12)) { context in
                drawArrows(context, ["M6 6 L18 18", "FM4 4 L10.5 5.2 L5.2 10.5 Z", "FM20 20 L13.5 18.8 L18.8 13.5 Z"])
            }
        }
    }

    /// The diagonal from top right to bottom left (the top-right and bottom-left handles)
    static var resizeNESW: NSCursor {
        cached("nesw") {
            cursor(size: 24, hotSpot: CGPoint(x: 12, y: 12)) { context in
                drawArrows(context, ["M18 6 L6 18", "FM20 4 L18.8 10.5 L13.5 5.2 Z", "FM4 20 L5.2 13.5 L10.5 18.8 Z"])
            }
        }
    }

    private static func cached(_ key: String, _ make: () -> NSCursor) -> NSCursor {
        if let known = cache[key] { return known }
        let made = make()
        cache[key] = made
        return made
    }

    /// A pointer image of `size` points (square), drawn with the y axis pointing down
    private static func cursor(size: CGFloat, hotSpot: CGPoint, draw: @escaping (CGContext) -> Void) -> NSCursor {
        let image = NSImage(size: NSSize(width: size, height: size), flipped: true) { _ in
            if let context = NSGraphicsContext.current?.cgContext { draw(context) }
            return true
        }
        return NSCursor(image: image, hotSpot: NSPoint(x: hotSpot.x, y: hotSpot.y))
    }

    /// Pixelate: a circle as large as the brush, centered on the hot spot (an arrow would not show how wide the stroke will be). A white line
    /// with dark edges, visible on white, black and colored backgrounds; a small dot in the middle keeps a thin brush's center findable
    private static func brushCursor(_ brush: CGFloat) -> NSCursor {
        let center = (brush / 2).rounded() + brushPad
        return cursor(size: center * 2, hotSpot: CGPoint(x: center, y: center)) { context in
            let dark = NSColor(white: 0, alpha: 0x8c / 255).cgColor
            let ring = CGRect(x: center - brush / 2, y: center - brush / 2, width: brush, height: brush)
            let dot = CGRect(x: center - 1.2, y: center - 1.2, width: 2.4, height: 2.4)
            context.setStrokeColor(dark)
            context.setLineWidth(3)
            context.strokeEllipse(in: ring)
            context.setLineWidth(2.6)
            context.strokeEllipse(in: dot)
            context.setStrokeColor(NSColor.white.cgColor)
            context.setLineWidth(1.2)
            context.strokeEllipse(in: ring)
            context.setFillColor(NSColor.white.cgColor)
            context.fillEllipse(in: dot)
        }
    }

    private static func glyphOf(_ tool: Tool) -> [String] {
        switch tool {
        case .rect: return OverlayIcons.rect
        case .ellipse: return OverlayIcons.ellipse
        case .arrow: return OverlayIcons.arrow
        case .pen: return OverlayIcons.pen
        case .text: return OverlayIcons.text
        default: return []
        }
    }

    private static func drawPointer(_ context: CGContext, color: NSColor, glyph: [String]) {
        let shape = SVGPath.parse(pointer)
        context.setLineJoin(.round)
        context.addPath(shape)
        context.setStrokeColor(halo.cgColor)
        context.setLineWidth(3.6)
        context.strokePath()
        context.addPath(shape)
        context.setFillColor(color.cgColor)
        context.setStrokeColor(NSColor.white.cgColor)
        context.setLineWidth(1.6)
        context.drawPath(using: .fillStroke)
        context.setFillColor(halo.cgColor)
        context.fillEllipse(in: CGRect(x: 18.5 - 7.8, y: 18.5 - 7.8, width: 15.6, height: 15.6))
        context.setFillColor(NSColor.white.cgColor)
        context.fillEllipse(in: CGRect(x: 18.5 - 7, y: 18.5 - 7, width: 14, height: 14))
        // The tool's icon (16 units) at 0.6, inside the small circle
        OverlayIcons.draw(glyph, in: context, at: CGPoint(x: 13.7, y: 13.7), scale: 0.6, color: color, lineWidth: 2.4)
    }

    private static func drawPin(_ context: CGContext, color: NSColor) {
        let shape = SVGPath.parse(pin)
        context.setLineJoin(.round)
        context.addPath(shape)
        context.setStrokeColor(halo.cgColor)
        context.setLineWidth(3.6)
        context.strokePath()
        context.addPath(shape)
        context.setFillColor(color.cgColor)
        context.setStrokeColor(NSColor.white.cgColor)
        context.setLineWidth(1.6)
        context.drawPath(using: .fillStroke)
        context.setFillColor(NSColor.white.cgColor)
        context.fillEllipse(in: CGRect(x: 10.5 - 2.6, y: 21.5 - 2.6, width: 5.2, height: 5.2))
    }

    /// Black arrows with a white edge, like the system's resize pointers
    private static func drawArrows(_ context: CGContext, _ parts: [String]) {
        for (ink, width) in [(NSColor.white, CGFloat(3.4)), (NSColor.black, CGFloat(1.4))] {
            context.setLineCap(.butt)
            context.setLineJoin(.miter)
            for entry in parts {
                context.addPath(OverlayIcons.path(entry))
                context.setStrokeColor(ink.cgColor)
                context.setFillColor(ink.cgColor)
                context.setLineWidth(width)
                if OverlayIcons.filled(entry) && ink == NSColor.black {
                    context.fillPath()
                } else {
                    context.strokePath()
                }
            }
        }
    }
}
