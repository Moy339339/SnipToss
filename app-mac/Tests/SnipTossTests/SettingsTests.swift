import XCTest

@testable import SnipToss

/// Reading and writing the settings file. A failed read (corrupt or locked) must not be treated as empty settings, or the next settings
/// change would write the empty list back and lose the whole library
final class SettingsTests: SnipTestCase {
    private func withLibrary(_ path: String, _ entries: [String]) -> Settings {
        let s = Settings.load(from: path)
        s.update { v in v.library = entries.map { LibraryEntry(path: $0) } }
        return s
    }

    private func libraryOnDisk(_ path: String) throws -> [String] {
        let data = try Data(contentsOf: URL(fileURLWithPath: path))
        let root = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        let items = try XCTUnwrap(root["Library"] as? [[String: Any]])
        return items.compactMap { $0["Path"] as? String }
    }

    private func keptCorruptFiles(in dir: String) -> [String] {
        names(in: dir).filter { $0.hasPrefix("settings.corrupt-") && $0.hasSuffix(".json") }
    }

    func testFirstRunWithNoSettingsFileUsesDefaultsAndShowsNoNotice() {
        let dir = makeTempDir()
        let s = Settings.load(from: dir + "/settings.json")
        XCTAssertTrue(s.library.isEmpty)
        XCTAssertNil(s.startupNotice)
        XCTAssertEqual(s.migrations, Settings.latestMigration)
    }

    func testAutomaticUpdateCheckIsOffOnlyWhenWrittenAsFalse() {
        // The settings file stores only changed items (storedPrefs in the UI's prefs.ts): absent means the default (on);
        // a hand-corrupted value counts as the default too
        let dir = makeTempDir()
        let path = dir + "/settings.json"
        let cases: [(String, Bool)] = [
            ("{ }", true),
            ("{ \"Prefs\": { } }", true),
            ("{ \"Prefs\": { \"updateCheck\": false } }", false),
            ("{ \"Prefs\": { \"updateCheck\": true } }", true),
            ("{ \"Prefs\": { \"updateCheck\": \"no\" } }", true),
            ("{ \"Prefs\": { \"updateCheck\": 0 } }", true),
        ]
        for (json, on) in cases {
            writeText(json, to: path)
            XCTAssertEqual(Settings.load(from: path).current.updateCheck, on, json)
        }
    }

    func testMoreFormatsIsOnOnlyWhenWrittenAsTrue() {
        let dir = makeTempDir()
        let path = dir + "/settings.json"
        let cases: [(String, Bool)] = [
            ("{ }", false),
            ("{ \"Prefs\": { \"moreFormats\": true } }", true),
            ("{ \"Prefs\": { \"moreFormats\": 1 } }", false),
            ("{ \"Prefs\": { \"moreFormats\": \"yes\" } }", false),
        ]
        for (json, on) in cases {
            writeText(json, to: path)
            XCTAssertEqual(Settings.load(from: path).current.moreFormats, on, json)
        }
    }

    func testLanguageComesFromThePreferencesAndIsNilWhenNeverChosen() {
        let dir = makeTempDir()
        let path = dir + "/settings.json"
        writeText("{ \"Prefs\": { \"language\": \"en\" } }", to: path)
        XCTAssertEqual(Settings.load(from: path).current.language, "en")
        writeText("{ \"Prefs\": { \"language\": 5 } }", to: path)
        XCTAssertNil(Settings.load(from: path).current.language)
        XCTAssertNil(Settings.load(from: dir + "/none.json").current.language)
    }

    func testKindsAndSkippedFoldersTakeTheirDefaultsAndFollowTheUserChoice() {
        let dir = makeTempDir()
        let path = dir + "/settings.json"
        let fresh = Settings.load(from: path).current
        XCTAssertEqual(fresh.enabledKinds, ["image", "video"])
        XCTAssertEqual(fresh.skipDirs, ["node_modules", "bin", "obj", "dist", "build", "__pycache__", "venv"])
        // A kind the settings do not mention takes its default; More formats adds the "more" kind
        writeText(
            "{ \"Prefs\": { \"kinds\": { \"video\": false, \"pdf\": true, \"future\": true }, "
                + "\"moreFormats\": true, \"skipDirs\": [\"Out\", \"\", 5] } }",
            to: path)
        let chosen = Settings.load(from: path).current
        XCTAssertEqual(chosen.enabledKinds, ["image", "pdf", "future", "more"])
        XCTAssertEqual(chosen.skipDirs, ["out"], "folder names are kept lower case")
    }

