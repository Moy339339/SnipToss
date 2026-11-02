import AppKit
import XCTest

@testable import SnipToss

/// The update check (Updates.swift): which release counts as newer (channel, drafts, a Mac package), version order, when the automatic
/// check is due, and what the page and the menu bar item are told. The network is always a stand-in
final class UpdatesTests: SnipTestCase {
    private func release(
        _ tag: String, prerelease: Bool = false, draft: Bool = false, assets: [String]? = nil
    ) -> [String: Any] {
        let version = tag.hasPrefix("v") ? String(tag.dropFirst()) : tag
        let names = assets ?? ["SnipToss-\(version)-win-x64-setup.exe", "SnipToss-\(version)-mac-universal.dmg"]
        return [
            "tag_name": tag, "html_url": "https://github.com/Moy339339/SnipToss/releases/tag/\(tag)", "prerelease": prerelease, "draft": draft,
            "assets": names.map { ["name": $0] },
        ]
    }

    func testAStableBuildLooksAtStableReleasesOnlyAndABetaAtBetasToo() {
        let list = [release("v1.1.2"), release("v1.2.0-beta.3", prerelease: true), release("v1.2.0"), release("v1.3.0", draft: true)]
        XCTAssertEqual(Updates.newest(list, current: "1.1.2")?.version, "1.2.0")
        XCTAssertEqual(Updates.newest(list, current: "1.2.0-beta.1")?.version, "1.2.0")
        XCTAssertEqual(Updates.newest([release("v1.2.0-beta.3", prerelease: true)], current: "1.2.0-beta.1")?.prerelease, true)
        XCTAssertNil(Updates.newest(list, current: "1.2.0"))
        XCTAssertNil(Updates.newest(["not a list"], current: "1.0.0"))
    }

    func testOnlyAReleaseWithAMacPackageCounts() {
        let windowsOnly = release("v1.2.1", assets: ["SnipToss-1.2.1-win-x64-setup.exe", "SnipToss-1.2.1-win-x64-portable.zip", "SHA256SUMS.txt"])
        XCTAssertNil(Updates.newest([windowsOnly], current: "1.2.0"))
        XCTAssertEqual(Updates.newest([windowsOnly, release("v1.2.0")], current: "1.1.2")?.version, "1.2.0")
        XCTAssertTrue(Updates.isPackage("SnipToss-1.2.0-mac-universal.dmg"))
        XCTAssertFalse(Updates.isPackage("SnipToss-1.2.0-mac-universal.zip"))
        XCTAssertFalse(Updates.isPackage("SnipToss-1.2.0-win-x64-setup.exe"))
    }

    func testVersionsAreOrderedAsSemanticVersions() {
        let ordered = ["1.0.0-beta.2", "1.0.0-beta.9", "1.0.0-beta.10", "1.0.0", "1.0.1", "1.2.0-beta.1", "1.2.0", "2.0.0"]
        for (a, b) in zip(ordered, ordered.dropFirst()) {
            XCTAssertEqual(Updates.compare(a, b), -1, "\(a) < \(b)")
            XCTAssertEqual(Updates.compare(b, a), 1, "\(b) > \(a)")
        }
        XCTAssertEqual(Updates.compare("1.2.0+build.5", "1.2.0"), 0)
        XCTAssertEqual(Updates.compare("x", "1.0.0"), -1)
        XCTAssertNil(Updates.parse("1.2"))
        XCTAssertNil(Updates.parse("1.2.0-"))
        XCTAssertNil(Updates.parse("1.2.a"))
    }

    func testVersionLabelsAreWrittenAsTheUIWritesThem() {
        XCTAssertEqual(Updates.label("1.2.0"), "v1.2.0")
        XCTAssertEqual(Updates.label("1.2.0-beta.3"), "v1.2.0 Beta 3")
    }

    func testTheAutomaticCheckIsDueAtMostAboutOnceADay() {
        let now = Date()
        XCTAssertTrue(Updates.due(lastChecked: nil, now: now))
        XCTAssertFalse(Updates.due(lastChecked: now.addingTimeInterval(-19 * 3600), now: now))
        XCTAssertTrue(Updates.due(lastChecked: now.addingTimeInterval(-20 * 3600), now: now))
        // The clock was set back
        XCTAssertTrue(Updates.due(lastChecked: now.addingTimeInterval(3600), now: now))
    }

    func testACheckThatCannotReachGitHubOnlyReportsWhy() async {
        let failed = await Updates.check(current: "1.2.0") { _ in (Data(), 403) }
        XCTAssertEqual(failed, Updates.Result(newer: nil, error: "HTTP 403"))
        let list = try! JSONSerialization.data(withJSONObject: [release("v1.3.0")])
        let found = await Updates.check(current: "1.2.0") { url in
            XCTAssertEqual(url, Updates.releasesAPI)
            return (list, 200)
        }
        XCTAssertEqual(found.newer?.version, "1.3.0")
        let reply = Updates.reply(found)
        XCTAssertEqual((reply["newer"] as? [String: Any])?["version"] as? String, "1.3.0")
        XCTAssertTrue(reply["error"] is NSNull)
    }

    // MARK: UpdateCenter

    private final class Events {
        var all: [(String, [String: Any])] = []
        var names: [String] { all.map(\.0) }
    }

