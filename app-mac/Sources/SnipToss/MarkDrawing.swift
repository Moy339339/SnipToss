import AppKit

/// Draws the marks. The live display on the overlay and the composited image use the same code, so what is seen is what gets copied.
/// Every function draws into a CGContext whose y axis points down (the overlay view, or the composited picture set up that way), in points
extension MarkPainter {
    /// - Parameters:
    ///   - pixelated: the pixelated picture of the whole screen, drawn over `screen` (points)
    ///   - keepInside: the screenshot's selection: numbers are kept inside it, or compositing would crop them in half
    ///   - zoom: how many times a small screenshot is enlarged when composited: positions grow with it, while line widths, text and the
    ///     number circle are scaled back by it, so they keep their usual size
    static func draw(_ m: Mark, in context: CGContext, pixelated: CGImage?, screen: CGRect, keepInside: CGRect, zoom: CGFloat = 1) {
        let color = m.color.nsColor.cgColor
        context.saveGState()
        context.setLineCap(.round)
        context.setLineJoin(.round)
        context.setStrokeColor(color)
        context.setLineWidth(m.size / zoom)
        switch m.kind {
        case .rect:
            let b = m.bounds
            context.stroke(CGRect(x: b.wpfX, y: b.wpfY, width: b.wpfWidth, height: b.wpfHeight))
        case .ellipse:
            let b = m.bounds
            context.strokeEllipse(in: CGRect(x: b.wpfX, y: b.wpfY, width: b.wpfWidth, height: b.wpfHeight))
        case .arrow:
            drawArrow(in: context, color: color, from: m.points[0], to: m.points[m.points.count - 1], width: m.size / zoom)
        case .pen:
            context.addPath(polyline(m.points))
            context.strokePath()
        case .mosaic:
            // A stroke with a single point counts as an accidental click and is dropped (isTiny), so there are always two or more points.
            // The brush covers the same part of the picture whatever the zoom, so its width is not scaled back
            if let pixelated, !m.points.isEmpty {
                let area = polyline(m.points).copy(strokingWithWidth: m.size, lineCap: .round, lineJoin: .round, miterLimit: 10)
                context.addPath(area)
                context.clip()
                drawPicture(pixelated, in: screen, context: context)
            }
        case .text:
            if !m.points.isEmpty { drawText(m.text, size: m.size / zoom, color: m.color.nsColor, at: m.points[0], in: context) }
        case .noTool, .note:
            break
        }
        context.restoreGState()
        // Places marked afterwards draw the first place's number (one note, one number)
        let number = m.head.hasNote ? m.head.number : m.head.pendingNumber
        if number > 0 { drawBadge(number, color: m.color, center: badgeCenter(m, keepInside: keepInside), radius: 10 / zoom, in: context) }
    }

