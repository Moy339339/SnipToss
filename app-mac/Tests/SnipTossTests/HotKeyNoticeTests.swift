import AppKit
import XCTest

@testable import SnipToss

final class HotKeyNoticeTests: SnipTestCase {
    private let t0 = Date(timeIntervalSince1970: 1_000_000)

    // MARK: How long it stays

    func testItCountsDownEightSecondsFromWhenItIsShown() {
        var c = NoticeCountdown(total: HotKeyNotice.showsFor)
        XCTAssertEqual(HotKeyNotice.showsFor, 8)
        c.count(from: t0)
        XCTAssertEqual(c.remaining(at: t0), 8)
        XCTAssertEqual(c.remaining(at: t0 + 3), 5, accuracy: 1e-9)
        XCTAssertEqual(c.remaining(at: t0 + 20), 0, "never below zero")
    }

    func testWhileThePointerIsOnItTheTimeStandsStillAndGoesOnFromThereWhenItLeaves() {
        var c = NoticeCountdown(total: 8)
        c.count(from: t0)
        c.hold(at: t0 + 3)
        XCTAssertFalse(c.isCounting)
        XCTAssertEqual(c.remaining(at: t0 + 60), 5, accuracy: 1e-9, "a minute of reading costs nothing")
        c.count(from: t0 + 60)
        XCTAssertEqual(c.remaining(at: t0 + 62), 3, accuracy: 1e-9)
        // Holding twice or counting twice changes nothing
        c.hold(at: t0 + 63)
        c.hold(at: t0 + 70)
        XCTAssertEqual(c.remaining(at: t0 + 80), 2, accuracy: 1e-9)
        c.count(from: t0 + 80)
        c.count(from: t0 + 81)
        XCTAssertEqual(c.remaining(at: t0 + 82), 0, accuracy: 1e-9)
    }

    // MARK: Where it is

    /// The top right of the screen's area below the menu bar, 16 from the right edge and 12 from the top (AppKit's coordinates: y up)
    func testItSitsAtTheTopRightBelowTheMenuBarWhereTheSystemsNotificationsAre() {
        let area = CGRect(x: 0, y: 0, width: 1512, height: 949)
        let at = HotKeyNotice.place(CGSize(width: 360, height: 84), in: area)
        XCTAssertEqual(at, CGPoint(x: 1512 - 16 - 360, y: 949 - 12 - 84))
        // A second screen to the left of the first has negative x; a screen narrower than the card keeps it at its left edge
        XCTAssertEqual(HotKeyNotice.place(CGSize(width: 360, height: 84), in: CGRect(x: -1920, y: 0, width: 1920, height: 1050)).x, -16 - 360)
        XCTAssertEqual(HotKeyNotice.place(CGSize(width: 360, height: 84), in: CGRect(x: 100, y: 0, width: 300, height: 600)).x, 100)
    }

    // MARK: The card

    func testTheCardHasTheTitleTheReasonWithWhatAClickDoesAndAClose() {
        let card = HotKeyNotice.Card(title: "Title", body: "Why. Click here to open Settings.", open: {}, close: {}, hover: { _ in })
        XCTAssertEqual(card.frame.width, 360)
        let texts = card.subviews.compactMap { ($0 as? OverlayText)?.text }
        XCTAssertEqual(texts.count, 2)
        XCTAssertEqual(card.closeButton.name, ShellText.t("app.toast.close"))
        XCTAssertNotEqual(card.closeButton.name, "app.toast.close", "the built-in English is there without the resources")
        // The × is at the top right, inside the card
        XCTAssertGreaterThan(card.closeButton.frame.minX, card.frame.width / 2)
        XCTAssertLessThanOrEqual(card.closeButton.frame.maxX, card.frame.width)
        // A longer reason wraps and the card grows
        let long = HotKeyNotice.Card(title: "Title", body: String(repeating: "A longer reason. ", count: 12), open: {}, close: {}, hover: { _ in })
        XCTAssertGreaterThan(long.frame.height, card.frame.height)
    }

