import XCTest

@testable import SnipToss

/// The overlay's changeable keys (CaptureKeys): reading them from the settings, naming a key press the way the page does (keyName in
/// packages/web/src/keys.ts, on the Mac), and writing a key the Mac way for the toolbar's tooltips
final class CaptureKeysTests: XCTestCase {
    func testTheDefaultsAreTheCommandTables() {
        // packages/web/test/commands.test.ts compares this list with the command table (and the Windows overlay's)
        XCTAssertEqual(CaptureKeys.defaults.map { $0.id }.count, 9)
        XCTAssertEqual(CaptureKeys.standard.command(of: ["R"]), "capture.rect")
        XCTAssertEqual(CaptureKeys.standard.command(of: ["C"]), "capture.point")
        XCTAssertEqual(CaptureKeys.standard.command(of: ["N"]), "capture.whole")
        XCTAssertEqual(CaptureKeys.standard.command(of: ["Ctrl+Z"]), "capture.undo")
        XCTAssertNil(CaptureKeys.standard.command(of: ["Ctrl+Shift+Z"]))
        XCTAssertNil(CaptureKeys.standard.command(of: []))
        // The names are tried in order: the first that has a command wins
        XCTAssertEqual(CaptureKeys.standard.command(of: ["Shift+R", "R"]), "capture.rect")
    }

    func testChangedKeysReplaceTheDefaultsAndAnythingElseKeepsThem() {
        let bindings: [String: Any] = [
            "capture.rect": ["Q", "Shift+Q"],
            "capture.undo": [String](),
            "capture.pen": "B",  // not a list: the defaults
            "capture.arrow": [1, "X"] as [Any],  // what is not a name is left out
            "tool.rect": ["W"],  // the main window's: not the overlay's
        ]
        let keys = CaptureKeys.from(bindings)
        XCTAssertEqual(keys.command(of: ["Q"]), "capture.rect")
        XCTAssertEqual(keys.command(of: ["Shift+Q"]), "capture.rect")
        XCTAssertNil(keys.command(of: ["R"]))
        XCTAssertNil(keys.command(of: ["Ctrl+Z"]))
        XCTAssertEqual(keys.command(of: ["B"]), "capture.pen")
        XCTAssertEqual(keys.command(of: ["X"]), "capture.arrow")
        XCTAssertNil(keys.command(of: ["A"]))
        XCTAssertNil(keys.command(of: ["W"]))
        XCTAssertEqual(keys.hint("capture.rect"), "Q")
        XCTAssertEqual(keys.hint("capture.undo"), "")
        // Settings that are not an object: everything at its default
        XCTAssertEqual(CaptureKeys.from("x").command(of: ["R"]), "capture.rect")
        XCTAssertEqual(CaptureKeys.from(nil).command(of: ["Ctrl+Z"]), "capture.undo")
    }

    private func name(_ code: UInt16, _ characters: String?, _ mods: OverlayModifiers = []) -> String? {
        CaptureKeys.name(keyCode: code, mods: mods, characters: characters)
    }

    func testLettersGoByTheCharacterTypedOnALatinLayoutAndByTheirPlaceOtherwise() {
        XCTAssertEqual(name(0x0F, "r"), "R")
        XCTAssertEqual(name(0x0F, "R", [.shift]), "Shift+R")
        XCTAssertEqual(name(0x06, "z", [.command]), "Ctrl+Z")
        XCTAssertEqual(name(0x06, "Z", [.command, .shift]), "Ctrl+Shift+Z")
        // French AZERTY: the key where a US keyboard has Q types A, and the one where it has W types Z
        XCTAssertEqual(name(0x0C, "a"), "A")
        XCTAssertEqual(name(0x0D, "z", [.command]), "Ctrl+Z")
        // Russian: the R key types к; Korean: the R key types ㄱ
        XCTAssertEqual(name(0x0F, "к"), "R")
        XCTAssertEqual(name(0x0F, "ㄱ"), "R")
        // A Latin letter with an accent stays itself (Swiss French has é where a US keyboard has ;)
        XCTAssertEqual(name(0x29, "é"), "É")
        // With Option a letter goes by its place (Option+Z types Ω)
        XCTAssertEqual(name(0x06, "Ω", [.option]), "Alt+Z")
        XCTAssertEqual(name(0x06, "Ω", [.command, .option]), "Ctrl+Alt+Z")
        // An event made without characters: by its place
        XCTAssertEqual(name(0x0F, ""), "R")
        XCTAssertEqual(name(0x0F, nil), "R")
    }