    func testMarkColorAcceptsOnlyAHexColor() {
        let dir = makeTempDir()
        let path = dir + "/settings.json"
        let cases: [(String, String)] = [
            ("{ }", "#ff6a3d"),
            ("{ \"Prefs\": { \"markColor\": \"#12aBcD\" } }", "#12aBcD"),
            ("{ \"Prefs\": { \"markColor\": \"red\" } }", "#ff6a3d"),
            ("{ \"Prefs\": { \"markColor\": \"#12345\" } }", "#ff6a3d"),
            ("{ \"Prefs\": { \"markColor\": \"#12345g\" } }", "#ff6a3d"),
        ]
        for (json, color) in cases {
            writeText(json, to: path)
            XCTAssertEqual(Settings.load(from: path).current.markColor, color, json)
        }
    }

    func testTheTimeOfTheLastUpdateCheckIsPersisted() {
        let dir = makeTempDir()
        let path = dir + "/settings.json"
        let at = Date(timeIntervalSince1970: 1_700_000_000)
        Settings.load(from: path).update { v in v.updatesCheckedAt = at }
        XCTAssertEqual(Settings.load(from: path).updatesCheckedAt, at)
    }

    func testSettingsJustWrittenCanBeReadBack() {
        let dir = makeTempDir()
        let path = dir + "/settings.json"
        _ = withLibrary(path, ["/e/a", "/e/b"])
        let again = Settings.load(from: path)
        XCTAssertEqual(again.library.map { $0.path }, ["/e/a", "/e/b"])
        XCTAssertNil(again.startupNotice)
    }

    func testEveryWriteKeepsThePreviousVersionAsABackup() throws {
        let dir = makeTempDir()
        let path = dir + "/settings.json"
        let s = withLibrary(path, ["/e/a"])
        s.update { v in v.library.append(LibraryEntry(path: "/e/b")) }
        XCTAssertEqual(try libraryOnDisk(path), ["/e/a", "/e/b"])
        XCTAssertEqual(try libraryOnDisk(path + ".bak"), ["/e/a"])
    }

    func testWritingLeavesNoTempFileBehind() {
        let dir = makeTempDir()
        let path = dir + "/settings.json"
        let s = withLibrary(path, ["/e/a"])
        s.update { v in v.topmost = true }
        XCTAssertEqual(tempFiles(in: dir), [])
    }

    func testAFileCorruptAtStartupIsPreservedRestoredFromTheBackupAndTheUserIsTold() throws {
        let dir = makeTempDir()
        let path = dir + "/settings.json"
        let s = withLibrary(path, ["/e/a"])
        s.update { v in v.library.append(LibraryEntry(path: "/e/b")) }  // .bak = [a]
        writeText("{ 坏了", to: path)

        let loaded = Settings.load(from: path)

        XCTAssertEqual(loaded.library.map { $0.path }, ["/e/a"])
        XCTAssertNotNil(loaded.startupNotice)
        let kept = keptCorruptFiles(in: dir)
        XCTAssertEqual(kept.count, 1)
        XCTAssertEqual(readText(dir + "/" + (kept.first ?? "")), "{ 坏了")
    }

    func testAFileCorruptAtStartupWithNoBackupUsesDefaultsPreservesTheOriginalAndTellsTheUser() {
        let dir = makeTempDir()
        let path = dir + "/settings.json"
        writeText("", to: path)

        let loaded = Settings.load(from: path)

        XCTAssertTrue(loaded.library.isEmpty)
        XCTAssertTrue(loaded.startupNotice?.contains("default settings") == true, loaded.startupNotice ?? "no notice")
        XCTAssertEqual(keptCorruptFiles(in: dir).count, 1)
    }

    func testAFileWithAWrongTypeIsTreatedAsCorrupt() {
        // A damaged library must not be quietly read as an empty one
        let dir = makeTempDir()
        let path = dir + "/settings.json"
        for json in ["{ \"Library\": 5 }", "{ \"Library\": [ 1 ] }", "{ \"Topmost\": \"yes\" }", "{ \"Prefs\": [] }", "[ ]", "null"] {
            writeText(json, to: path)
            let loaded = Settings.load(from: path)
            XCTAssertTrue(loaded.library.isEmpty, json)
            XCTAssertNotNil(loaded.startupNotice, json)
            XCTAssertFalse(FileManager.default.fileExists(atPath: path), "the damaged original is renamed and kept: \(json)")
            for kept in keptCorruptFiles(in: dir) { try? FileManager.default.removeItem(atPath: dir + "/" + kept) }
        }
    }

