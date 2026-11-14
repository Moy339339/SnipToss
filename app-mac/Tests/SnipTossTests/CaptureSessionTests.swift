import AppKit
import XCTest

@testable import SnipToss

/// The start of a capture: where the pictures come from, what happens without the permission to record the screen, and that the one
/// waiting for the capture always hears that it is over. The layers themselves are opened in the capture smoke run (mac.yml), not here
final class CaptureSessionTests: SnipTestCase {
    private final class FakeSource: ScreenSource {
        let result: Result<[FrozenScreen], ScreenCaptureFailure>
        let calls = Counter()

        init(_ result: Result<[FrozenScreen], ScreenCaptureFailure>) { self.result = result }

        func capture() async throws -> [FrozenScreen] {
            calls.increment()
            return try result.get()
        }
    }

    /// Allowed unless a test says otherwise
    private final class FakeAccess: ScreenAccess {
        var allowed = true
        var requests = 0
        var settingsOpened = 0
        func request() { requests += 1 }
        func openSettings() { settingsOpened += 1 }
    }

    /// Shows nothing; records which of the two it would show, and goes on (Continue / Open System Settings) when `choose` is set
    private final class FakeGuide: PermissionGuiding {
        var shown: [Bool] = []
        var choose = false
        func show(firstTime: Bool, proceed: @escaping () -> Void) {
            shown.append(firstTime)
            if choose { proceed() }
        }
    }

    private var defaultsName = ""
    private var defaults: UserDefaults!

    override func setUp() {
        super.setUp()
        defaultsName = "SnipTossTests-" + UUID().uuidString
        defaults = UserDefaults(suiteName: defaultsName)
    }

    override func tearDown() {
        defaults.removePersistentDomain(forName: defaultsName)
        super.tearDown()
    }

    /// Starts a capture and waits until it says it is over
    private func startAndWait(_ session: CaptureSession, _ name: String) {
        let over = expectation(description: name)
        session.start(whenClosed: { over.fulfill() })
        wait(for: [over], timeout: 5)
    }

    // MARK: The pattern

    func testThePatternHasOnePictureAScreenAtTheScreensResolution() async throws {
        let source = PatternScreenSource(screens: [
            .init(displayID: 1, frame: CGRect(x: 0, y: 0, width: 40, height: 30), scale: 2),
            .init(displayID: 2, frame: CGRect(x: 40, y: -10, width: 25, height: 20), scale: 1),
        ])
        let screens = try await source.capture()
        XCTAssertEqual(screens.map(\.displayID), [1, 2])
        XCTAssertEqual(screens.map { [$0.image.width, $0.image.height] }, [[80, 60], [25, 20]])
        XCTAssertEqual(screens[1].frame, CGRect(x: 40, y: -10, width: 25, height: 20))
        XCTAssertEqual(screens.map(\.scale), [2, 1])
    }

    func testEachPixelOfThePatternIsMadeOfItsPlace() throws {
        let image = PatternScreenSource.image(width: 300, height: 260)
        let data = try XCTUnwrap(image.dataProvider?.data) as Data
        // The first row of the picture is the top of the screen
        for (x, y) in [(0, 0), (299, 0), (0, 259), (123, 45), (250, 245)] {
            let offset = y * image.bytesPerRow + x * 4
            let want = PatternScreenSource.color(x: x, y: y)
            XCTAssertEqual([data[offset], data[offset + 1], data[offset + 2], data[offset + 3]], [want.red, want.green, want.blue, 255], "\(x), \(y)")
        }
        // Neighbours differ along both axes, so a picture drawn flipped or shifted does not match
        XCTAssertNotEqual(PatternScreenSource.color(x: 10, y: 10).green, PatternScreenSource.color(x: 10, y: 11).green)
        XCTAssertNotEqual(PatternScreenSource.color(x: 10, y: 10).red, PatternScreenSource.color(x: 11, y: 10).red)
    }

