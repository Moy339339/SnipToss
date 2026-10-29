import XCTest

@testable import SnipToss

/// What closing the last window does with "keep running in the menu bar" on and off
final class TrayPolicyTests: XCTestCase {
    func testWithKeepInTrayOnClosingTheLastWindowDoesNotQuit() {
        XCTAssertFalse(TrayPolicy.quitsWhenLastWindowCloses(keepInTray: true))
    }

    func testWithKeepInTrayOffClosingTheLastWindowQuits() {
        XCTAssertTrue(TrayPolicy.quitsWhenLastWindowCloses(keepInTray: false))
    }

    func testTheMenuBarItemIsThereExactlyWhenTheAppCanRunWithoutAWindow() {
        XCTAssertTrue(TrayPolicy.showsStatusItem(keepInTray: true))
        XCTAssertFalse(TrayPolicy.showsStatusItem(keepInTray: false))
    }

    func testTheDefaultKeepsTheAppRunning() {
        // A fresh install keeps the app in the menu bar, as the Windows shell keeps it in the tray
        XCTAssertFalse(TrayPolicy.quitsWhenLastWindowCloses(keepInTray: CaptureSettings().keepInTray))
    }
}
