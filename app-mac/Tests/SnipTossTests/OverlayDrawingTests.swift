import AppKit
import XCTest

@testable import SnipToss

/// The overlay's drawing pieces that need no window: the icon paths, where windows land on a screen's layer, the pixelated picture, and
/// marks drawn into pixels (the overlay and the composited image use the same drawing)
final class OverlayDrawingTests: SnipTestCase {
    // MARK: Icon paths

    private func box(_ d: String) -> CGRect { SVGPath.parse(d).boundingBoxOfPath }

    private func assertBox(_ d: String, _ want: CGRect, accuracy: CGFloat = 0.01, file: StaticString = #filePath, line: UInt = #line) {
        let got = box(d)
        for (a, b) in [(got.minX, want.minX), (got.minY, want.minY), (got.width, want.width), (got.height, want.height)] {
            XCTAssertEqual(a, b, accuracy: accuracy, "\(d): \(got)", file: file, line: line)
        }
    }

    func testLinesAndTheShorthandsForThem() {
        assertBox("M3 3 H13 V13 H3 Z", CGRect(x: 3, y: 3, width: 10, height: 10))
        // Pairs after M are lines; commas count as spaces
        assertBox("M0 0 10,0 10 10", CGRect(x: 0, y: 0, width: 10, height: 10))
        assertBox("M3 13 L13 3 M7 3 H13 V9", CGRect(x: 3, y: 3, width: 10, height: 10))
        // Negative numbers and decimals
        assertBox("M-2.5 -1 L2.5 .5", CGRect(x: -2.5, y: -1, width: 5, height: 1.5))
    }

    func testArcsGoTheWayTheSweepFlagSaysWithYPointingDown() {
        // A half circle from left to right: sweep 1 goes up (y negative) and over, sweep 0 goes down and under
        assertBox("M0 0 A10 10 0 0 1 20 0", CGRect(x: 0, y: -10, width: 20, height: 10))
        assertBox("M0 0 A10 10 0 0 0 20 0", CGRect(x: 0, y: 0, width: 20, height: 10))
        // The Ellipse icon: two half arcs make the whole ellipse, 11 × 9 around (8, 8)
        assertBox(OverlayIcons.ellipse[0], CGRect(x: 2.5, y: 3.5, width: 11, height: 9))
        // Radii too small to reach the end are scaled up: still a half circle
        assertBox("M0 0 A1 1 0 0 1 20 0", CGRect(x: 0, y: -10, width: 20, height: 10))
        // The rounded rectangle icon keeps its outer edges
        assertBox(OverlayIcons.rect[0], CGRect(x: 2.5, y: 3.5, width: 11, height: 9))
    }

    func testCurvesAndTheirMirroredControlPoints() {
        // A quadratic curve's box does not reach its control point
        let q = box("M0 0 Q10 10 20 0")
        XCTAssertEqual(q.maxY, 5, accuracy: 0.01)
        // S mirrors the previous control point: a symmetric wave goes as far up as down
        let s = box("M0 0 C0 10 10 10 10 0 S20 -10 20 0")
        XCTAssertEqual(s.maxY, 7.5, accuracy: 0.01)
        XCTAssertEqual(s.minY, -7.5, accuracy: 0.01)
    }

    func testEveryIconAndCursorShapeParses() {
        let all = [
            OverlayIcons.rect, OverlayIcons.ellipse, OverlayIcons.arrow, OverlayIcons.pen, OverlayIcons.mosaic, OverlayIcons.text, OverlayIcons.note,
            OverlayIcons.overall, OverlayIcons.undo, OverlayIcons.close, OverlayIcons.check,
        ].flatMap { $0 }
        for entry in all {
            let b = OverlayIcons.path(entry).boundingBoxOfPath
            // Every icon is drawn inside 16 × 16 (a little slack for the line's own width is not needed: the path itself must fit)
            XCTAssertTrue(b.width > 0 || b.height > 0, entry)
            XCTAssertTrue(b.minX >= 1.9 && b.minY >= 1.9 && b.maxX <= 14.1 && b.maxY <= 14.1, "\(entry): \(b)")
        }
        XCTAssertNotNil(ToolCursors.forTool(.rect, color: ToolPrefs.colors[0], brush: 2))
        XCTAssertNil(ToolCursors.forTool(.noTool, color: ToolPrefs.colors[0], brush: 2))
        // The Pin's hot spot is its tip at the bottom left; the others' the pointer's tip at the top left
        XCTAssertEqual(ToolCursors.forTool(.note, color: ToolPrefs.colors[0], brush: 2)?.hotSpot, NSPoint(x: 2, y: 30))
        XCTAssertEqual(ToolCursors.forTool(.pen, color: ToolPrefs.colors[0], brush: 2)?.hotSpot, NSPoint(x: 2, y: 2))
        // Pixelate: a circle as large as the brush, centered on the hot spot
        let brush = ToolCursors.forTool(.mosaic, color: ToolPrefs.colors[0], brush: 32)
        XCTAssertEqual(brush?.image.size, NSSize(width: 38, height: 38))
        XCTAssertEqual(brush?.hotSpot, NSPoint(x: 19, y: 19))
    }