    func testAPatternWithoutScreensIsNoScreens() async {
        do {
            _ = try await PatternScreenSource(screens: []).capture()
            XCTFail("expected noScreens")
        } catch {
            XCTAssertEqual(error as? ScreenCaptureFailure, .noScreens)
        }
    }

    // MARK: The permission

    /// Never asked: our window says why first, and the system is asked only after Continue. Not Now leaves everything as it was. Asked
    /// before: the same window leads to System Settings. No picture is taken without the permission
    func testWithoutThePermissionOurWindowComesFirstAndTheSystemIsAskedOnlyAfterContinue() {
        let access = FakeAccess()
        access.allowed = false
        let guide = FakeGuide()
        let source = FakeSource(.success([]))
        let session = CaptureSession(source: source, access: access, guide: guide, defaults: defaults)

        startAndWait(session, "not now")
        XCTAssertEqual(guide.shown, [true])
        XCTAssertEqual([access.requests, access.settingsOpened], [0, 0])
        XCTAssertFalse(ScreenAccessAsk.asked(defaults), "Not Now asks nothing, so the next capture explains again")
        XCTAssertFalse(session.isOpen)

        guide.choose = true
        startAndWait(session, "continue")
        XCTAssertEqual(guide.shown, [true, true])
        XCTAssertEqual([access.requests, access.settingsOpened], [1, 0])
        XCTAssertTrue(ScreenAccessAsk.asked(defaults))

        // The system shows its own question once only: from now on the window leads to System Settings
        startAndWait(session, "asked before")
        XCTAssertEqual(guide.shown, [true, true, false])
        XCTAssertEqual([access.requests, access.settingsOpened], [1, 1])
        XCTAssertEqual(session.overlayPanels.count, 0)
        XCTAssertEqual(source.calls.value, 0)
    }

    func testWhetherTheSystemWasAskedIsKeptAcrossLaunches() {
        let first = FakeAccess()
        first.allowed = false
        let firstGuide = FakeGuide()
        firstGuide.choose = true
        startAndWait(CaptureSession(source: FakeSource(.success([])), access: first, guide: firstGuide, defaults: defaults), "first launch")
        let second = FakeAccess()
        second.allowed = false
        let guide = FakeGuide()
        startAndWait(CaptureSession(source: FakeSource(.success([])), access: second, guide: guide, defaults: defaults), "second launch")
        XCTAssertEqual([first.requests, second.requests], [1, 0])
        XCTAssertEqual(firstGuide.shown + guide.shown, [true, false])
    }

    /// The check said yes, but taking the picture was refused (the permission was taken away in between): the same as no permission
    func testAPictureRefusedForLackOfPermissionIsTreatedAsNoPermission() {
        let access = FakeAccess()
        let guide = FakeGuide()
        guide.choose = true
        let session = CaptureSession(source: FakeSource(.failure(.noAccess)), access: access, guide: guide, defaults: defaults)
        startAndWait(session, "first")
        startAndWait(session, "second")
        XCTAssertEqual(guide.shown, [true, false])
        XCTAssertEqual([access.requests, access.settingsOpened], [1, 1])
    }

    /// The button in Settings → Screen Capture: only an app that has asked is in the list of System Settings, so the first press asks the
    /// system; System Settings opens from then on
    func testTheSettingsButtonAsksTheSystemTheFirstTimeAndOpensSystemSettingsAfterwards() {
        let access = FakeAccess()
        access.allowed = false
        ScreenAccessAsk.lead(access, defaults: defaults)
        XCTAssertEqual([access.requests, access.settingsOpened], [1, 0])
        ScreenAccessAsk.lead(access, defaults: defaults)
        ScreenAccessAsk.lead(access, defaults: defaults)
        XCTAssertEqual([access.requests, access.settingsOpened], [1, 2])
    }

