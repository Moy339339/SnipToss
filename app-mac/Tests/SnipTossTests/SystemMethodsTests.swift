import AppKit
import XCTest

@testable import SnipToss

/// `reveal`, `openExternal`, `exportDiagnostics` (SystemMethods.swift), the diagnostics package, and the login item behind
/// Settings > General "open at login" (LoginItem.swift, `applyCaptureSettings`). The system's side is always a stand-in: nothing opens
/// Finder or the browser, no save dialog shows, and no login item is registered on the machine running the tests
final class SystemMethodsTests: SnipTestCase {
    private final class FakeLoginItem: LoginItemControl {
        var state: LoginItemState = .off
        var refusal: LoginItemError?
        var asked: [Bool] = []
        var settingsOpened = 0

        func set(_ on: Bool) throws {
            asked.append(on)
            if let refusal { throw refusal }
            state = on ? .on : .off
        }

        func openSystemSettings() { settingsOpened += 1 }
    }

    private struct Place {
        let library: String
        let home: String
        let settingsFile: String
        let logDir: String
        let app: String
        let targets: RevealTargets
    }

    private func place() -> Place {
        let root = makeTempDir()
        let library = root + "/items"
        let home = root + "/project"
        let logDir = root + "/logs"
        let app = root + "/SnipToss.app"
        for dir in [library, home + "/.sniptoss", logDir, app + "/Contents"] {
            try! FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        }
        let settingsFile = root + "/settings.json"
        writeText("{}", to: settingsFile)
        let targets = RevealTargets(
            library: { [library] }, homes: { [home] }, captureFolder: { root + "/captures" }, settingsFile: settingsFile, logDir: logDir,
            appBundle: app)
        return Place(library: library, home: home, settingsFile: settingsFile, logDir: logDir, app: app, targets: targets)
    }

    private func code(_ call: () throws -> Any?) -> String? {
        do {
            _ = try call()
            return "no error"
        } catch let error as BridgeError {
            return error.code
        } catch {
            return "\(error)"
        }
    }

    // MARK: reveal

    func testTheSpecialNamesStandForTheSettingsFileTheAppAndTheLogFolder() throws {
        let p = place()
        XCTAssertEqual(try Reveal.resolve("@settings", targets: p.targets), p.settingsFile)
        XCTAssertEqual(try Reveal.resolve("@app", targets: p.targets), p.app)
        XCTAssertEqual(try Reveal.resolve("@logs", targets: p.targets), p.logDir)
    }

    func testOnlyTheLibraryNotesFoldersAndTheAppsOwnPlacesCanBeShown() throws {
        let p = place()
        writeText("x", to: p.library + "/a.png")
        var shown: [RevealAction] = []
        _ = try revealReply(["path": p.library + "/a.png"], targets: p.targets) { shown.append($0) }
        _ = try revealReply(["path": p.home + "/.sniptoss"], targets: p.targets) { shown.append($0) }
        // The app bundle is a folder, but it is shown in its folder, never opened
        _ = try revealReply(["path": "@app"], targets: p.targets) { shown.append($0) }
        XCTAssertEqual(shown, [.select(p.library + "/a.png"), .open(p.home + "/.sniptoss"), .select(p.app)])

        let outside = makeTempDir()
        XCTAssertEqual(code { try revealReply(["path": outside], targets: p.targets) { _ in XCTFail("shown") } }, "denied")
        // A path that climbs out of an allowed folder is judged by where it ends up
        XCTAssertEqual(code { try revealReply(["path": p.library + "/../../"], targets: p.targets) { _ in XCTFail("shown") } }, "denied")
        XCTAssertEqual(code { try revealReply(["nothing": 1], targets: p.targets) { _ in } }, nil)
    }

    func testAMissingFileIsReportedAsNotFound() {
        let p = place()
        XCTAssertEqual(code { try revealReply(["path": p.library + "/gone.png"], targets: p.targets) { _ in XCTFail("shown") } }, "notFound")
    }