    // MARK: Windows on a layer

    func testWindowsLandOnTheScreenTheyAreOnInThatScreensCoordinates() {
        // The main screen is 1440 × 900; a second one sits to its right, 100 points higher (AppKit counts up from the main screen's bottom)
        let main = CGRect(x: 0, y: 0, width: 1440, height: 900)
        let second = CGRect(x: 1440, y: 100, width: 1920, height: 1080)
        // The window list counts down from the main screen's top: the second screen's top is 280 above it
        let windows = [
            CGRect(x: 100, y: 50, width: 600, height: 400),
            CGRect(x: 1500, y: -200, width: 400, height: 300),
            // Half off the main screen's right edge: cut to the screen on each side
            CGRect(x: 1240, y: 200, width: 400, height: 100),
            // Too small once cut
            CGRect(x: 1435, y: 500, width: 10, height: 50),
        ]
        XCTAssertEqual(
            WindowList.onLayer(windows, screen: main, mainHeight: 900),
            [CGRect(x: 100, y: 50, width: 600, height: 400), CGRect(x: 1240, y: 200, width: 200, height: 100)])
        XCTAssertEqual(
            WindowList.onLayer(windows, screen: second, mainHeight: 900),
            [CGRect(x: 60, y: 80, width: 400, height: 300), CGRect(x: 0, y: 480, width: 200, height: 100)])
    }

    // MARK: Colors

    func testAMarkColorReadsFromItsHexText() {
        XCTAssertEqual(MarkColor(hexText: "#ff6a3d"), MarkColor(hex: 0xff6a3d))
        XCTAssertEqual(MarkColor(hexText: "#5B8CFF"), MarkColor(hex: 0x5b8cff))
        XCTAssertNil(MarkColor(hexText: "ff6a3d"))
        XCTAssertNil(MarkColor(hexText: "#ff6a3"))
        XCTAssertNil(MarkColor(hexText: "#ff6a3g"))
    }

    // MARK: Pixels

