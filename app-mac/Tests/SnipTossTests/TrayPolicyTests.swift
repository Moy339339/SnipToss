import XCTest

@testable import SnipToss

/// What closing the last window does with "keep running in the menu bar" on and off, and the menu bar item's menu
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

    // MARK: The menu

    /// Without the permission Capture Screen says under it that the screen must be allowed first, and stays enabled (choosing it leads to
    /// the permission). Each time the menu opens the permission is read again
    func testCaptureScreenSaysWhenTheScreenMayNotBeRecordedYet() throws {
        guard #available(macOS 14.4, *) else { throw XCTSkip("menu item subtitles came with macOS 14.4") }
        var needs = true
        let controller = StatusItemController(showWindow: {}, openSettings: {}, quit: {}, needsAccess: { needs })
        let menu = controller.makeMenu()
        let capture = try XCTUnwrap(menu.items.first)
        XCTAssertEqual(capture.title, ShellText.t("shell.tray.capture"))
        XCTAssertEqual(capture.subtitle, ShellText.t("shell.tray.needsAccess"))
        XCTAssertTrue(capture.isEnabled)

        needs = false
        controller.menuNeedsUpdate(menu)
        XCTAssertNil(capture.subtitle)
        XCTAssertEqual(capture.title, ShellText.t("shell.tray.capture"))
        needs = true
        controller.menuNeedsUpdate(menu)
        XCTAssertEqual(capture.subtitle, ShellText.t("shell.tray.needsAccess"))
        XCTAssertEqual(menu.items.count, 5, "nothing is added: the note is part of Capture Screen")
    }

    func testBeforeSubtitlesTheNoteGoesAfterTheTitleInTheBracketsOfTheLanguage() {
        XCTAssertEqual(CaptureMenuText.titleWithNote("Capture Screen", "Allow it first", language: "en"), "Capture Screen (Allow it first)")
        XCTAssertEqual(CaptureMenuText.titleWithNote("Capture Screen", "Allow it first", language: "de"), "Capture Screen (Allow it first)")
        for language in ["zh-CN", "zh-TW", "ja"] {
            XCTAssertEqual(CaptureMenuText.titleWithNote("A", "B", language: language), "A（B）", language)
        }
    }
}
