import XCTest

@testable import SnipToss

final class AppLocationTests: SnipTestCase {
    private let writable: (String) -> Bool = { _ in false }
    private let readOnly: (String) -> Bool = { _ in true }

    func testARandomCopyTheSystemMadeIsTranslocated() {
        let path = "/private/var/folders/n1/abc/T/AppTranslocation/0F1E2D3C-4B5A-6978-8796-A5B4C3D2E1F0/d/SnipToss.app"
        XCTAssertEqual(AppLocation.problem(bundlePath: path, isReadOnlyVolume: writable), .translocated)
    }

    func testStraightFromADiskImageIsADiskImage() {
        XCTAssertEqual(AppLocation.problem(bundlePath: "/Volumes/SnipToss 1.1.0/SnipToss.app", isReadOnlyVolume: readOnly), .diskImage)
        // A writable volume (an external drive the user keeps apps on) is the user's choice
        XCTAssertNil(AppLocation.problem(bundlePath: "/Volumes/Work/Apps/SnipToss.app", isReadOnlyVolume: writable))
    }

    func testApplicationsTheUsersOwnFoldersAndDevelopmentBuildsAreFine() {
        for path in ["/Applications/SnipToss.app", "/Users/someone/Applications/SnipToss.app", "/Users/someone/Downloads/SnipToss.app"] {
            XCTAssertNil(AppLocation.problem(bundlePath: path, isReadOnlyVolume: readOnly), path)
        }
        // `swift run` / the smoke runs: the executable is not in a bundle
        XCTAssertNil(AppLocation.problem(bundlePath: "/Users/someone/work/app-mac/.build/release", isReadOnlyVolume: readOnly))
    }

    /// The system's lookup is there on every macOS the app runs on; for an app that is not translocated it answers with the same path, or
    /// nothing
    func testTheOriginalOfAnAppThatIsNotTranslocatedIsItself() {
        let path = "/System/Applications/Calculator.app"
        if let original = AppLocation.originalPath(of: path) { XCTAssertEqual(original, path) }
    }
}