    /// The bytes of a picture, top row first
    private func rgba(_ image: CGImage) -> (bytes: [UInt8], stride: Int) {
        var bytes = [UInt8](repeating: 0, count: image.width * image.height * 4)
        bytes.withUnsafeMutableBytes { buffer in
            let context = CGContext(
                data: buffer.baseAddress, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: image.width * 4,
                space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        }
        return (bytes, image.width * 4)
    }

    func testPixelateFillsEachBlockWithItsAverageColorFromTheTopLeft() throws {
        let picture = PatternScreenSource.image(width: 7, height: 5)
        // 12 points × 1/6 = blocks of 2 pixels; the last column and row are blocks of 1
        let pixelated = try XCTUnwrap(MarkPainter.pixelate(picture, scale: 1.0 / 6))
        let (px, stride) = rgba(pixelated)
        func at(_ x: Int, _ y: Int) -> [UInt8] { Array(px[(y * stride + x * 4)..<(y * stride + x * 4 + 3)]) }
        func average(_ cells: [(Int, Int)]) -> [UInt8] {
            let colors = cells.map { PatternScreenSource.color(x: $0.0, y: $0.1) }
            let n = colors.count
            return [
                UInt8(colors.map { Int($0.red) }.reduce(0, +) / n), UInt8(colors.map { Int($0.green) }.reduce(0, +) / n),
                UInt8(colors.map { Int($0.blue) }.reduce(0, +) / n),
            ]
        }
        let first = average([(0, 0), (1, 0), (0, 1), (1, 1)])
        for (x, y) in [(0, 0), (1, 0), (0, 1), (1, 1)] { XCTAssertEqual(at(x, y), first, "\(x), \(y)") }
        XCTAssertEqual(at(2, 2), average([(2, 2), (3, 2), (2, 3), (3, 3)]))
        // The edge blocks are what is left of the picture
        XCTAssertEqual(at(6, 4), average([(6, 4)]))
        XCTAssertEqual(at(6, 0), average([(6, 0), (6, 1)]))
    }

    /// Draws into a picture whose y axis points down, as the overlay and the compositing do
    private func drawn(_ width: Int, _ height: Int, _ draw: (CGContext) -> Void) throws -> NSBitmapImageRep {
        let blank = try XCTUnwrap(
            NSBitmapImageRep(
                bitmapDataPlanes: nil, pixelsWide: width, pixelsHigh: height, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0))
        let rep = try XCTUnwrap(blank.retagging(with: .sRGB))
        let context = try XCTUnwrap(NSGraphicsContext(bitmapImageRep: rep))
        let cg = context.cgContext
        cg.translateBy(x: 0, y: CGFloat(height))
        cg.scaleBy(x: 1, y: -1)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        draw(cg)
        context.flushGraphics()
        NSGraphicsContext.restoreGraphicsState()
        return rep
    }

    private func color(_ rep: NSBitmapImageRep, _ x: Int, _ y: Int) -> [Int] {
        guard let c = rep.colorAt(x: x, y: y)?.usingColorSpace(.sRGB) else { return [] }
        return [c.redComponent, c.greenComponent, c.blueComponent, c.alphaComponent].map { Int(($0 * 255).rounded()) }
    }

    private func assertColor(_ got: [Int], _ want: MarkColor, file: StaticString = #filePath, line: UInt = #line) {
        let w = [Int(want.r), Int(want.g), Int(want.b), 255]
        XCTAssertEqual(got.count, 4, file: file, line: line)
        for (a, b) in zip(got, w) { XCTAssertEqual(a, b, accuracy: 2, "\(got) vs \(w)", file: file, line: line) }
    }

    func testARectangleIsItsOutlineInItsColorAndNothingInside() throws {
        let orange = ToolPrefs.colors[0]
        let rep = try drawn(100, 60) { context in
            MarkPainter.draw(
                Mark(kind: .rect, color: orange, size: 2, points: [CGPoint(x: 10, y: 10), CGPoint(x: 60, y: 40)]), in: context, pixelated: nil,
                screen: CGRect(x: 0, y: 0, width: 100, height: 60), keepInside: CGRect(x: 0, y: 0, width: 100, height: 60))
        }
        // The top edge is at y 10: the line covers the pixel rows on both sides of it
        assertColor(color(rep, 35, 10), orange)
        assertColor(color(rep, 35, 9), orange)
        assertColor(color(rep, 60, 25), orange)
        XCTAssertEqual(color(rep, 35, 25).last, 0, "inside the rectangle")
        XCTAssertEqual(color(rep, 35, 13).last, 0, "below the line")
    }

    func testAnArrowHasItsLineAndAWiderHead() throws {
        let blue = ToolPrefs.colors[4]
        let rep = try drawn(100, 100) { context in
            MarkPainter.draw(
                Mark(kind: .arrow, color: blue, size: 4, points: [CGPoint(x: 10, y: 50), CGPoint(x: 90, y: 50)]), in: context, pixelated: nil,
                screen: CGRect(x: 0, y: 0, width: 100, height: 100), keepInside: CGRect(x: 0, y: 0, width: 100, height: 100))
        }
        assertColor(color(rep, 30, 50), blue)
        // Off the line beside the shaft, but within the head (26 long, 13 to each side at its base, x 64)
        XCTAssertEqual(color(rep, 30, 55).last, 0)
        assertColor(color(rep, 75, 55), blue)
        // The round tail
        assertColor(color(rep, 9, 50), blue)
    }

    func testANumberIsAFilledCircleInsideTheSelection() throws {
        let green = ToolPrefs.colors[3]
        let rep = try drawn(100, 100) { context in
            let m = Mark(kind: .rect, color: green, size: 2, points: [CGPoint(x: 2, y: 2), CGPoint(x: 60, y: 60)])
            m.number = 1
            // The rectangle starts 2 from the selection's corner: the number is kept 10 inside it
            MarkPainter.draw(
                m, in: context, pixelated: nil, screen: CGRect(x: 0, y: 0, width: 100, height: 100), keepInside: CGRect(x: 0, y: 0, width: 100, height: 100))
            XCTAssertEqual(MarkPainter.badgeCenter(m, keepInside: CGRect(x: 0, y: 0, width: 100, height: 100)), CGPoint(x: 10, y: 10))
        }
        // Left of the digit, inside the circle
        assertColor(color(rep, 4, 10), green)
        // Past the circle and its ring
        XCTAssertEqual(color(rep, 30, 30).last, 0)
    }

    func testPixelateShowsThePixelatedPictureAlongTheStrokeOnly() throws {
        let picture = PatternScreenSource.image(width: 100, height: 100)
        let pixelated = try XCTUnwrap(MarkPainter.pixelate(picture, scale: 1))
        let rep = try drawn(100, 100) { context in
            MarkPainter.draw(
                Mark(kind: .mosaic, color: ToolPrefs.colors[0], size: 20, points: [CGPoint(x: 10, y: 50), CGPoint(x: 90, y: 50)]), in: context,
                pixelated: pixelated, screen: CGRect(x: 0, y: 0, width: 100, height: 100), keepInside: CGRect(x: 0, y: 0, width: 100, height: 100))
        }
        // On the stroke: the block's color, the same over the whole 12-pixel block (block 48–59 across, 48–59 down)
        let a = color(rep, 50, 50)
        XCTAssertEqual(a, color(rep, 58, 52))
        XCTAssertEqual(a.last, 255)
        // Off the stroke: nothing
        XCTAssertEqual(color(rep, 50, 20).last, 0)
    }
}
