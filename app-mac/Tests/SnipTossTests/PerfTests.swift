import XCTest

@testable import SnipToss

/// The performance budget's starting point: when this process started, as the kernel recorded it
final class PerfTests: XCTestCase {
    func testTheProcessStartIsKnownAndInThePast() throws {
        let start = try XCTUnwrap(Perf.processStart)
        XCTAssertLessThanOrEqual(start.timeIntervalSinceNow, 0)
        // A test run is not hours old
        XCTAssertGreaterThan(start.timeIntervalSinceNow, -3 * 3600)
    }
}
