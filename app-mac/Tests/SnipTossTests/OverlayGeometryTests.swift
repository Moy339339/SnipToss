import XCTest

@testable import SnipToss

/// Geometry of the capture overlay (OverlayGeometry). How it feels with a real mouse and real multiple screens is covered by the checks
/// on a real Mac
final class OverlayGeometryTests: XCTestCase {
    private let screen = CGRect(x: 0, y: 0, width: 1920, height: 1080)
    private let sel = CGRect(x: 100, y: 100, width: 400, height: 300)

    func testHandlesAreTheFourCornersAndFourEdgeMidpointsClockwiseFromTheTopLeft() {
        let pts = OverlayGeometry.handlePoints(sel)
        let want = [
            CGPoint(x: 100, y: 100), CGPoint(x: 300, y: 100), CGPoint(x: 500, y: 100), CGPoint(x: 500, y: 250),
            CGPoint(x: 500, y: 400), CGPoint(x: 300, y: 400), CGPoint(x: 100, y: 400), CGPoint(x: 100, y: 250),
        ]
        XCTAssertEqual(pts, want)
    }

    func testWhichHandleIsUnderThePoint() {
        let cases: [(x: CGFloat, y: CGFloat, handle: Int, why: String)] = [
            (104, 96, 0, "within 6 of the top-left corner square"),
            (506, 406, 4, "bottom-right corner"),
            (300, 103, 1, "middle of the top edge"),
            (200, 98, 1, "anywhere along the top edge (within 4 of it) is also the top edge"),
            (200, 404, 5, "bottom edge"),
            (97, 180, 7, "left edge"),
            (503, 330, 3, "right edge"),
            (200, 94, -1, "6 from the top edge: no hit"),
            (300, 250, -1, "middle of the selection"),
            (600, 100, -1, "on the extension of the top edge but outside the selection: no hit"),
        ]
        for c in cases {
            XCTAssertEqual(OverlayGeometry.hitHandle(sel, CGPoint(x: c.x, y: c.y)), c.handle, "(\(c.x), \(c.y)): \(c.why)")
        }
    }

    func testDraggingAHandleMovesOnlyThatEdgeAndDraggingPastTheOppositeEdgeFlips() {
        XCTAssertEqual(OverlayGeometry.resized(sel, 1, CGPoint(x: 999, y: 50)), CGRect(x: 100, y: 50, width: 400, height: 350))
        XCTAssertEqual(OverlayGeometry.resized(sel, 3, CGPoint(x: 600, y: 999)), CGRect(x: 100, y: 100, width: 500, height: 300))
        // The right edge dragged past the left edge
        XCTAssertEqual(OverlayGeometry.resized(sel, 3, CGPoint(x: 50, y: 0)), CGRect(x: 50, y: 100, width: 50, height: 300))
        XCTAssertEqual(OverlayGeometry.resized(sel, 0, CGPoint(x: 20, y: 30)), CGRect(x: 20, y: 30, width: 480, height: 370))
    }

    func testSnappingToPhysicalPixelsOnA150PercentScreenGivesWholeMultiplesOfTwoThirdsOfAPoint() {
        let p = OverlayGeometry.snap(CGPoint(x: 10.4, y: 10.2), scale: 1.5)
        XCTAssertEqual(p.x * 1.5, 16, accuracy: 1e-9)  // 10.4 points = 15.6 physical pixels → 16
        XCTAssertEqual(p.y * 1.5, 15, accuracy: 1e-9)
        XCTAssertEqual(OverlayGeometry.clamp(CGPoint(x: -5, y: 2000), to: screen), CGPoint(x: 0, y: 1080))
    }

    func testSnappingRoundsAHalfPixelToTheEvenPixel() {
        // 2.5 pixels and 3.5 pixels: halves go to 2 and 4
        let p = OverlayGeometry.snap(CGPoint(x: 2.5, y: 3.5), scale: 1)
        XCTAssertEqual(p.x, 2)
        XCTAssertEqual(p.y, 4)
    }

    func testNudgingTheSelectionMovesByPhysicalPixelsAndKeepsTheWholeSelectionOnScreen() {
        XCTAssertEqual(
            OverlayGeometry.nudge(sel, dx: 3, dy: 0, scale: 1.5, full: screen), CGRect(x: 100 + 3 / 1.5, y: 100, width: 400, height: 300))
        XCTAssertEqual(OverlayGeometry.nudge(sel, dx: -1000, dy: 0, scale: 1, full: screen), CGRect(x: 0, y: 100, width: 400, height: 300))
        XCTAssertEqual(OverlayGeometry.nudge(sel, dx: 0, dy: 5000, scale: 1, full: screen), CGRect(x: 100, y: 780, width: 400, height: 300))
    }

