import XCTest

@testable import SnipToss

/// The rectangle rules the overlay relies on, in the places where CGRect behaves differently
final class RectMathTests: XCTestCase {
    func testAllFourEdgesCountAsInside() {
        let r = CGRect(x: 10, y: 20, width: 100, height: 50)
        XCTAssertTrue(r.wpfContains(CGPoint(x: 10, y: 20)))
        XCTAssertTrue(r.wpfContains(CGPoint(x: 110, y: 70)))
        XCTAssertTrue(r.wpfContains(CGPoint(x: 110, y: 20)))
        XCTAssertTrue(r.wpfContains(CGPoint(x: 10, y: 70)))
        XCTAssertFalse(r.wpfContains(CGPoint(x: 110.001, y: 70)))
        XCTAssertFalse(r.wpfContains(CGPoint(x: 9.999, y: 20)))
        // CGRect leaves the right and bottom edges out
        XCTAssertFalse(r.contains(CGPoint(x: 110, y: 70)))
    }

    func testTheEmptyRectangleHasNoPlaceNoEdgesAndHoldsNothing() {
        let empty = WPFRect.empty
        XCTAssertTrue(empty.wpfIsEmpty)
        XCTAssertFalse(empty.wpfContains(.zero))
        XCTAssertEqual(empty.wpfRight, -CGFloat.infinity)
        XCTAssertEqual(empty.wpfBottom, -CGFloat.infinity)
        XCTAssertEqual(empty.wpfWidth, -CGFloat.infinity)
        // A zero-size rectangle is a rectangle: it holds its own point
        let dot = CGRect(x: 5, y: 5, width: 0, height: 0)
        XCTAssertFalse(dot.wpfIsEmpty)
        XCTAssertTrue(dot.wpfContains(CGPoint(x: 5, y: 5)))
        XCTAssertFalse(dot.wpfContains(CGPoint(x: 5, y: 6)))
    }

    func testARectangleBuiltFromTwoCornersDoesNotCareWhichWayRoundTheyAreGiven() {
        XCTAssertEqual(WPFRect.spanning(CGPoint(x: 10, y: 20), CGPoint(x: 4, y: 2)), CGRect(x: 4, y: 2, width: 6, height: 18))
        XCTAssertEqual(WPFRect.spanning(CGPoint(x: 4, y: 20), CGPoint(x: 10, y: 2)), CGRect(x: 4, y: 2, width: 6, height: 18))
        XCTAssertEqual(WPFRect.spanning(CGPoint(x: 3, y: 3), CGPoint(x: 3, y: 3)), CGRect(x: 3, y: 3, width: 0, height: 0))
    }

    func testUnionLeavesTheEmptyRectangleOut() {
        let r = CGRect(x: 10, y: 10, width: 20, height: 20)
        XCTAssertEqual(WPFRect.empty.wpfUnion(r), r)
        XCTAssertEqual(r.wpfUnion(WPFRect.empty), r)
        XCTAssertEqual(r.wpfUnion(CGRect(x: 0, y: 5, width: 12, height: 3)), CGRect(x: 0, y: 5, width: 30, height: 25))
        XCTAssertTrue(WPFRect.empty.wpfUnion(WPFRect.empty).wpfIsEmpty)
    }

    func testUnionWithPointsGrowsToTheirBoundingBox() {
        var box = WPFRect.spanning(CGPoint(x: 5, y: 5), CGPoint(x: 5, y: 5))
        for p in [CGPoint(x: 5, y: 5), CGPoint(x: 1, y: 9), CGPoint(x: 8, y: 2)] { box = box.wpfUnion(p) }
        XCTAssertEqual(box, CGRect(x: 1, y: 2, width: 7, height: 7))
    }

    func testInflatingBelowZeroSizeGivesTheEmptyRectangle() {
        let r = CGRect(x: 100, y: 100, width: 6, height: 6)
        XCTAssertEqual(r.wpfInflated(by: 2, 2), CGRect(x: 98, y: 98, width: 10, height: 10))
        // Exactly zero is still a rectangle
        XCTAssertEqual(r.wpfInflated(by: -3, -3), CGRect(x: 103, y: 103, width: 0, height: 0))
        XCTAssertTrue(r.wpfInflated(by: -3.5, -3.5).wpfIsEmpty)
        // One side going negative is enough
        XCTAssertTrue(r.wpfInflated(by: -4, 1).wpfIsEmpty)
        XCTAssertTrue(WPFRect.empty.wpfInflated(by: 5, 5).wpfIsEmpty)
    }

    func testRectanglesThatOnlyTouchOverlap() {
        let a = CGRect(x: 0, y: 0, width: 10, height: 10)
        let touching = CGRect(x: 10, y: 0, width: 10, height: 10)
        let apart = CGRect(x: 11, y: 0, width: 10, height: 10)
        XCTAssertTrue(a.wpfIntersects(touching))
        XCTAssertEqual(a.wpfIntersect(touching), CGRect(x: 10, y: 0, width: 0, height: 10))
        XCTAssertFalse(a.wpfIntersects(apart))
        XCTAssertTrue(a.wpfIntersect(apart).wpfIsEmpty)
        XCTAssertFalse(a.wpfIntersects(WPFRect.empty))
        XCTAssertEqual(a.wpfIntersect(CGRect(x: 4, y: 6, width: 20, height: 20)), CGRect(x: 4, y: 6, width: 6, height: 4))
    }

    func testVectorsMeasureTheWayTheOverlayNeeds() {
        let a = CGPoint(x: 1, y: 2)
        let b = CGPoint(x: 4, y: 6)
        XCTAssertEqual(b.wpfVector(from: a).dx, 3)
        XCTAssertEqual(b.wpfVector(from: a).dy, 4)
        XCTAssertEqual(b.wpfDistance(to: a), 5)
        XCTAssertEqual(a.wpfDistance(to: b), 5)
        XCTAssertEqual(CGVector(dx: 3, dy: 4).wpfLengthSquared, 25)
        XCTAssertEqual(CGVector(dx: 1, dy: 2).wpfDot(CGVector(dx: 3, dy: 4)), 11)
        XCTAssertEqual(a.wpfOffset(by: CGVector(dx: 3, dy: 4).wpfScaled(by: 2)), CGPoint(x: 7, y: 10))
    }

    func testClampValueKeepsAValueBetweenTheLimitsAndNeverTraps() {
        XCTAssertEqual(clampValue(5, 0, 10), 5)
        XCTAssertEqual(clampValue(-1, 0, 10), 0)
        XCTAssertEqual(clampValue(11, 0, 10), 10)
        // Limits the wrong way round: no failure
        XCTAssertEqual(clampValue(5, 8, 2), 8)
    }
}