    func testAFileCorruptedWhileInUseDoesNotEmptyTheLibraryWhenSettingsChange() throws {
        let dir = makeTempDir()
        let path = dir + "/settings.json"
        let s = withLibrary(path, ["/e/a", "/e/b"])
        writeText("null", to: path)

        s.update { v in v.topmost = true }

        XCTAssertEqual(try libraryOnDisk(path), ["/e/a", "/e/b"])
        XCTAssertTrue(s.current.topmost)
        XCTAssertEqual(keptCorruptFiles(in: dir).count, 1)
    }

    func testAFileThatCannotBeReadDoesNotEmptyTheLibraryAndTheOriginalIsIntactOnceItCan() throws {
        try XCTSkipIf(getuid() == 0, "file permissions do not apply to root")
        let dir = makeTempDir()
        let path = dir + "/settings.json"
        let s = withLibrary(path, ["/e/a", "/e/b"])
        let before = readText(path)

        XCTAssertEqual(chmod(path, 0o000), 0)
        s.update { v in v.library.append(LibraryEntry(path: "/e/c")) }
        XCTAssertEqual(chmod(path, 0o644), 0)

        // Memory has the new state; that write never reached the disk, but the original list is still there
        // and was not overwritten by empty settings
        XCTAssertEqual(s.library.map { $0.path }, ["/e/a", "/e/b", "/e/c"])
        XCTAssertEqual(readText(path), before)
        // By the next settings change the file can be read: the entry that was not saved last time is written too
        // and is not wiped by the old content on disk
        s.update { v in v.topmost = true }
        XCTAssertEqual(try libraryOnDisk(path), ["/e/a", "/e/b", "/e/c"])
    }

    func testWhenTheWriteDoesNotReachTheDiskTheCallerIsToldAndALaterChangeSavesOnceItCan() throws {
        // A UI settings change that was not saved must be reported (otherwise only the log knew and the change was noticed only after a restart)
        try XCTSkipIf(getuid() == 0, "folder permissions do not apply to root")
        let dir = makeTempDir()
        let path = dir + "/settings.json"
        let s = withLibrary(path, ["/e/a"])
        XCTAssertEqual(chmod(dir, 0o555), 0)
        defer { _ = chmod(dir, 0o755) }
        XCTAssertFalse(s.update { v in v.topmost = true })
        XCTAssertEqual(chmod(dir, 0o755), 0)
        XCTAssertTrue(s.update { v in v.topmost = false })
    }

    func testAChangeThatThrowsWritesNothingAndChangesNothing() throws {
        struct Refused: Error {}
        let dir = makeTempDir()
        let path = dir + "/settings.json"
        let s = withLibrary(path, ["/e/a"])
        let before = readText(path)
        XCTAssertThrowsError(
            try s.update { v in
                v.topmost = true
                throw Refused()
            })
        XCTAssertFalse(s.current.topmost)
        XCTAssertEqual(readText(path), before)
    }

    func testUIPreferencesAndScreenCaptureSettingsRoundTrip() {
        let dir = makeTempDir()
        let path = dir + "/settings.json"
        Settings.load(from: path).update { v in
            v.prefs = ["author": "小王", "fresh": ["since": ["/e/a": 123]]]
            v.capture.hotkey = "Ctrl+Alt+K"
            v.capture.hotkeyCustom = true
            v.capture.keepInTray = false
            v.capture.hideWindow = false
            v.capture.notesInImage = false
            v.capture.folder = "/e/shots"
        }
        let back = Settings.load(from: path)
        XCTAssertEqual(back.prefs?["author"] as? String, "小王")
        let since = (back.prefs?["fresh"] as? [String: Any])?["since"] as? [String: Any]
        XCTAssertEqual(since?["/e/a"] as? Int, 123)
        let c = back.capture
        XCTAssertEqual(c.hotkey, "Ctrl+Alt+K")
        XCTAssertTrue(c.hotkeyCustom)
        XCTAssertFalse(c.keepInTray)
        XCTAssertFalse(c.hideWindow)
        XCTAssertFalse(c.notesInImage)
        XCTAssertEqual(c.folder, "/e/shots")
    }