    /// The number: a solid circle with white text, looking the same as the numbers on the main app's canvas
    static func drawBadge(_ number: Int, color: MarkColor, center: CGPoint, radius: CGFloat = 10, in context: CGContext) {
        context.saveGState()
        let circle = CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2)
        context.setFillColor(color.nsColor.cgColor)
        context.fillEllipse(in: circle)
        // The white ring scales with the circle (when the screenshot is enlarged for compositing the circle is scaled back; a ring that did
        // not shrink would become a thick white band)
        context.setStrokeColor(NSColor(white: 1, alpha: 0xcc / 255).cgColor)
        context.setLineWidth(1.5 * radius / 10)
        context.strokeEllipse(in: circle)
        context.restoreGState()
        let label = NSAttributedString(
            string: String(number), attributes: [.font: OverlayStyle.font(radius * 1.2, weight: .semibold), .foregroundColor: NSColor.white])
        let size = label.size()
        withAppKit(context) { label.draw(at: CGPoint(x: center.x - size.width / 2, y: center.y - size.height / 2)) }
    }

    /// The text a Text mark writes, its top-left corner at `at`
    static func drawText(_ text: String, size: CGFloat, color: NSColor, at: CGPoint, in context: CGContext) {
        let label = NSAttributedString(string: text, attributes: [.font: OverlayStyle.font(size), .foregroundColor: color])
        withAppKit(context) { label.draw(at: at) }
    }

    /// An arrow: a line with a round tail and a filled head. The head grows with the line width and shrinks for a very short arrow
    static func drawArrow(in context: CGContext, color: CGColor, from: CGPoint, to: CGPoint, width: CGFloat) {
        let vx = to.x - from.x
        let vy = to.y - from.y
        let length = (vx * vx + vy * vy).squareRoot()
        if length < 1 { return }
        let ux = vx / length
        let uy = vy / length
        let headLength = min(length * 0.6, 4 * width + 10)
        let headHalf = headLength * 0.5
        let neck = CGPoint(x: to.x - ux * headLength, y: to.y - uy * headLength)
        context.saveGState()
        context.setStrokeColor(color)
        context.setFillColor(color)
        // A round start and a flat end: the line is drawn flat, and the round tail is a dot under its start
        context.setLineCap(.butt)
        context.setLineWidth(width)
        context.move(to: from)
        // Into the head by 1, so no seam shows at the joint
        context.addLine(to: CGPoint(x: neck.x + ux, y: neck.y + uy))
        context.strokePath()
        context.fillEllipse(in: CGRect(x: from.x - width / 2, y: from.y - width / 2, width: width, height: width))
        let head = CGMutablePath()
        head.move(to: to)
        head.addLine(to: CGPoint(x: neck.x - uy * headHalf, y: neck.y + ux * headHalf))
        head.addLine(to: CGPoint(x: neck.x + uy * headHalf, y: neck.y - ux * headHalf))
        head.closeSubpath()
        context.setLineWidth(1)
        context.setLineJoin(.round)
        context.addPath(head)
        context.drawPath(using: .fillStroke)
        context.restoreGState()
    }

    /// The line through the points; a single point becomes a dot
    static func polyline(_ points: [CGPoint]) -> CGPath {
        let path = CGMutablePath()
        guard let first = points.first else { return path }
        path.move(to: first)
        if points.count == 1 { path.addLine(to: CGPoint(x: first.x + 0.01, y: first.y)) }
        for p in points.dropFirst() { path.addLine(to: p) }
        return path
    }

    /// The picked mark on the overlay (never in the composited image): a blue dashed line over a white halo, visible on light and dark
    /// pictures. A numbered dot gets a ring around its number; lines are framed with their thickness and the arrowhead included
    static func drawPicked(_ m: Mark, keepInside: CGRect, measure: TextMeasuring, in context: CGContext) {
        context.saveGState()
        defer { context.restoreGState() }
        let shape: CGPath
        if m.kind == .note {
            let c = badgeCenter(m, keepInside: keepInside)
            shape = CGPath(ellipseIn: CGRect(x: c.x - 14, y: c.y - 14, width: 28, height: 28), transform: nil)
        } else {
            let r = m.kind == .text ? textBounds(m, measure: measure) : m.bounds
            let pad = (m.kind == .arrow ? 2 * m.size + 5 : m.kind == .text ? 0 : m.size / 2) + 4
            let box = r.wpfInflated(by: pad, pad)
            if box.wpfIsEmpty { return }
            shape = CGPath(rect: CGRect(x: box.wpfX, y: box.wpfY, width: box.wpfWidth, height: box.wpfHeight), transform: nil)
        }
        context.addPath(shape)
        context.setStrokeColor(NSColor(white: 1, alpha: 0xcc / 255).cgColor)
        context.setLineWidth(3)
        context.strokePath()
        context.addPath(shape)
        context.setStrokeColor(OverlayStyle.accent.cgColor)
        context.setLineWidth(1.5)
        // WPF's dash lengths are in line widths: 2 and 2 of a 1.5 line
        context.setLineDash(phase: 0, lengths: [3, 3])
        context.strokePath()
    }

    /// A picture drawn upright into `rect` of a context whose y axis points down (CoreGraphics draws pictures with the y axis up)
    static func drawPicture(_ picture: CGImage, in rect: CGRect, context: CGContext) {
        context.saveGState()
        context.translateBy(x: 0, y: rect.minY + rect.maxY)
        context.scaleBy(x: 1, y: -1)
        context.interpolationQuality = .none
        context.draw(picture, in: rect)
        context.restoreGState()
    }

    /// Text goes through AppKit, which needs to know the context's y axis points down
    static func withAppKit(_ context: CGContext, _ body: () -> Void) {
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(cgContext: context, flipped: true)
        body()
        NSGraphicsContext.restoreGraphicsState()
    }

    /// How wide one Pixelate block is, in points: at 2× a block is 24 pixels, so pixelated email addresses and phone numbers stay unreadable
    /// on a sharp screen
    static let mosaicBlock: CGFloat = 12

    /// The pixelated version of a whole screen: each block of `mosaicBlock` × scale pixels is filled with its average color, counted from
    /// the picture's top-left corner. In the picture's own color space, so the blocks have the colors of the picture under them
    static func pixelate(_ picture: CGImage, scale: CGFloat) -> CGImage? {
        let block = max(1, Int((mosaicBlock * scale).rounded(.toNearestOrEven)))
        let w = picture.width
        let h = picture.height
        let info = CGImageAlphaInfo.premultipliedLast.rawValue
        let srgb = CGColorSpace(name: CGColorSpace.sRGB)!
        let own = picture.colorSpace.flatMap { $0.model == .rgb ? $0 : nil } ?? srgb
        guard
            let context = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: own, bitmapInfo: info)
                ?? CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4, space: srgb, bitmapInfo: info),
            let data = context.data
        else { return nil }
        context.interpolationQuality = .none
        context.draw(picture, in: CGRect(x: 0, y: 0, width: w, height: h))
        let stride = context.bytesPerRow
        let px = data.bindMemory(to: UInt8.self, capacity: stride * h)
        // The first row in memory is the top of the picture
        var by = 0
        while by < h {
            let bh = min(block, h - by)
            var bx = 0
            while bx < w {
                let bw = min(block, w - bx)
                var r = 0
                var g = 0
                var b = 0
                for y in by..<(by + bh) {
                    var i = y * stride + bx * 4
                    for _ in 0..<bw {
                        r += Int(px[i])
                        g += Int(px[i + 1])
                        b += Int(px[i + 2])
                        i += 4
                    }
                }
                let n = bw * bh
                let ar = UInt8(r / n)
                let ag = UInt8(g / n)
                let ab = UInt8(b / n)
                for y in by..<(by + bh) {
                    var i = y * stride + bx * 4
                    for _ in 0..<bw {
                        px[i] = ar
                        px[i + 1] = ag
                        px[i + 2] = ab
                        px[i + 3] = 255
                        i += 4
                    }
                }
                bx += block
            }
            by += block
        }
        return context.makeImage()
    }
}