    private func center(_ settings: Settings, _ events: Events, opened: ((URL) -> Void)? = nil) -> UpdateCenter {
        UpdateCenter(
            settings: settings, current: "1.2.0", isTestInstance: false, emit: { events.all.append(($0, $1)) },
            fetch: { _ in XCTFail("no network in this test"); return (Data(), 500) }, openURL: opened ?? { _ in })
    }

    func testANewVersionIsShownOnThePageAndTheMenuBarUntilSkippedAndASkippedOneStaysQuiet() {
        let settings = Settings.load(from: makeTempDir() + "/settings.json")
        let events = Events()
        let updates = center(settings, events)
        var shown: [String?] = []
        updates.show = { shown.append($0?.version) }
        let newer = Updates.Release(version: "1.3.0", url: "https://github.com/Moy339339/SnipToss/releases/tag/v1.3.0", prerelease: false)
        updates.found(newer)
        XCTAssertEqual(events.names, ["updateAvailable"])
        XCTAssertEqual(events.all.first?.1["version"] as? String, "1.3.0")
        // The page reloaded: it hears of it again
        updates.pageReady()
        XCTAssertEqual(events.names, ["updateAvailable", "updateAvailable"])
        updates.skip()
        XCTAssertEqual(settings.current.updateSkipped, "1.3.0")
        XCTAssertEqual(events.names.last, "updateDismissed")
        XCTAssertEqual(shown, ["1.3.0", nil])
        // Found again by a later check: still skipped
        updates.found(newer)
        XCTAssertNil(updates.newer)
        XCTAssertEqual(Settings.load(from: settings.storePath).current.updateSkipped, "1.3.0")
        // A newer one than the skipped one is shown again
        updates.found(Updates.Release(version: "1.3.1", url: newer.url, prerelease: false))
        XCTAssertEqual(updates.newer?.version, "1.3.1")
    }

    func testSwitchingTheAutomaticCheckOffTakesTheNoticeAway() {
        let settings = Settings.load(from: makeTempDir() + "/settings.json")
        let events = Events()
        let updates = center(settings, events)
        updates.found(Updates.Release(version: "1.3.0", url: "https://github.com/x", prerelease: false))
        updates.prefsChanged()
        XCTAssertNotNil(updates.newer)
        settings.update { $0.prefs = ["updateCheck": false] }
        updates.prefsChanged()
        XCTAssertNil(updates.newer)
        XCTAssertEqual(events.names, ["updateAvailable", "updateDismissed"])
        // Off: the automatic check never asks GitHub (the fetch stand-in fails the test if it is called)
        updates.autoCheck()
    }

    func testDownloadOpensTheReleasePageAndOnlyAnHttpsOne() {
        let settings = Settings.load(from: makeTempDir() + "/settings.json")
        var opened: [URL] = []
        let updates = center(settings, Events(), opened: { opened.append($0) })
        updates.openDownload()
        updates.found(Updates.Release(version: "1.3.0", url: "https://github.com/Moy339339/SnipToss/releases/tag/v1.3.0", prerelease: false))
        updates.openDownload()
        updates.found(Updates.Release(version: "1.3.1", url: "file:///etc", prerelease: false))
        updates.openDownload()
        XCTAssertEqual(opened.map(\.absoluteString), ["https://github.com/Moy339339/SnipToss/releases/tag/v1.3.0"])
    }

    func testATestInstanceNeverChecksOnItsOwn() {
        let settings = Settings.load(from: makeTempDir() + "/settings.json")
        let updates = UpdateCenter(
            settings: settings, current: "1.2.0", isTestInstance: true, emit: { _, _ in },
            fetch: { _ in XCTFail("a test instance went online"); return (Data(), 500) })
        updates.autoCheck()
    }

    // MARK: Menu bar item

    func testTheMenuBarMenuStartsWithDownloadAndSkipWhileANewVersionIsKnown() {
        var clicks: [String] = []
        let item = StatusItemController(
            showWindow: {}, openSettings: {}, quit: {}, download: { clicks.append("download") }, skip: { clicks.append("skip") })
        XCTAssertEqual(item.makeMenu().items.count, 5)
        item.showUpdate(Updates.Release(version: "1.3.0-beta.2", url: "https://github.com/x", prerelease: true))
        let menu = item.makeMenu()
        XCTAssertEqual(menu.items.count, 8)
        XCTAssertEqual(menu.items[0].title, ShellText.t("shell.tray.updateDownload", ["version": "v1.3.0 Beta 2"]))
        XCTAssertEqual(menu.items[1].title, ShellText.t("shell.tray.updateSkip"))
        XCTAssertTrue(menu.items[2].isSeparatorItem)
        for entry in menu.items.prefix(2) { _ = (entry.target as? NSObject)?.perform(entry.action, with: entry) }
        XCTAssertEqual(clicks, ["download", "skip"])
        item.showUpdate(nil)
        XCTAssertEqual(item.makeMenu().items.count, 5)
    }

    func testTheIconWithTheDotIsStillATemplateOfTheSameSize() throws {
        let symbol = try XCTUnwrap(NSImage(systemSymbolName: "camera.viewfinder", accessibilityDescription: nil))
        let dotted = StatusIcon.withDot(symbol)
        XCTAssertTrue(dotted.isTemplate)
        XCTAssertEqual(dotted.size, symbol.size)
    }
}
