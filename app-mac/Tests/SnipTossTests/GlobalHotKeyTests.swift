import XCTest

@testable import SnipToss

/// The capture shortcut: what its text means, which ones are allowed, and what happens when the system takes or refuses one
final class GlobalHotKeyTests: XCTestCase {
    /// A backend that remembers what is registered and refuses what it was told to
    private final class FakeBackend: HotKeyBackend {
        var onPressed: (() -> Void)?
        var refuse: Set<UInt32> = []
        private(set) var registered: [UInt32: (keyCode: UInt32, modifiers: UInt32)] = [:]
        private var next: UInt32 = 1
        var status: Int32 = -9878

        func register(keyCode: UInt32, modifiers: UInt32) -> Result<UInt32, HotKeyFailure> {
            if refuse.contains(keyCode) { return .failure(HotKeyFailure(status: status)) }
            let handle = next
            next += 1
            registered[handle] = (keyCode, modifiers)
            return .success(handle)
        }

        func unregister(_ handle: UInt32) { registered[handle] = nil }
        func press() { onPressed?() }
    }

    /// Counts the presses
    private final class Presses {
        var count = 0
    }

    private func make() -> (GlobalHotKey, FakeBackend, Presses) {
        let backend = FakeBackend()
        let presses = Presses()
        let hotkey = GlobalHotKey(backend: backend, onPressed: { presses.count += 1 })
        return (hotkey, backend, presses)
    }

    // MARK: The text

    func testTheDefaultShortcutIsControlCommandOptionA() throws {
        let spec = try XCTUnwrap(HotKeySpec.parse("Control+Ctrl+Alt+A"))
        XCTAssertEqual(spec.keyCode, 0x00)
        XCTAssertEqual(spec.modifiers, HotKeySpec.control | HotKeySpec.command | HotKeySpec.option)
        XCTAssertEqual(spec.symbols, "⌃⌥⌘A")
        XCTAssertNil(spec.problem)
        XCTAssertEqual(CaptureSettings().hotkey, "Control+Ctrl+Alt+A")
    }

    func testTheModifiersAreInAnyOrderAndAnyCase() {
        XCTAssertEqual(HotKeySpec.parse("Alt+Ctrl+Control+A"), HotKeySpec.parse("Control+Ctrl+Alt+A"))
        XCTAssertEqual(HotKeySpec.parse("ctrl+shift+k"), HotKeySpec.parse("Ctrl+Shift+K"))
        XCTAssertEqual(HotKeySpec.parse(" Ctrl + Alt + K ")?.symbols, "⌥⌘K")
        XCTAssertEqual(HotKeySpec.parse("Ctrl+Shift+Alt+Control+K")?.symbols, "⌃⌥⇧⌘K")
    }

    func testTheKeysTheMacHas() {
        let cases: [(String, UInt32)] = [
            ("Ctrl+A", 0x00), ("Ctrl+Z", 0x06), ("Ctrl+0", 0x1D), ("Ctrl+5", 0x17), ("Ctrl+F1", 0x7A), ("Ctrl+F5", 0x60), ("Ctrl+F20", 0x5A),
            ("Ctrl+Space", 0x31), ("Ctrl+Left", 0x7B), ("Ctrl+Up", 0x7E), ("Ctrl+Home", 0x73), ("Ctrl+PageDown", 0x79), ("Ctrl+NumPad7", 0x59),
        ]
        for (text, code) in cases { XCTAssertEqual(HotKeySpec.parse(text)?.keyCode, code, text) }
    }

    func testTextThatIsNotAShortcutThisShellCanRegister() {
        // Keys a Mac keyboard does not have, parts that are not keys, two keys, no key, a stray plus
        for text in ["", "+", "Ctrl", "Ctrl+", "Ctrl+A+B", "Ctrl+PrintScreen", "Ctrl+Pause", "Ctrl+Insert", "Ctrl+F21", "Ctrl+Win+A", "Ctrl+;"] {
            XCTAssertNil(HotKeySpec.parse(text), text)
        }
    }

