import XCTest

@testable import SnipToss

/// `appInfo.built`, the program's build time (LibraryMethods.swift): kept in the contract, though the UI no longer shows it. It used to
/// be always empty on the Mac
final class AppInfoTests: SnipTestCase {
    func testTheBuildTimeIsWhenTheExecutableWasLastWrittenInUTC() throws {
        let built = shellBuildTime()
        XCTAssertTrue(built.hasSuffix("Z"), built)
        let format = ISO8601DateFormatter()
        format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let parsed = try XCTUnwrap(format.date(from: built), built)
        let path = try XCTUnwrap(Bundle.main.executablePath)
        let written = try XCTUnwrap(try FileManager.default.attributesOfItem(atPath: path)[.modificationDate] as? Date)
        XCTAssertEqual(parsed.timeIntervalSince1970, written.timeIntervalSince1970, accuracy: 0.001)
    }
}
