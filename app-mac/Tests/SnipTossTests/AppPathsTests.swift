import XCTest

@testable import SnipToss

/// Where the app keeps its own files
final class AppPathsTests: XCTestCase {
    func testStandardLayoutSettingsAndDataUnderApplicationSupportLogsUnderLogs() {
        let layout = AppPaths.resolve(customSettings: nil, home: "/Users/u")
        XCTAssertEqual(
            layout,
            AppPaths.Layout(
                settingsFile: "/Users/u/Library/Application Support/SnipToss/settings.json",
                localDir: "/Users/u/Library/Application Support/SnipToss", logDir: "/Users/u/Library/Logs/SnipToss", testInstance: false))
    }

    func testATestInstanceKeepsEverythingNextToItsSettingsFile() {
        let layout = AppPaths.resolve(customSettings: "/tmp/t1/settings.json", home: "/Users/u")
        XCTAssertEqual(
            layout, AppPaths.Layout(settingsFile: "/tmp/t1/settings.json", localDir: "/tmp/t1", logDir: "/tmp/t1/logs", testInstance: true))
    }

    func testAnEmptySettingsVariableIsNotATestInstance() {
        XCTAssertFalse(AppPaths.resolve(customSettings: "", home: "/Users/u").testInstance)
        XCTAssertFalse(AppPaths.resolve(customSettings: nil, home: "/Users/u").testInstance)
    }

    func testARelativeSettingsPathIsMadeAbsolute() {
        let layout = AppPaths.resolve(customSettings: "x/../t/settings.json", home: "/Users/u")
        XCTAssertTrue(layout.settingsFile.hasPrefix("/"))
        XCTAssertTrue(layout.settingsFile.hasSuffix("/t/settings.json"))
        XCTAssertFalse(layout.settingsFile.contains(".."))
        XCTAssertEqual(layout.localDir + "/settings.json", layout.settingsFile)
    }

    func testPastedImagesGoNextToTheSettingsFile() {
        XCTAssertEqual(AppPaths.pastedDir, AppPaths.localDir + "/Pasted Images")
    }
}