    func testAnItemAddedByAnotherWindowIsNotOverwrittenByThisOnesStaleCopy() throws {
        let dir = makeTempDir()
        let path = dir + "/settings.json"
        let mine = withLibrary(path, ["/e/a"])
        let other = Settings.load(from: path)
        other.update { v in v.library.append(LibraryEntry(path: "/e/b")) }

        mine.update { v in v.topmost = true }

        XCTAssertEqual(try libraryOnDisk(path), ["/e/a", "/e/b"])
    }

    func testMissingKeysTakeTheirDefaults() {
        let dir = makeTempDir()
        let path = dir + "/settings.json"
        writeText("{ }", to: path)
        let v = Settings.load(from: path).current
        XCTAssertTrue(v.library.isEmpty)
        XCTAssertNil(v.selected)
        XCTAssertNil(v.prefs)
        XCTAssertEqual(v.migrations, 0)
        XCTAssertTrue(v.placement.left.isNaN)
        XCTAssertEqual(v.placement.width, 1360)
        XCTAssertEqual(v.placement.height, 860)
        XCTAssertFalse(v.placement.maximized)
        XCTAssertFalse(v.topmost)
        XCTAssertEqual(v.capture.hotkey, "Control+Ctrl+Alt+A")
        XCTAssertTrue(v.capture.keepInTray)
        XCTAssertTrue(v.capture.hideWindow)
        XCTAssertTrue(v.capture.notesInImage)
        XCTAssertNil(v.capture.folder)
        XCTAssertNil(v.updatesCheckedAt)
    }

    func testAFileWrittenByTheWindowsShellIsRead() {
        // PascalCase keys, positions that were never recorded as "NaN", and the read-only values the Windows serializer also writes
        let dir = makeTempDir()
        let path = dir + "/settings.json"
        writeText(
            """
            {
              "Library": [ { "Path": "/Users/me/p", "Pinned": true }, { "Path": "/Users/me/q.png", "Pinned": false } ],
              "Expanded": [ "/Users/me/p/a" ],
              "Collapsed": [],
              "Selected": "/Users/me/q.png",
              "Placement": { "Left": "NaN", "Top": 12.5, "Width": 1200, "Height": 800, "Maximized": true },
              "Topmost": true,
              "Prefs": { "language": "en", "moreFormats": true, "kinds": { "video": false } },
              "Capture": { "Hotkey": "Ctrl+Alt+K", "HotkeyCustom": true, "KeepInTray": false, "TrayHintShown": true, "SelectHintDone": true,
                "HideWindow": false, "NotesInImage": false, "Folder": "/Users/me/shots" },
              "SkipDirs": [ "node_modules" ],
              "MarkColor": "#ff6a3d",
              "UpdatesCheckedAt": "2026-10-23T01:02:03Z",
              "Migrations": 1
            }
            """, to: path)

        let s = Settings.load(from: path)
        let v = s.current

        XCTAssertNil(s.startupNotice)
        XCTAssertEqual(v.library.map { $0.path }, ["/Users/me/p", "/Users/me/q.png"])
        XCTAssertEqual(v.library.map { $0.pinned }, [true, false])
        XCTAssertEqual(v.expanded, ["/Users/me/p/a"])
        XCTAssertEqual(v.collapsed, [])
        XCTAssertEqual(v.selected, "/Users/me/q.png")
        XCTAssertTrue(v.placement.left.isNaN)
        XCTAssertEqual(v.placement.top, 12.5)
        XCTAssertEqual(v.placement.width, 1200)
        XCTAssertEqual(v.placement.height, 800)
        XCTAssertTrue(v.placement.maximized)
        XCTAssertTrue(v.topmost)
        XCTAssertEqual(v.language, "en")
        XCTAssertEqual(v.enabledKinds, ["image", "more"])
        XCTAssertEqual(v.capture.hotkey, "Ctrl+Alt+K")
        XCTAssertTrue(v.capture.hotkeyCustom)
        XCTAssertFalse(v.capture.keepInTray)
        XCTAssertTrue(v.capture.trayHintShown)
        XCTAssertTrue(v.capture.selectHintDone)
        XCTAssertFalse(v.capture.hideWindow)
        XCTAssertFalse(v.capture.notesInImage)
        XCTAssertEqual(v.capture.folder, "/Users/me/shots")
        XCTAssertEqual(v.updatesCheckedAt, ISO8601DateFormatter().date(from: "2026-10-23T01:02:03Z"))
        XCTAssertEqual(v.migrations, 1)
    }