    // MARK: openExternal

    func testOnlyWebAddressesWithAHostAreOpened() throws {
        var opened: [URL] = []
        _ = try openExternalReply(["url": "https://github.com/Moy339339/SnipToss/releases"]) { opened.append($0); return true }
        _ = try openExternalReply(["url": " http://example.com "]) { opened.append($0); return true }
        XCTAssertEqual(opened.map(\.absoluteString), ["https://github.com/Moy339339/SnipToss/releases", "http://example.com"])
        for refused in ["file:///etc/passwd", "javascript:alert(1)", "x-apple.systempreferences:com.apple.preference", "https://", "github.com"] {
            XCTAssertThrowsError(try openExternalReply(["url": refused]) { _ in XCTFail(refused); return true }, refused)
        }
        XCTAssertThrowsError(try openExternalReply(["url": "https://example.com"]) { _ in false })
    }

    // MARK: exportDiagnostics

    func testCancellingTheSaveDialogWritesNothing() throws {
        let p = place()
        let reply = try exportDiagnosticsReply(
            ["text": "info"], settingsFile: p.settingsFile, logDir: p.logDir, choose: { _ in nil }, show: { _ in XCTFail("shown") })
        XCTAssertNil(reply)
    }

    func testThePackageHasTheInfoTheRecentLogsAndTheSettingsWithoutPathsOrNames() throws {
        let p = place()
        let home = NSHomeDirectory()
        let now = Date()
        writeText("2026 INFO started\n", to: p.logDir + "/SnipToss-today.log")
        writeText("old\n", to: p.logDir + "/SnipToss-old.log")
        try FileManager.default.setAttributes([.modificationDate: now.addingTimeInterval(-8 * 24 * 3600)], ofItemAtPath: p.logDir + "/SnipToss-old.log")
        writeText("not a log", to: p.logDir + "/notes.txt")
        let settings: [String: Any] = [
            "Library": [["Path": home + "/Pictures/a"], ["Path": home + "/Pictures/b"]], "Selected": home + "/Pictures/a/x.png",
            "Prefs": ["author": "Someone", "promptExtra": "", "language": "zh-CN"], "Capture": ["Folder": home + "/Shots", "Hotkey": "Control+Alt+Ctrl+A"],
        ]
        try JSONSerialization.data(withJSONObject: settings).write(to: URL(fileURLWithPath: p.settingsFile))
        let target = makeTempDir() + "/out.zip"
        var asked: String?
        var shown: [RevealAction] = []
        let reply = try exportDiagnosticsReply(
            ["text": "Version 1.2.0\nData: \(home)/Library/Application Support/SnipToss"], settingsFile: p.settingsFile, logDir: p.logDir,
            now: now, choose: { asked = $0; return target }, show: { shown.append($0) })
        XCTAssertEqual(reply as? String, target)
        XCTAssertEqual(shown, [.select(target)])
        XCTAssertTrue(asked?.hasPrefix("SnipToss-diagnostics-") == true && asked?.hasSuffix(".zip") == true, asked ?? "")

        let zip = try Data(contentsOf: URL(fileURLWithPath: target))
        XCTAssertEqual(try TestZip.names(zip).sorted(), ["diagnostics.txt", "logs/SnipToss-today.log", "settings.json"])
        let info = try XCTUnwrap(try TestZip.text(zip, "diagnostics.txt"))
        XCTAssertFalse(info.contains(home), info)
        let stored = try XCTUnwrap(try TestZip.text(zip, "settings.json"))
        XCTAssertFalse(stored.contains(home), stored)
        XCTAssertFalse(stored.contains("Someone"), stored)
        XCTAssertTrue(stored.contains("(2 entries)"), stored)
        XCTAssertTrue(stored.contains("(custom)"), stored)
        XCTAssertTrue(stored.contains("Control+Alt+Ctrl+A"), stored)
        XCTAssertTrue(stored.contains("zh-CN"), stored)
    }