    /// Wrapped as one paragraph the second sentence would break wherever the reason ends ("…单击此处打开 / 设置。")
    func testWhatAClickDoesGoesOnALineOfItsOwnAfterTheReasonAndItsFullStop() throws {
        defer { ShellLocale.reset() }
        _ = ShellLocale.use(pref: "en", system: "en-US")
        XCTAssertEqual(
            HotKeyNotice.body(reason: "⌃⌥⌘A is already used by another app. Choose a different shortcut"),
            "⌃⌥⌘A is already used by another app. Choose a different shortcut.\nClick here to open Settings.")
        guard AppResources.directory() != nil else { throw XCTSkip("the catalogs are not built") }
        _ = ShellLocale.use(pref: "zh-CN", system: "en-US")
        XCTAssertEqual(HotKeyNotice.body(reason: "⌃⌥⌘A 已被其他程序占用，请更换快捷键"), "⌃⌥⌘A 已被其他程序占用，请更换快捷键。\n单击此处打开设置。")
        _ = ShellLocale.use(pref: "ko", system: "en-US")
        XCTAssertEqual(HotKeyNotice.body(reason: "R"), "R.\n여기를 클릭하면 설정이 열립니다.")
    }

    func testPressingTheCardOpensAndItsCloseOnlyCloses() {
        var opened = 0
        var closed = 0
        let card = HotKeyNotice.Card(title: "T", body: "B", open: { opened += 1 }, close: { closed += 1 }, hover: { _ in })
        card.closeButton.click()
        XCTAssertEqual([opened, closed], [0, 1])
        XCTAssertTrue(card.accessibilityPerformPress())
        XCTAssertEqual([opened, closed], [1, 1])
    }

    // MARK: Opening Settings

    func testASectionAskedForBeforeThePageIsReadyWaitsForItAndOnlyTheLastOneWaits() {
        var sent: [String] = []
        let opener = SettingsOpener(emit: { event, payload in sent.append("\(event):\(payload["section"] as? String ?? "")") })
        opener.open("general")
        opener.open("capture")
        XCTAssertEqual(sent, [])
        opener.pageReady()
        XCTAssertEqual(sent, ["openSettings:capture"])
        opener.pageReady()
        XCTAssertEqual(sent.count, 1, "sent once")
        opener.open("about")
        XCTAssertEqual(sent.last, "openSettings:about", "a ready page is told at once")
    }

    func testAReloadingPageWaitsAgain() {
        var sent: [String] = []
        let opener = SettingsOpener(emit: { _, payload in sent.append(payload["section"] as? String ?? "") })
        opener.pageReady()
        opener.pageReloading()
        opener.open("capture")
        XCTAssertEqual(sent, [])
        opener.pageReady()
        XCTAssertEqual(sent, ["capture"])
    }

    // MARK: The menu bar item's menu

    func testCaptureScreenSaysWhenTheShortcutCouldNotBeEnabledAndThePermissionComesFirst() throws {
        guard #available(macOS 14.4, *) else { throw XCTSkip("menu item subtitles came with macOS 14.4") }
        var failed = true
        var needs = false
        let controller = StatusItemController(showWindow: {}, openSettings: {}, quit: {}, needsAccess: { needs }, hotkeyFailed: { failed })
        let menu = controller.makeMenu()
        let capture = try XCTUnwrap(menu.items.first)
        XCTAssertEqual(capture.subtitle, ShellText.t("shell.tray.hotkeyFailed"))
        XCTAssertTrue(capture.isEnabled, "Capture Screen from the menu works without the shortcut")
        needs = true
        controller.menuNeedsUpdate(menu)
        XCTAssertEqual(capture.subtitle, ShellText.t("shell.tray.needsAccess"))
        needs = false
        failed = false
        controller.menuNeedsUpdate(menu)
        XCTAssertNil(capture.subtitle)
    }
}