    /// The system asks once only, whoever asked it: after the Settings button asked, a capture's window leads to System Settings; after a
    /// capture asked, the button opens System Settings
    func testTheSettingsButtonAndTheCaptureShareWhetherTheSystemWasAsked() {
        let access = FakeAccess()
        access.allowed = false
        let guide = FakeGuide()
        guide.choose = true
        ScreenAccessAsk.lead(access, defaults: defaults)
        startAndWait(CaptureSession(source: FakeSource(.success([])), access: access, guide: guide, defaults: defaults), "after a button")
        XCTAssertEqual(guide.shown, [false])
        XCTAssertEqual([access.requests, access.settingsOpened], [1, 1])

        let otherName = "SnipTossTests-" + UUID().uuidString
        let other = UserDefaults(suiteName: otherName)!
        defer { other.removePersistentDomain(forName: otherName) }
        let fresh = FakeAccess()
        fresh.allowed = false
        let goOn = FakeGuide()
        goOn.choose = true
        startAndWait(CaptureSession(source: FakeSource(.success([])), access: fresh, guide: goOn, defaults: other), "a capture first")
        ScreenAccessAsk.lead(fresh, defaults: other)
        XCTAssertEqual([fresh.requests, fresh.settingsOpened], [1, 1])
    }

    /// The window's words: why, and Continue, the first time; where to allow it and the off-and-on-again line, with Open System Settings,
    /// afterwards. The same title both times
    func testTheWindowSaysWhyTheFirstTimeAndWhereToAllowItAfterwards() {
        let first = PermissionGuide.content(firstTime: true)
        let later = PermissionGuide.content(firstTime: false)
        XCTAssertEqual(first.title, later.title)
        XCTAssertEqual(first.button, ShellText.t("shell.capture.continue"))
        XCTAssertEqual(later.button, ShellText.t("shell.capture.openSettings"))
        let app = ["app": ShellText.t("brand.name")]
        XCTAssertEqual(first.body, ShellText.t("shell.capture.askBody", app))
        XCTAssertEqual(
            later.body, ShellText.t("shell.capture.noAccessBody", app) + "\n\n" + ShellText.t("shell.capture.noAccessToggle", app))
        for text in [first.title, first.body, first.button, later.body] {
            XCTAssertFalse(text.hasPrefix("shell."), text)
            XCTAssertFalse(text.contains("{"), text)
        }
    }

    /// The window that asks comes up instead of the layers: the session says whether the system lets it take pictures now
    func testTheSessionSaysWhetherItMayTakePictures() {
        let access = FakeAccess()
        let session = CaptureSession(source: FakeSource(.success([])), access: access, guide: FakeGuide(), defaults: defaults)
        XCTAssertTrue(session.screenAllowed)
        access.allowed = false
        XCTAssertFalse(session.screenAllowed)
    }

    // MARK: Dialogs of the system

    /// The question about recording the screen comes up while the layers are open: they step just below it, stay there while it is up,
    /// and come back once it has gone; nothing happens while there is none
    func testTheLayersStepBelowADialogOfTheSystemAndComeBackOnceItHasGone() {
        var watch = DialogWatch()
        XCTAssertEqual(watch.see(nil), .none)
        XCTAssertEqual(watch.see(8), .below(7))
        XCTAssertEqual(watch.under, 7)
        XCTAssertEqual(watch.see(8), .none, "still up: nothing more to do")
        XCTAssertEqual(watch.see(20), .below(19), "a higher one: below that")
        XCTAssertEqual(watch.see(nil), .back)
        XCTAssertNil(watch.under)
        XCTAssertEqual(watch.see(nil), .none)
    }

    /// Only the system's own dialogs count: the process that asks, by its name
    func testTheDialogsAreTheOnesOfTheProcessThatAsks() {
        XCTAssertEqual(SystemDialogWindows.owners, ["UserNotificationCenter"])
    }

    // MARK: Failures and repeats

