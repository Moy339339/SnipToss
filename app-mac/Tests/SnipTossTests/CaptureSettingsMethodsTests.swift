import XCTest

@testable import SnipToss

/// The replies of `captureSettings` and `setCaptureSettings` with the parameters as the page sends them (the bridge methods themselves
/// only unpack them), and what the patch does to the stored settings
final class CaptureSettingsMethodsTests: SnipTestCase {
    private let defaultFolder = "/Users/u/Library/Application Support/SnipToss/captures"

    private func newSettings() -> (settings: Settings, path: String) {
        let path = makeTempDir() + "/settings.json"
        return (Settings.load(from: path), path)
    }

    /// Parameters as they arrive from the page: decoded from JSON, so a null is an NSNull and a boolean is a real boolean
    private func params(_ json: String) throws -> Any {
        try JSONSerialization.jsonObject(with: Data(json.utf8))
    }

    private func set(_ json: String, _ settings: Settings) throws -> [String: Any] {
        let sent = try params(json)
        return setCaptureSettingsReply(CaptureSettingsPatch(sent), settings: settings, defaultFolder: defaultFolder)
    }

    // MARK: captureSettings

    func testAFreshInstallReportsTheDefaultsAndNothingThatCouldHaveFailed() {
        let reply = captureSettingsReply(newSettings().settings.capture, defaultFolder: defaultFolder)
        XCTAssertEqual(reply["hotkey"] as? String, "Ctrl+Alt+A")
        XCTAssertTrue(reply["hotkeyError"] is NSNull, "nothing registers the shortcut yet")
        XCTAssertEqual(reply["hotkeyTypes"] as? String, "")
        XCTAssertTrue(reply["hotkeyMoved"] is NSNull)
        XCTAssertEqual(reply["keepInTray"] as? Bool, true)
        XCTAssertEqual(reply["hideWindow"] as? Bool, true)
        XCTAssertEqual(reply["notesInImage"] as? Bool, true)
        XCTAssertEqual(reply["folder"] as? String, "", "no folder chosen: the page shows the default")
        XCTAssertEqual(reply["defaultFolder"] as? String, defaultFolder)
        XCTAssertEqual(reply["autostart"] as? Bool, false)
        XCTAssertEqual(reply.count, 10, "exactly the fields of CaptureSettings in host.ts")
    }

    func testTheReplyCanBeSentToThePage() {
        XCTAssertTrue(JSONSerialization.isValidJSONObject(captureSettingsReply(CaptureSettings(), defaultFolder: defaultFolder)))
    }

    func testTheDefaultFolderIsNextToTheSettingsFile() {
        XCTAssertEqual(AppPaths.capturesDir, AppPaths.localDir + "/captures")
    }

    // MARK: setCaptureSettings

    func testOnlyTheItemsSentChange() throws {
        let (settings, _) = newSettings()
        let reply = try set("{\"keepInTray\":false}", settings)
        XCTAssertEqual(reply["keepInTray"] as? Bool, false)
        XCTAssertEqual(reply["hideWindow"] as? Bool, true)
        XCTAssertEqual(reply["notesInImage"] as? Bool, true)
        XCTAssertEqual(reply["hotkey"] as? String, "Ctrl+Alt+A")
        XCTAssertFalse(settings.capture.hotkeyCustom, "the shortcut was not touched")
        XCTAssertFalse(settings.capture.keepInTray)
    }

    func testEveryItemIsStoredAndReadBackAfterARestart() throws {
        let (settings, path) = newSettings()
        let json = "{\"hotkey\":\"Ctrl+Shift+K\",\"keepInTray\":false,\"hideWindow\":false,\"notesInImage\":false,"
            + "\"folder\":\"/Users/u/Shots\",\"autostart\":true}"
        let reply = try set(json, settings)
        XCTAssertEqual(reply["hotkey"] as? String, "Ctrl+Shift+K")
        XCTAssertEqual(reply["folder"] as? String, "/Users/u/Shots")
        XCTAssertEqual(reply["autostart"] as? Bool, true)
        XCTAssertTrue(reply["hotkeyError"] is NSNull)

        let back = Settings.load(from: path).capture
        XCTAssertEqual(back.hotkey, "Ctrl+Shift+K")
        XCTAssertTrue(back.hotkeyCustom, "a shortcut the user chose is not replaced later")
        XCTAssertFalse(back.keepInTray)
        XCTAssertFalse(back.hideWindow)
        XCTAssertFalse(back.notesInImage)
        XCTAssertEqual(back.folder, "/Users/u/Shots")
        XCTAssertTrue(back.autostart)
    }

