import XCTest

@testable import SnipToss

/// The shell's own text: ICU messages formatted by the UI's intl-messageformat run in JavaScriptCore, and the choice of language. The
/// resources are built by `node app-mac/scripts/build-resources.mjs` (SNIPTOSS_RESOURCES_DIR points at them); without them these tests
/// are skipped on a developer's machine and fail on CI
final class MessageFormatterTests: XCTestCase {
    override func tearDown() {
        ShellLocale.reset()
        super.tearDown()
    }

    private func repositoryRoot() -> URL {
        // .../app-mac/Tests/SnipTossTests/MessageFormatterTests.swift -> the repository root is four levels up
        var root = URL(fileURLWithPath: #filePath)
        for _ in 0..<4 { root.deleteLastPathComponent() }
        return root
    }

    private func formatter() throws -> MessageFormatter {
        guard let dir = AppResources.directory(), FileManager.default.fileExists(atPath: dir.appendingPathComponent("shell-messages.js").path)
        else { throw XCTSkip("the shell's resources are not built (node app-mac/scripts/build-resources.mjs, SNIPTOSS_RESOURCES_DIR)") }
        return try MessageFormatter(scriptAt: dir.appendingPathComponent("shell-messages.js"))
    }

    /// On CI the resources are built before the tests: if they are not there it is a failure, not a skip
    private func requireResources() throws {
        if ProcessInfo.processInfo.environment["GITHUB_ACTIONS"] == "true" {
            let dir = AppResources.directory()
            XCTAssertTrue(
                dir.map { FileManager.default.fileExists(atPath: $0.appendingPathComponent("shell-messages.js").path) } ?? false,
                "the resources were not built before the tests")
        }
    }

    // MARK: What the engine can do

    func testTheEngineHasTheInternationalizationObjectsTheMessagesNeed() throws {
        try requireResources()
        let engine = try formatter()
        XCTAssertEqual(engine.evaluate("typeof Intl"), "object")
        XCTAssertEqual(engine.evaluate("typeof Intl.PluralRules"), "function")
        XCTAssertEqual(engine.evaluate("typeof Intl.NumberFormat"), "function")
        XCTAssertEqual(engine.evaluate("typeof Intl.DateTimeFormat"), "function")
        // Plural categories are the CLDR rules: Russian has four of them, French counts 0 as one, Japanese has none
        XCTAssertEqual(engine.evaluate("[1, 2, 5, 21, 22, 101].map((n) => new Intl.PluralRules('ru').select(n)).join()"), "one,few,many,one,few,one")
        XCTAssertEqual(engine.evaluate("[0, 1, 2].map((n) => new Intl.PluralRules('fr').select(n)).join()"), "one,one,other")
        XCTAssertEqual(engine.evaluate("[0, 1, 5].map((n) => new Intl.PluralRules('ja').select(n)).join()"), "other,other,other")
        XCTAssertEqual(engine.evaluate("new Intl.NumberFormat('de').format(1234.5)"), "1.234,5")
        print("JavaScriptCore Intl: \(engine.evaluate("Intl.DateTimeFormat().resolvedOptions().locale") ?? "?")")
    }

    func testPluralsAndSelectsFollowTheLanguage() throws {
        try requireResources()
        let engine = try formatter()
        let plural = "{n, plural, one {# файл} few {# файла} many {# файлов} other {# файла}}"
        XCTAssertEqual(try engine.format(locale: "ru", pattern: plural, args: ["n": 21]), "21 файл")
        XCTAssertEqual(try engine.format(locale: "ru", pattern: plural, args: ["n": 22]), "22 файла")
        XCTAssertEqual(try engine.format(locale: "ru", pattern: plural, args: ["n": 5]), "5 файлов")
        let select = "{kind, select, a {Alpha} b {Beta} other {Other}} {name}"
        XCTAssertEqual(try engine.format(locale: "en", pattern: select, args: ["kind": "b", "name": "x"]), "Beta x")
        XCTAssertEqual(try engine.format(locale: "en", pattern: select, args: ["kind": "zzz", "name": "x"]), "Other x")
    }

    func testABrokenMessageThrowsInsteadOfBringingTheShellDown() throws {
        try requireResources()
        let engine = try formatter()
        XCTAssertThrowsError(try engine.format(locale: "en", pattern: "{n, plural, one {#", args: ["n": 1]))
        // The engine is still usable afterwards
        XCTAssertEqual(try engine.format(locale: "en", pattern: "Hello {name}", args: ["name": "Mac"]), "Hello Mac")
    }

    func testAScriptThatIsNotTheFormatterIsRefused() {
        XCTAssertThrowsError(try MessageFormatter(script: "var x = 1;"))
        XCTAssertThrowsError(try MessageFormatter(script: "this is not javascript"))
    }

    // MARK: The UI's golden messages

    /// Every message the shell shows, in every language and with every plural and select value (tests/golden/messages.json, computed by the
    /// UI's own test with the reference implementation): the shell must format each one word for word the same
    func testEveryGoldenMessageReadsTheSameAsInTheUI() throws {
        try requireResources()
        _ = try formatter()
        let data = try Data(contentsOf: repositoryRoot().appendingPathComponent("tests/golden/messages.json"))
        let golden = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let cases = try XCTUnwrap(golden["cases"] as? [[String: Any]])
        XCTAssertGreaterThan(cases.count, 3000)
        var different: [String] = []
        for c in cases {
            let locale = try XCTUnwrap(c["locale"] as? String)
            let key = try XCTUnwrap(c["key"] as? String)
            let args = try XCTUnwrap(c["args"] as? [String: Any])
            let want = try XCTUnwrap(c["text"] as? String)
            let got = ShellLocale.rawText(key, in: locale, args)
            if got != want { different.append("\(locale) \(key) \(args): got \(got ?? "nil"), want \(want)") }
        }
        XCTAssertEqual(different.count, 0, "\(different.count) of \(cases.count) differ, first: \(different.prefix(5))")
    }

    /// What the Mac shows: the shortcuts inside the messages are written the Mac way, by the UI's own rule (macKeys.ts), with each
    /// language's key names; messages without a shortcut are the same as the golden ones
    func testShortcutsInTheMessagesAreWrittenTheMacWay() throws {
        try requireResources()
        _ = try formatter()
        XCTAssertEqual(ShellLocale.text("capture.tool.undo", in: "en"), "Undo (⌘Z)")
        XCTAssertEqual(ShellLocale.text("capture.tool.undo", in: "de"), "Rückgängig (⌘Z)")
        XCTAssertEqual(ShellLocale.text("capture.tool.undo", in: "zh-CN"), "撤销（⌘Z）")
        // The UI rewrites the messages before formatting them, so a key that is a placeholder keeps its space (the composer's tooltip)
        XCTAssertEqual(ShellLocale.text("composer.categoryTitle", in: "en", ["name": "Change", "n": 1]), "Change (⌥ 1)")
        XCTAssertEqual(ShellLocale.text("composer.keys", in: "en"), "Enter to save · ⇧ Enter for a new line")
        XCTAssertEqual(ShellLocale.text("capture.note.cancelTip", in: "en"), ShellLocale.rawText("capture.note.cancelTip", in: "en"))
        XCTAssertEqual(ShellLocale.macify("Press Ctrl V to paste", in: "en"), "Press ⌘V to paste")
    }

    // MARK: Which language

    private struct LocaleGolden: Decodable {
        struct Match: Decodable {
            let tag: String?
            let want: String
            init(from decoder: Decoder) throws {
                var container = try decoder.unkeyedContainer()
                tag = try container.decodeNil() ? nil : container.decode(String.self)
                want = try container.decode(String.self)
            }
        }
        struct Resolve: Decodable {
            let pref: String?
            let system: String?
            let want: String
        }
        let followSystem: [String]
        let match: [Match]
        let resolve: [Resolve]
    }

    /// The cases the UI and the Windows shell run too (tests/golden/locale.json)
    func testLanguageChoiceFollowsTheSharedRules() throws {
        let data = try Data(contentsOf: repositoryRoot().appendingPathComponent("tests/golden/locale.json"))
        let golden = try JSONDecoder().decode(LocaleGolden.self, from: data)
        XCTAssertEqual(ShellLocale.followSystem, golden.followSystem)
        XCTAssertFalse(golden.match.isEmpty)
        for m in golden.match { XCTAssertEqual(ShellLocale.match(m.tag), m.want, "match \(m.tag ?? "nil")") }
        XCTAssertFalse(golden.resolve.isEmpty)
        for r in golden.resolve {
            XCTAssertEqual(ShellLocale.resolve(pref: r.pref, system: r.system), r.want, "resolve \(r.pref ?? "nil") on \(r.system ?? "nil")")
        }
    }

    func testChangingTheLanguageIsReportedOnce() {
        XCTAssertEqual(ShellLocale.current, "en")
        XCTAssertTrue(ShellLocale.use(pref: "fr", system: "ja-JP"))
        XCTAssertEqual(ShellLocale.current, "fr")
        XCTAssertFalse(ShellLocale.use(pref: "fr", system: "de-AT"))
        XCTAssertTrue(ShellLocale.use(pref: nil, system: "de-AT"))
        XCTAssertEqual(ShellLocale.current, "de")
    }

    func testWithoutResourcesThereIsNoTextAndTheCallerUsesItsOwn() {
        let saved = ProcessInfo.processInfo.environment["SNIPTOSS_RESOURCES_DIR"]
        setenv("SNIPTOSS_RESOURCES_DIR", "/nonexistent-folder-for-test", 1)
        ShellLocale.reset()
        XCTAssertNil(ShellLocale.text("shell.tray.capture"))
        if let saved { setenv("SNIPTOSS_RESOURCES_DIR", saved, 1) } else { unsetenv("SNIPTOSS_RESOURCES_DIR") }
        ShellLocale.reset()
    }

    func testAKeyNoCatalogHasGivesNothing() throws {
        try requireResources()
        _ = try formatter()
        XCTAssertNil(ShellLocale.text("no.such.message"))
        XCTAssertEqual(ShellLocale.text("shell.tray.capture", in: "en"), "Capture Screen")
        // A language with no catalog file falls back to English
        XCTAssertEqual(ShellLocale.text("shell.tray.capture", in: "xx"), "Capture Screen")
    }
}