    func testAFailedCaptureEndsWithoutAskingForThePermission() {
        for failure in [ScreenCaptureFailure.failed("the display went away"), .noScreens] {
            let access = FakeAccess()
            let guide = FakeGuide()
            let session = CaptureSession(source: FakeSource(.failure(failure)), access: access, guide: guide, defaults: defaults)
            startAndWait(session, "\(failure)")
            XCTAssertEqual(access.requests, 0, "\(failure)")
            XCTAssertEqual(guide.shown, [], "\(failure)")
            XCTAssertFalse(session.isOpen)
            // The timing smoke run reads why it did not open, and there is no opening time
            XCTAssertNotNil(session.lastFailure, "\(failure)")
            XCTAssertNil(session.lastOpening, "\(failure)")
        }
    }

    func testStartingAgainWhileTheFirstStartIsUnderWayTakesThePicturesOnce() {
        let source = FakeSource(.failure(.failed("no pictures")))
        let session = CaptureSession(source: source, access: FakeAccess(), guide: FakeGuide(), defaults: defaults)
        let first = expectation(description: "first")
        let second = expectation(description: "second")
        session.start(whenClosed: { first.fulfill() })
        session.start(whenClosed: { second.fulfill() })
        wait(for: [first, second], timeout: 5)
        XCTAssertEqual(source.calls.value, 1)

        // Once that one is over, a new start takes new pictures
        startAndWait(session, "third")
        XCTAssertEqual(source.calls.value, 2)
    }

    func testEveryoneWaitingHearsTheEndOnceAndClosingWhenNothingIsOpenDoesNothing() {
        var closed = 0
        let session = CaptureSession(source: FakeSource(.failure(.noScreens)), access: FakeAccess(), guide: FakeGuide(), defaults: defaults)
        session.close()
        session.start(whenClosed: { closed += 1 })
        // Not over yet: the pictures are still being taken
        XCTAssertEqual(closed, 0)
        let over = expectation(description: "over")
        session.start(whenClosed: { over.fulfill() })
        wait(for: [over], timeout: 5)
        XCTAssertEqual(closed, 1)
        session.close()
        XCTAssertEqual(closed, 1)
    }

    // MARK: The shortcut in the menu bar item's menu

    func testTheShortcutAsAMenuDrawsIt() throws {
        func key(_ text: String) throws -> String? { try HotKeyDisplay.keyEquivalent(XCTUnwrap(HotKeySpec.parse(text), text)) }
        /// AppKit's character for a key that types nothing (NSF5FunctionKey ...)
        func special(_ code: Int) -> String { String(Character(UnicodeScalar(UInt32(code))!)) }
        XCTAssertEqual(try key("Control+Ctrl+Alt+A"), "a")
        XCTAssertEqual(try key("Ctrl+Shift+7"), "7")
        XCTAssertEqual(try key("Ctrl+NumPad7"), "7")
        XCTAssertEqual(try key("Ctrl+Space"), " ")
        XCTAssertEqual(try key("Ctrl+F5"), special(NSF5FunctionKey))
        XCTAssertEqual(try key("ctrl+f12"), special(NSF12FunctionKey))
        XCTAssertEqual(try key("Ctrl+Left"), special(NSLeftArrowFunctionKey))
        XCTAssertEqual(try key("Ctrl+down"), special(NSDownArrowFunctionKey))
        XCTAssertEqual(try key("Ctrl+PageUp"), special(NSPageUpFunctionKey))
        XCTAssertEqual(try key("Ctrl+Home"), special(NSHomeFunctionKey))

        let spec = try XCTUnwrap(HotKeySpec.parse("Control+Ctrl+Alt+A"))
        XCTAssertEqual(HotKeyDisplay.mask(spec), [.control, .option, .command])
        XCTAssertEqual(HotKeyDisplay.mask(try XCTUnwrap(HotKeySpec.parse("Ctrl+Shift+K"))), [.shift, .command])
    }
}