    func testToolbarIsRightAlignedBelowTheSelectionGoesAboveIfThereIsNoRoomBelowAndInsideTheBottomIfNeitherFits() {
        let bar = CGSize(width: 300, height: 36)
        var at = OverlayGeometry.toolbarAt(sel, toolbar: bar, subbar: .zero, full: screen).toolbar
        XCTAssertEqual(at, CGPoint(x: 200, y: 408))
        // Selection touching the bottom of the screen: placed above
        at = OverlayGeometry.toolbarAt(CGRect(x: 100, y: 700, width: 400, height: 370), toolbar: bar, subbar: .zero, full: screen).toolbar
        XCTAssertEqual(at, CGPoint(x: 200, y: 656))
        // Selection fills the whole screen: placed inside it, at the bottom
        at = OverlayGeometry.toolbarAt(screen, toolbar: bar, subbar: .zero, full: screen).toolbar
        XCTAssertEqual(at, CGPoint(x: 1616, y: 1036))
        // Narrow selection at the left: the toolbar does not leave the left edge of the screen
        at = OverlayGeometry.toolbarAt(CGRect(x: 0, y: 100, width: 50, height: 50), toolbar: bar, subbar: .zero, full: screen).toolbar
        XCTAssertEqual(at.x, 4)
    }

    func testSubToolbarGoesOnTheOuterSideOfTheToolbarBelowWhenItIsBelowAndAboveWhenItIsAbove() {
        let bar = CGSize(width: 300, height: 36)
        let sub = CGSize(width: 200, height: 30)
        var placed = OverlayGeometry.toolbarAt(sel, toolbar: bar, subbar: sub, full: screen)
        XCTAssertEqual(placed.subbar, CGPoint(x: 200, y: 408 + 36 + 6))
        placed = OverlayGeometry.toolbarAt(CGRect(x: 100, y: 700, width: 400, height: 370), toolbar: bar, subbar: sub, full: screen)
        XCTAssertEqual(placed.toolbar.y, 700 - 8 - 36)
        XCTAssertEqual(placed.subbar, CGPoint(x: 200, y: placed.toolbar.y - 6 - 30))
    }

    func testNoteBoxGoesRightFirstThenLeftThenBelowAndIsAlwaysKeptOnScreen() {
        let box = CGSize(width: 320, height: 160)
        XCTAssertEqual(OverlayGeometry.noteAt(sel, size: box, full: screen), CGPoint(x: 508, y: 100))
        // Near the right edge: placed on the left
        XCTAssertEqual(
            OverlayGeometry.noteAt(CGRect(x: 1500, y: 100, width: 400, height: 300), size: box, full: screen), CGPoint(x: 1500 - 8 - 320, y: 100))
        // No room on either side (full width): placed below
        XCTAssertEqual(
            OverlayGeometry.noteAt(CGRect(x: 0, y: 100, width: 1920, height: 300), size: box, full: screen), CGPoint(x: 8, y: 408))
        // No room below either: placed above
        XCTAssertEqual(
            OverlayGeometry.noteAt(CGRect(x: 0, y: 700, width: 1920, height: 300), size: box, full: screen), CGPoint(x: 8, y: 700 - 8 - 160))
        // At the top: does not leave the top edge of the screen
        XCTAssertEqual(OverlayGeometry.noteAt(CGRect(x: 0, y: 0, width: 1920, height: 1080), size: box, full: screen).y, 8)
    }

    func testShiftDrawnSquaresStayInsideTheSelection() {
        // With the start near the selection edge the opposite corner would land outside it,
        // and the width × height handed to the AI would exceed the image
        let sel = CGRect(x: 0, y: 0, width: 400, height: 300)
        let o = CGPoint(x: 350, y: 100)
        // Dragging down-right: only 50 is left on the right, so the square's side is 50
        XCTAssertEqual(OverlayGeometry.squareCorner(o, CGPoint(x: 390, y: 260), sel: sel), CGPoint(x: 400, y: 150))
        // Dragging down-left: there is room on the left, the side is the longer of the two (160), and 200 is left below
        XCTAssertEqual(OverlayGeometry.squareCorner(o, CGPoint(x: 300, y: 260), sel: sel), CGPoint(x: 190, y: 260))
        // Dragging up-left: only 100 is left above
        XCTAssertEqual(OverlayGeometry.squareCorner(o, CGPoint(x: 100, y: 80), sel: sel), CGPoint(x: 250, y: 0))
    }
}