    func testTheShortcutAndTheFolderAreTrimmed() throws {
        let (settings, _) = newSettings()
        let reply = try set("{\"hotkey\":\"  Ctrl+Alt+Q \\n\",\"folder\":\"  /Users/u/Shots  \"}", settings)
        XCTAssertEqual(reply["hotkey"] as? String, "Ctrl+Alt+Q")
        XCTAssertEqual(reply["folder"] as? String, "/Users/u/Shots")
    }

    func testAnEmptyShortcutMeansNoShortcutAndIsKept() throws {
        let (settings, _) = newSettings()
        let reply = try set("{\"hotkey\":\"\"}", settings)
        XCTAssertEqual(reply["hotkey"] as? String, "")
        XCTAssertTrue(settings.capture.hotkeyCustom)
    }

    func testABlankFolderGoesBackToTheDefault() throws {
        let (settings, _) = newSettings()
        _ = try set("{\"folder\":\"/Users/u/Shots\"}", settings)
        let reply = try set("{\"folder\":\"   \"}", settings)
        XCTAssertEqual(reply["folder"] as? String, "")
        XCTAssertNil(settings.capture.folder)
    }

    func testAnItemOfTheWrongTypeChangesNothing() throws {
        let (settings, _) = newSettings()
        let reply = try set(
            "{\"keepInTray\":\"no\",\"hideWindow\":0,\"notesInImage\":null,\"hotkey\":false,\"folder\":5,\"autostart\":\"yes\"}", settings)
        XCTAssertEqual(reply["keepInTray"] as? Bool, true)
        XCTAssertEqual(reply["hideWindow"] as? Bool, true)
        XCTAssertEqual(reply["notesInImage"] as? Bool, true)
        XCTAssertEqual(reply["hotkey"] as? String, "Ctrl+Alt+A")
        XCTAssertEqual(reply["folder"] as? String, "")
        XCTAssertEqual(reply["autostart"] as? Bool, false)
    }

    func testNoParametersChangeNothing() {
        let (settings, path) = newSettings()
        let samples: [Any?] = [nil, NSNull(), [String: Any](), "text"]
        for sample in samples {
            let reply = setCaptureSettingsReply(CaptureSettingsPatch(sample), settings: settings, defaultFolder: defaultFolder)
            XCTAssertEqual(reply["keepInTray"] as? Bool, true)
        }
        XCTAssertEqual(Settings.load(from: path).capture.hotkey, "Ctrl+Alt+A")
    }

    func testThePatchSaysWhetherTheMenuBarSettingWasSent() throws {
        let other = try params("{\"hideWindow\":false}")
        let off = try params("{\"keepInTray\":false}")
        let on = try params("{\"keepInTray\":true}")
        XCTAssertNil(CaptureSettingsPatch(other).keepInTray)
        XCTAssertEqual(CaptureSettingsPatch(off).keepInTray, false)
        XCTAssertEqual(CaptureSettingsPatch(on).keepInTray, true)
    }

    func testAFileWithoutTheAutostartKeyReadsAsOff() {
        let path = makeTempDir() + "/settings.json"
        writeText("{ \"Capture\": { \"Hotkey\": \"Ctrl+Alt+K\", \"KeepInTray\": false } }", to: path)
        let capture = Settings.load(from: path).capture
        XCTAssertFalse(capture.autostart)
        XCTAssertFalse(capture.keepInTray)
    }
}
