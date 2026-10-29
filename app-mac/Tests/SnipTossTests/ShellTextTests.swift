import AppKit
import XCTest

@testable import SnipToss

/// The shell's own words in the language of the UI: `ShellText` reads the catalog of the current language (resources built by
/// `node app-mac/scripts/build-resources.mjs`, SNIPTOSS_RESOURCES_DIR), and says its built-in English when there are none
final class ShellTextTests: XCTestCase {
    override func setUp() {
        super.setUp()
        ShellLocale.reset()
    }

    override func tearDown() {
        ShellLocale.reset()
        super.tearDown()
    }

    private func hasResources() -> Bool {
        guard let dir = AppResources.directory() else { return false }
        return FileManager.default.fileExists(atPath: dir.appendingPathComponent("shell-messages.js").path)
    }

    private func catalogText(_ language: String, _ key: String) throws -> String {
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 { root.deleteLastPathComponent() }
        let data = try Data(contentsOf: root.appendingPathComponent("i18n/locales/\(language).json"))
        let catalog = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: String])
        return try XCTUnwrap(catalog[key])
    }

    func testTheTextIsTheCatalogsInTheLanguageInUse() throws {
        try XCTSkipUnless(hasResources(), "the shell's resources are not built")
        ShellLocale.use(pref: "en", system: "en-US")
        XCTAssertEqual(ShellText.t("shell.tray.capture"), try catalogText("en", "shell.tray.capture"))
        ShellLocale.use(pref: "zh-CN", system: "en-US")
        XCTAssertEqual(ShellText.t("shell.tray.capture"), try catalogText("zh-CN", "shell.tray.capture"))
        XCTAssertNotEqual(ShellText.t("shell.tray.capture"), "Capture Screen")
        // A message with a placeholder
        XCTAssertEqual(ShellText.t("shell.tray.open", ["app": "X"]).contains("X"), true)
    }

    func testAMessageWithASelectIsFilledIn() throws {
        try XCTSkipUnless(hasResources(), "the shell's resources are not built")
        let busy = ShellText.t("shell.settings.fromBackup", ["reason": "busy"])
        let damaged = ShellText.t("shell.settings.fromBackup", ["reason": "damaged"])
        XCTAssertTrue(busy.contains("couldn't be read"), busy)
        XCTAssertTrue(damaged.contains("damaged"), damaged)
    }

    func testWithoutTheResourcesTheBuiltInEnglishIsUsed() {
        let saved = getenv("SNIPTOSS_RESOURCES_DIR").map { String(cString: $0) }
        setenv("SNIPTOSS_RESOURCES_DIR", "/nonexistent-folder-for-test", 1)
        ShellLocale.reset()
        XCTAssertEqual(ShellText.t("shell.tray.capture"), "Capture Screen")
        XCTAssertEqual(ShellText.t("shell.menu.quit", ["app": "SnipToss"]), "Quit SnipToss")
        XCTAssertEqual(ShellText.t("brand.name"), "SnipToss")
        // A key nobody knows is returned as it is
        XCTAssertEqual(ShellText.t("no.such.message"), "no.such.message")
        if let saved { setenv("SNIPTOSS_RESOURCES_DIR", saved, 1) } else { unsetenv("SNIPTOSS_RESOURCES_DIR") }
        ShellLocale.reset()
    }

    func testAChangeOfLanguageIsAnnouncedOnce() {
        let announced = expectation(description: "language changed")
        announced.expectedFulfillmentCount = 1
        announced.assertForOverFulfill = true
        let observer = NotificationCenter.default.addObserver(forName: .shellLanguageChanged, object: nil, queue: .main) { _ in
            announced.fulfill()
        }
        defer { NotificationCenter.default.removeObserver(observer) }
        XCTAssertTrue(ShellLocale.use(pref: "de", system: "en-US"))
        XCTAssertFalse(ShellLocale.use(pref: "de", system: "fr-FR"))
        wait(for: [announced], timeout: 2)
    }

    func testTheAppMenuSaysItsWordsAgainWhenAskedTo() {
        let bar = NSMenu()
        bar.addItem(NSMenuItem())
        MainMenu.refreshAppMenu(in: bar, openSettings: Selector(("openSettings:")), openAbout: Selector(("openAbout:")))
        let items = bar.items[0].submenu?.items ?? []
        XCTAssertEqual(items.count, 9)
        XCTAssertEqual(items.filter { !$0.isSeparatorItem }.count, 6)
        XCTAssertEqual(items[0].title, ShellText.t("shell.menu.about", ["app": ShellText.t("brand.name")]))
        XCTAssertEqual(items[2].keyEquivalent, ",")
        XCTAssertEqual(items[4].keyEquivalent, "h")
        XCTAssertEqual(items[8].keyEquivalent, "q")
        // The standard Edit items are made from the same words
        let edit = MainMenu.standardEditItems()
        XCTAssertEqual(
            edit.map { $0.title },
            ["", ShellText.t("shell.menu.cut"), ShellText.t("shell.menu.copy"), ShellText.t("shell.menu.paste"), ShellText.t("shell.menu.selectAll")])
    }
}