    func testTheDefaultNameIsTheLocalDateAndTime() {
        let date = Date(timeIntervalSince1970: 1_793_000_000)
        XCTAssertEqual(DiagnosticsPackage.defaultName(for: date, timeZone: TimeZone(identifier: "UTC")!), "SnipToss-diagnostics-20261026-073320.zip")
    }

    // MARK: Login item

    func testSwitchingOpenAtLoginRegistersTheLoginItemAndRepliesWhatTheSystemSays() throws {
        let settings = Settings.load(from: makeTempDir() + "/settings.json")
        let item = FakeLoginItem()
        let on = applyCaptureSettings(CaptureSettingsPatch(["autostart": true]), settings: settings, loginItem: item)
        XCTAssertNil(on.loginItemRefusal)
        XCTAssertEqual(item.asked, [true])
        XCTAssertEqual(on.reply["autostart"] as? Bool, true)
        XCTAssertTrue(settings.capture.autostart)
        // Switched off in System Settings since: the reply follows the system, not what was stored
        item.state = .off
        let read = captureSettingsReply(settings.capture, autostart: item.state == .on)
        XCTAssertEqual(read["autostart"] as? Bool, false)
    }

    func testWhenTheSystemWaitsForApprovalSystemSettingsOpensAndTheSwitchStaysOff() throws {
        let settings = Settings.load(from: makeTempDir() + "/settings.json")
        let item = FakeLoginItem()
        item.refusal = .needsApproval
        let outcome = applyCaptureSettings(CaptureSettingsPatch(["autostart": true, "keepInTray": false]), settings: settings, loginItem: item)
        XCTAssertNotNil(outcome.loginItemRefusal)
        XCTAssertEqual(item.settingsOpened, 1)
        XCTAssertEqual(outcome.reply["autostart"] as? Bool, false)
        XCTAssertFalse(settings.capture.autostart)
        // The rest of the call is stored anyway
        XCTAssertFalse(settings.capture.keepInTray)
    }

    func testARefusalCarriesTheSystemsReasonAndATestInstanceNeverTouchesTheItem() {
        let item = FakeLoginItem()
        item.refusal = .failed("Operation not permitted")
        XCTAssertTrue(LoginItemChange.apply(true, to: item)?.message.contains("Operation not permitted") == true)
        item.refusal = .testInstance
        XCTAssertNotNil(LoginItemChange.apply(true, to: item))
        XCTAssertEqual(item.settingsOpened, 0)
        XCTAssertThrowsError(try SystemLoginItem(isTestInstance: true).set(true)) { error in
            XCTAssertEqual(error as? LoginItemError, .testInstance)
        }
    }

    func testStartedAsALoginItemTheWindowStaysClosedWhileTheMenuBarItemIsThere() {
        let code = LoginLaunch.fourCharCode
        let open = NSAppleEventDescriptor(
            eventClass: code("aevt"), eventID: code("oapp"), targetDescriptor: nil, returnID: -1, transactionID: 0)
        XCTAssertFalse(LoginLaunch.isLoginLaunch(open))
        let atLogin = NSAppleEventDescriptor(
            eventClass: code("aevt"), eventID: code("oapp"), targetDescriptor: nil, returnID: -1, transactionID: 0)
        atLogin.setParam(NSAppleEventDescriptor(enumCode: code("lgit")), forKeyword: code("prdt"))
        XCTAssertTrue(LoginLaunch.isLoginLaunch(atLogin))
        XCTAssertFalse(LoginLaunch.isLoginLaunch(nil))
        XCTAssertTrue(LoginLaunch.startsHidden(event: atLogin, keepInTray: true))
        // Without the menu bar item the window is the only way in
        XCTAssertFalse(LoginLaunch.startsHidden(event: atLogin, keepInTray: false))
        XCTAssertFalse(LoginLaunch.startsHidden(event: open, keepInTray: true))
    }
}