    func testTheCommandKeyIsCtrlAndTheControlKeyIsControlOnlyWithoutIt() {
        XCTAssertEqual(name(0x0F, "r", [.control]), "Control+R")
        XCTAssertEqual(name(0x0F, "r", [.control, .command]), "Ctrl+R")
        XCTAssertEqual(name(0x0F, "R", [.control, .option, .shift]), "Control+Alt+Shift+R")
    }

    func testDigitsGoByTheirPlaceUnlessCommandOrControlIsHeldAlone() {
        XCTAssertEqual(name(0x12, "1"), "1")
        XCTAssertEqual(name(0x12, "!", [.shift]), "Shift+1")
        XCTAssertEqual(name(0x12, "¡", [.option]), "Alt+1")
        // French AZERTY: the 1 key types &, still 1 by itself; with ⌘ it goes by the character typed, as the page does
        XCTAssertEqual(name(0x12, "&"), "1")
        XCTAssertEqual(name(0x12, "&", [.command]), "Ctrl+&")
        XCTAssertEqual(name(0x12, "1", [.command]), "Ctrl+1")
        XCTAssertEqual(name(0x12, "!", [.command, .shift]), "Ctrl+Shift+1")
        // The keypad's digits are the digit typed, Shift not added
        XCTAssertEqual(name(0x53, "1", [.shift]), "1")
    }

    func testSymbolsGoByTheCharacterTypedWithShiftInIt() {
        XCTAssertEqual(name(0x2C, "?", [.shift]), "?")
        XCTAssertEqual(name(0x2F, ".", [.command]), "Ctrl+.")
        // A layout where the period needs Shift: still ⌘.
        XCTAssertEqual(name(0x29, ".", [.command, .shift]), "Ctrl+.")
        XCTAssertEqual(name(0x21, "["), "[")
        XCTAssertEqual(name(0x2C, "÷", [.option]), "Alt+÷")
    }

    func testNamedKeysGoByTheirWebNames() {
        XCTAssertEqual(name(0x7B, "\u{F702}", [.shift]), "Shift+ArrowLeft")
        XCTAssertEqual(name(0x35, "\u{1B}"), "Escape")
        XCTAssertEqual(name(0x24, "\r"), "Enter")
        XCTAssertEqual(name(0x4C, "\u{3}"), "Enter")
        XCTAssertEqual(name(0x33, "\u{7F}", [.command]), "Ctrl+Backspace")
        XCTAssertEqual(name(0x75, "\u{F728}"), "Delete")
        XCTAssertEqual(name(0x31, " "), "Space")
        XCTAssertEqual(name(0x30, "\t"), "Tab")
        XCTAssertEqual(name(0x60, "\u{F708}"), "F5")
        XCTAssertEqual(name(0x6F, "\u{F70F}", [.command]), "Ctrl+F12")
        // A key the page has no name for (Help, a function key above F20): none
        XCTAssertNil(name(0x72, "\u{F746}"))
        XCTAssertNil(name(0x0A, "\u{1}"))
    }

    func testKeysAreWrittenTheMacWayWithModifiersInTheMacsOrder() {
        XCTAssertEqual(CaptureKeys.pretty("R"), "R")
        XCTAssertEqual(CaptureKeys.pretty("Ctrl+Z"), "⌘Z")
        XCTAssertEqual(CaptureKeys.pretty("Ctrl+Shift+Z"), "⇧⌘Z")
        XCTAssertEqual(CaptureKeys.pretty("Control+Ctrl+Alt+A"), "⌃⌥⌘A")
        XCTAssertEqual(CaptureKeys.pretty("Shift+1"), "⇧1")
        XCTAssertEqual(CaptureKeys.pretty("Alt+Enter"), "⌥↩")
        XCTAssertEqual(CaptureKeys.pretty("Escape"), "⎋")
        XCTAssertEqual(CaptureKeys.pretty("Ctrl+Backspace"), "⌘⌫")
        XCTAssertEqual(CaptureKeys.pretty("Shift+ArrowUp"), "⇧↑")
        XCTAssertEqual(CaptureKeys.pretty("Ctrl++"), "⌘+")
        XCTAssertEqual(CaptureKeys.pretty("F5"), "F5")
        XCTAssertEqual(CaptureKeys.parts("Ctrl++"), ["Ctrl", "+"])
        XCTAssertEqual(CaptureKeys.parts("+"), ["+"])
        XCTAssertEqual(CaptureKeys.standard.hint("capture.undo"), "⌘Z")
        XCTAssertEqual(CaptureKeys.standard.hint("capture.rect"), "R")
    }
}