    func testItNeedsCommandOrControlUnlessTheKeyTypesNothing() throws {
        for text in ["Ctrl+A", "Control+A", "Ctrl+Alt+A", "Control+Alt+Shift+A", "Ctrl+F5", "Alt+F5", "Shift+F9"] {
            XCTAssertNil(try XCTUnwrap(HotKeySpec.parse(text)).problem, text)
        }
        // Option and Shift alone would take characters away from every program (Option+A types å)
        for text in ["Alt+A", "Shift+A", "Alt+Shift+A", "Alt+1", "Shift+Space", "Alt+Left"] {
            XCTAssertNotNil(try XCTUnwrap(HotKeySpec.parse(text)).problem, text)
        }
        // No modifier at all is never a global shortcut
        XCTAssertNotNil(HotKeySpec.parse("F5")?.problem)
        XCTAssertNotNil(HotKeySpec.parse("A")?.problem)
    }

    func testTheShortcutIsWrittenInMessagesWithTheMacsSymbols() {
        XCTAssertEqual(HotKeySpec.pretty("Control+Ctrl+Alt+A"), "⌃⌥⌘A")
        XCTAssertEqual(HotKeySpec.pretty("nonsense"), "nonsense")
    }

    // MARK: Registering

    func testASetShortcutIsRegisteredWithTheSystemAndPressingItCallsBack() throws {
        let (hotkey, backend, presses) = make()
        XCTAssertNil(hotkey.set("Control+Ctrl+Alt+A"))
        XCTAssertEqual(hotkey.current, "Control+Ctrl+Alt+A")
        let registered = try XCTUnwrap(backend.registered.values.first)
        XCTAssertEqual(registered.keyCode, 0x00)
        XCTAssertEqual(registered.modifiers, HotKeySpec.control | HotKeySpec.command | HotKeySpec.option)
        XCTAssertEqual(backend.registered.count, 1)
        backend.press()
        XCTAssertEqual(presses.count, 1)
    }

    func testANewShortcutReplacesTheOldOne() {
        let (hotkey, backend, _) = make()
        XCTAssertNil(hotkey.set("Ctrl+Alt+A"))
        XCTAssertNil(hotkey.set("Ctrl+Alt+K"))
        XCTAssertEqual(hotkey.current, "Ctrl+Alt+K")
        XCTAssertEqual(backend.registered.count, 1)
        XCTAssertEqual(backend.registered.values.first?.keyCode, 0x28)
    }

    func testAShortcutTheSystemRefusesLeavesTheOldOneInPlaceAndSaysSo() throws {
        let (hotkey, backend, presses) = make()
        XCTAssertNil(hotkey.set("Ctrl+Alt+A"))
        backend.refuse = [0x28]
        let message = try XCTUnwrap(hotkey.set("Ctrl+Alt+K"))
        XCTAssertTrue(message.contains("⌥⌘K"), message)
        XCTAssertEqual(hotkey.current, "Ctrl+Alt+A")
        XCTAssertEqual(backend.registered.count, 1)
        XCTAssertEqual(backend.registered.values.first?.keyCode, 0x00)
        backend.press()
        XCTAssertEqual(presses.count, 1)
    }

    func testAShortcutThatIsNotAllowedIsNotRegisteredAndTheOldOneStays() {
        let (hotkey, backend, _) = make()
        XCTAssertNil(hotkey.set("Ctrl+Alt+A"))
        for text in ["Alt+K", "Shift+K", "garbage", "Ctrl+PrintScreen"] {
            XCTAssertNotNil(hotkey.set(text), text)
        }
        XCTAssertEqual(hotkey.current, "Ctrl+Alt+A")
        XCTAssertEqual(backend.registered.count, 1)
    }

    func testAnEmptyShortcutTakesTheShortcutAway() {
        let (hotkey, backend, _) = make()
        XCTAssertNil(hotkey.set("Ctrl+Alt+A"))
        XCTAssertNil(hotkey.set(""))
        XCTAssertNil(hotkey.current)
        XCTAssertTrue(backend.registered.isEmpty)
        XCTAssertNil(hotkey.set(nil))
    }

    func testRecordingPausesTheShortcutAndGivesItBack() {
        let (hotkey, backend, _) = make()
        XCTAssertNil(hotkey.set("Ctrl+Alt+A"))
        hotkey.pause()
        XCTAssertTrue(backend.registered.isEmpty)
        XCTAssertEqual(hotkey.current, "Ctrl+Alt+A")
        // Asking twice does nothing more
        hotkey.pause()
        hotkey.resume()
        hotkey.resume()
        XCTAssertEqual(backend.registered.count, 1)
    }

