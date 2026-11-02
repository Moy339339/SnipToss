import XCTest

@testable import SnipToss

/// The recent custom colors kept in the settings (shared by the page's color rows and the capture overlay), the bridge method that adds
/// one, and the capture overlay's color kept across restarts (the same cases as ColorMathTests in the Windows shell)
final class RecentColorsTests: SnipTestCase {
    func testAPickedCustomColorGoesFirstWithoutRepeatsPresetsOrMoreThanFourAndSurvivesARestart() throws {
        let path = makeTempDir() + "/settings.json"
        let s = Settings.load(from: path)
        var told: [[String]] = []
        s.onRecentColorsChanged = { told.append($0) }
        for c in ["#111111", "#222222", "#333333", "#444444", "#555555"] { try s.addRecentColor(c) }
        XCTAssertEqual(s.recentColors, ["#555555", "#444444", "#333333", "#222222"])
        try s.addRecentColor("#333333")  // picked again: moves to the front
        XCTAssertEqual(s.recentColors, ["#333333", "#555555", "#444444", "#222222"])
        try s.addRecentColor(" #FF6A3D ")  // a preset color: the row already has it
        try s.addRecentColor("#333333")  // already first: nothing changes
        XCTAssertEqual(told.count, 6)
        XCTAssertEqual(told.last, ["#333333", "#555555", "#444444", "#222222"])
        XCTAssertEqual(Settings.load(from: path).recentColors, ["#333333", "#555555", "#444444", "#222222"])
        XCTAssertThrowsError(try s.addRecentColor("blue"))
        XCTAssertThrowsError(try s.addRecentColor("#+12345"))
    }

    func testRecentColorsFromAHandEditedFileAreCleanedUp() {
        let path = makeTempDir() + "/settings.json"
        writeText(
            ##"{ "RecentColors": ["#ABCDEF", "nope", "#abcdef", "#ffffff", "#123456", null, "#000001", "#000002", "#000003"] }"##, to: path)
        XCTAssertEqual(Settings.load(from: path).recentColors, ["#abcdef", "#123456", "#000001", "#000002"])
    }

    /// Written with the Windows shell's keys: RecentColors after Capture, ToolColor and ToolColorOver after Capture.Folder
    func testTheFileUsesTheWindowsKeys() throws {
        let path = makeTempDir() + "/settings.json"
        let s = Settings.load(from: path)
        try s.addRecentColor("#17a998")
        s.saveToolColor(MarkColor(hex: 0x17a998), over: ToolPrefs.colors[0])
        let text = readText(path)
        XCTAssertTrue(text.contains(##""RecentColors": ["##), text)
        XCTAssertTrue(text.contains(##""ToolColor": "#17a998""##), text)
        XCTAssertTrue(text.contains(##""ToolColorOver": "#ff6a3d""##), text)
        let capture = try XCTUnwrap(text.range(of: ##""Capture""##)), recent = try XCTUnwrap(text.range(of: ##""RecentColors""##))
        XCTAssertLessThan(capture.lowerBound, recent.lowerBound)
        let kept = try XCTUnwrap(Settings.load(from: path).toolColor)
        XCTAssertEqual(kept.color, MarkColor(hex: 0x17a998))
        XCTAssertEqual(kept.over, ToolPrefs.colors[0])
        s.saveToolColor(nil, over: nil)  // the setting changed since: nothing is kept
        XCTAssertNil(Settings.load(from: path).toolColor)
    }

    func testAddRecentColorTakesTheColorFromThePagesParametersAndRefusesAnythingElse() throws {
        let s = Settings.load(from: makeTempDir() + "/settings.json")
        XCTAssertEqual(try addRecentColorReply(["color": "#17A998"], settings: s), ["#17a998"])
        XCTAssertThrowsError(try addRecentColorReply(["colour": "#17a998"], settings: s))
        XCTAssertThrowsError(try addRecentColorReply(["color": "teal"], settings: s))
        XCTAssertThrowsError(try addRecentColorReply(nil, settings: s))
    }
}
