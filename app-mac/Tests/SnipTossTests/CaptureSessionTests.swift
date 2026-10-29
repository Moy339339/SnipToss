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

    /// Shows nothing; "Open System Settings" is chosen when `choose` is set
    private final class FakeGuide: PermissionGuiding {
        var shown = 0
        var choose = false
        func show(openSettings: @escaping () -> Void) {
            shown += 1
            if choose { openSettings() }
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

    func testWithoutThePermissionTheSystemAsksTheFirstTimeAndTheGuideComesAfterwardsNeverBoth() {
        let access = FakeAccess()
        access.allowed = false
        let guide = FakeGuide()
        let source = FakeSource(.success([]))
        let session = CaptureSession(source: source, access: access, guide: guide, defaults: defaults)

        startAndWait(session, "first")
        XCTAssertEqual(access.requests, 1)
        XCTAssertEqual(guide.shown, 0)
        XCTAssertFalse(session.isOpen)

        // The system shows its own question once only: from now on only the guide says where to allow it
        startAndWait(session, "second")
        XCTAssertEqual(access.requests, 1)
        XCTAssertEqual(guide.shown, 1)
        XCTAssertEqual(access.settingsOpened, 0)

        guide.choose = true
        startAndWait(session, "third")
        XCTAssertEqual(access.requests, 1)
        XCTAssertEqual(guide.shown, 2)
        XCTAssertEqual(access.settingsOpened, 1)
        XCTAssertEqual(session.overlayPanels.count, 0)
        // No picture is taken without the permission: that alone would make the system put up its question next to ours
        XCTAssertEqual(source.calls.value, 0)
    }

    func testTheGuideComesFromTheSecondTimeOnAcrossLaunches() {
        let first = FakeAccess()
        first.allowed = false
        let firstGuide = FakeGuide()
        startAndWait(CaptureSession(source: FakeSource(.success([])), access: first, guide: firstGuide, defaults: defaults), "first launch")
        let second = FakeAccess()
        second.allowed = false
        let guide = FakeGuide()
        startAndWait(CaptureSession(source: FakeSource(.success([])), access: second, guide: guide, defaults: defaults), "second launch")
        XCTAssertEqual([first.requests, second.requests], [1, 0])
        XCTAssertEqual([firstGuide.shown, guide.shown], [0, 1])
    }

    /// The check said yes, but taking the picture was refused (the permission was taken away in between): the same as no permission
    func testAPictureRefusedForLackOfPermissionIsTreatedAsNoPermission() {
        let access = FakeAccess()
        let guide = FakeGuide()
        let session = CaptureSession(source: FakeSource(.failure(.noAccess)), access: access, guide: guide, defaults: defaults)
        startAndWait(session, "first")
        startAndWait(session, "second")
        XCTAssertEqual(access.requests, 1)
        XCTAssertEqual(guide.shown, 1)
    }

    /// The buttons that lead to the permission (Settings → Screen Capture, the hint next to Capture): only an app that has asked is in the
    /// list of System Settings, so the first press asks the system; System Settings opens from then on
    func testAButtonThatLeadsToThePermissionAsksTheSystemTheFirstTimeAndOpensSystemSettingsAfterwards() {
        let access = FakeAccess()
        access.allowed = false
        ScreenAccessAsk.lead(access, defaults: defaults)
        XCTAssertEqual([access.requests, access.settingsOpened], [1, 0])
        ScreenAccessAsk.lead(access, defaults: defaults)
        ScreenAccessAsk.lead(access, defaults: defaults)
        XCTAssertEqual([access.requests, access.settingsOpened], [1, 2])
    }

    /// The system asks once only, whoever asked it: after a button asked, a capture shows the guide; after a capture asked, a button opens
    /// System Settings
    func testTheButtonsAndTheCaptureShareWhetherTheSystemWasAsked() {
        let access = FakeAccess()
        access.allowed = false
        let guide = FakeGuide()
        ScreenAccessAsk.lead(access, defaults: defaults)
        startAndWait(CaptureSession(source: FakeSource(.success([])), access: access, guide: guide, defaults: defaults), "after a button")
        XCTAssertEqual([access.requests, guide.shown, access.settingsOpened], [1, 1, 0])

        let otherName = "SnipTossTests-" + UUID().uuidString
        let other = UserDefaults(suiteName: otherName)!
        defer { other.removePersistentDomain(forName: otherName) }
        let fresh = FakeAccess()
        fresh.allowed = false
        let session = CaptureSession(source: FakeSource(.success([])), access: fresh, guide: FakeGuide(), defaults: other)
        startAndWait(session, "a capture first")
        ScreenAccessAsk.lead(fresh, defaults: other)
        XCTAssertEqual([fresh.requests, fresh.settingsOpened], [1, 1])
    }

    // MARK: Failures and repeats

    func testAFailedCaptureEndsWithoutAskingForThePermission() {
        for failure in [ScreenCaptureFailure.failed("the display went away"), .noScreens] {
            let access = FakeAccess()
            let guide = FakeGuide()
            let session = CaptureSession(source: FakeSource(.failure(failure)), access: access, guide: guide, defaults: defaults)
            startAndWait(session, "\(failure)")
            XCTAssertEqual(access.requests, 0, "\(failure)")
            XCTAssertEqual(guide.shown, 0, "\(failure)")
            XCTAssertFalse(session.isOpen)
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