    func testANewShortcutSetWhilePausedIsRegisteredAndNotPaused() {
        let (hotkey, backend, _) = make()
        XCTAssertNil(hotkey.set("Ctrl+Alt+A"))
        hotkey.pause()
        XCTAssertNil(hotkey.set("Ctrl+Alt+K"))
        hotkey.resume()
        XCTAssertEqual(backend.registered.count, 1)
        XCTAssertEqual(backend.registered.values.first?.keyCode, 0x28)
    }

    // MARK: The settings calls

    private func newSettings() -> Settings {
        let path = (NSTemporaryDirectory() as NSString).appendingPathComponent("snip-tests/" + UUID().uuidString)
        try! FileManager.default.createDirectory(atPath: path, withIntermediateDirectories: true)
        addTeardownBlock { try? FileManager.default.removeItem(atPath: path) }
        return Settings.load(from: path + "/settings.json")
    }

    func testARegisteredShortcutIsStoredAndReported() {
        let (hotkey, _, _) = make()
        let settings = newSettings()
        let reply = setCaptureSettingsReply(CaptureSettingsPatch(["hotkey": "Ctrl+Alt+K"]), settings: settings, hotkey: hotkey)
        XCTAssertEqual(reply["hotkey"] as? String, "Ctrl+Alt+K")
        XCTAssertTrue(reply["hotkeyError"] is NSNull)
        XCTAssertEqual(settings.capture.hotkey, "Ctrl+Alt+K")
        XCTAssertTrue(settings.capture.hotkeyCustom)
    }

    func testAShortcutTheSystemRefusesIsNotStoredAndTheReplySaysWhy() {
        let (hotkey, backend, _) = make()
        let settings = newSettings()
        XCTAssertNil(hotkey.set(settings.capture.hotkey))
        backend.refuse = [0x28]
        let reply = setCaptureSettingsReply(CaptureSettingsPatch(["hotkey": "Ctrl+Alt+K", "keepInTray": false]), settings: settings, hotkey: hotkey)
        // The old shortcut is what the page shows, with the reason; the other items of the call still took effect
        XCTAssertEqual(reply["hotkey"] as? String, "Control+Ctrl+Alt+A")
        XCTAssertTrue((reply["hotkeyError"] as? String)?.contains("⌥⌘K") ?? false)
        XCTAssertEqual(reply["keepInTray"] as? Bool, false)
        XCTAssertEqual(settings.capture.hotkey, "Control+Ctrl+Alt+A")
        XCTAssertFalse(settings.capture.hotkeyCustom)
    }

    func testWhyTheStoredShortcutFailedAtStartupIsInTheReplyUntilANewOneWorks() {
        let (hotkey, backend, _) = make()
        let settings = newSettings()
        backend.refuse = [0x00]
        hotkey.error = hotkey.set(settings.capture.hotkey)
        XCTAssertNotNil(hotkey.error)
        XCTAssertNotNil(captureSettingsReply(settings.capture, hotkeyError: hotkey.error)["hotkeyError"] as? String)
        let reply = setCaptureSettingsReply(CaptureSettingsPatch(["hotkey": "Ctrl+Alt+K"]), settings: settings, hotkey: hotkey)
        XCTAssertTrue(reply["hotkeyError"] is NSNull)
        XCTAssertNil(hotkey.error)
    }

    func testClearingTheShortcutIsStoredAsNone() {
        let (hotkey, _, _) = make()
        let settings = newSettings()
        XCTAssertNil(hotkey.set(settings.capture.hotkey))
        let reply = setCaptureSettingsReply(CaptureSettingsPatch(["hotkey": ""]), settings: settings, hotkey: hotkey)
        XCTAssertEqual(reply["hotkey"] as? String, "")
        XCTAssertNil(hotkey.current)
    }

    func testWithoutAHotKeyControlTheShortcutIsOnlyKept() {
        let settings = newSettings()
        let reply = setCaptureSettingsReply(CaptureSettingsPatch(["hotkey": "Ctrl+Alt+K"]), settings: settings)
        XCTAssertEqual(reply["hotkey"] as? String, "Ctrl+Alt+K")
        XCTAssertTrue(reply["hotkeyError"] is NSNull)
    }
}