    func testTheFileIsWrittenWithTheWindowsKeysInTheWindowsOrderAndTheSharedJSONFormat() throws {
        let dir = makeTempDir()
        let path = dir + "/settings.json"
        let s = Settings.load(from: path)
        s.update { v in
            v.library = [LibraryEntry(path: "/e/a b", pinned: true)]
            v.prefs = ["note": "say \"hi\"\n\t/ done", "zeta": 1, "alpha": [true, NSNull()] as [Any]]
        }

        let bytes = try Data(contentsOf: URL(fileURLWithPath: path))
        XCTAssertNotEqual(bytes.first, 0xEF, "no byte order mark")
        let text = String(decoding: bytes, as: UTF8.self)
        XCTAssertTrue(text.hasPrefix("{\n  \"Library\": [\n    {\n      \"Path\": \"/e/a b\",\n      \"Pinned\": true\n    }\n  ],\n"), text)
        XCTAssertTrue(text.hasSuffix("}\n"), "ends with one newline")
        XCTAssertTrue(text.contains("  \"Expanded\": [],\n"))
        XCTAssertTrue(text.contains("  \"Selected\": null,\n"))
        XCTAssertTrue(text.contains("    \"Left\": \"NaN\",\n"))
        XCTAssertTrue(text.contains("    \"Width\": 1360,\n"))
        XCTAssertTrue(text.contains("    \"note\": \"say \\\"hi\\\"\\n\\t/ done\",\n"), "slashes are not escaped")
        XCTAssertTrue(text.contains("    \"alpha\": [\n      true,\n      null\n    ],\n"), "preferences keep booleans and null, keys sorted")
        XCTAssertTrue(text.contains("  \"UpdatesCheckedAt\": null,\n  \"Migrations\": 1\n}"))
        let keys = [
            "\"Library\"", "\"Expanded\"", "\"Collapsed\"", "\"Selected\"", "\"Placement\"", "\"Topmost\"", "\"Prefs\"", "\"Capture\"",
            "\"UpdatesCheckedAt\"", "\"Migrations\"",
        ]
        let positions = keys.map { (text as NSString).range(of: "  " + $0 + ":").location }
        XCTAssertFalse(positions.contains(NSNotFound), text)
        XCTAssertEqual(positions, positions.sorted(), "keys are in the Windows order")
        // Whatever reads it must see the same values
        let back = Settings.load(from: path).current
        XCTAssertEqual(back.library.first?.path, "/e/a b")
        XCTAssertEqual(back.prefs?["note"] as? String, "say \"hi\"\n\t/ done")
    }

    func testPreferencesAreKeptExactlyAsTheUIGaveThem() throws {
        let dir = makeTempDir()
        let path = dir + "/settings.json"
        let json = "{\"flag\":true,\"off\":false,\"n\":3,\"f\":1.5,\"big\":12345678901,\"nothing\":null,\"list\":[1,\"x\",null,{\"k\":[]}]}"
        let sent = try JSONSerialization.jsonObject(with: Data(json.utf8))
        Settings.load(from: path).update { v in v.prefs = sent as? [String: Any] }

        let prefs = try XCTUnwrap(Settings.load(from: path).prefs)
        XCTAssertEqual(jsonBool(prefs["flag"]), true)
        XCTAssertEqual(jsonBool(prefs["off"]), false)
        XCTAssertNil(jsonBool(prefs["n"]), "a number stays a number")
        XCTAssertEqual(prefs["n"] as? Int, 3)
        XCTAssertEqual(prefs["f"] as? Double, 1.5)
        XCTAssertEqual(prefs["big"] as? Int64, 12_345_678_901)
        XCTAssertTrue(prefs["nothing"] is NSNull)
        let list = try XCTUnwrap(prefs["list"] as? [Any])
        XCTAssertEqual(list.count, 4)
        XCTAssertEqual(list[1] as? String, "x")
        XCTAssertTrue(list[2] is NSNull)
        let inner = (list[3] as? [String: Any])?["k"] as? [Any]
        XCTAssertEqual(inner?.count, 0)
    }
}
