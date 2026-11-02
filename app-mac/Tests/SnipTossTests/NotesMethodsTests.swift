import XCTest

@testable import SnipToss

/// The replies of the notes methods (`readHomes`, `writeAnnotation`, `writeText`, `writeBase64`, `deleteFile`, `pruneSnapshots`) with the
/// parameters as the page sends them, and the rules of docs/host-api.md they must keep: hard rule 1 (only `.sniptoss/` of a notes folder a
/// scan handed out), 3 (a notes file is written with a precondition), 3a (ordering numbers) and 4 (unique temp file, UTF-8 without a BOM)
final class NotesMethodsTests: SnipTestCase {
    /// The notes folders handed to the watcher, in order
    private final class Watched {
        private let guardLock = NSLock()
        private var homes: [String] = []

        func record(_ home: String) {
            guardLock.lock()
            homes.append(home)
            guardLock.unlock()
        }

        var all: [String] {
            guardLock.lock()
            defer { guardLock.unlock() }
            return homes
        }
    }

    private let rel = ".sniptoss/annotations/a.png.json"

    /// A notes folder a scan has handed out
    private func newHome() -> (home: String, homes: NotesHomes) {
        let home = makeTempDir()
        let homes = NotesHomes()
        homes.insert(home)
        return (home, homes)
    }

    private func args(_ home: String, _ path: String, _ more: [String: Any] = [:]) -> [String: Any] {
        var all: [String: Any] = ["home": home, "path": path]
        for (key, value) in more { all[key] = value }
        return all
    }

    /// Parameters as they arrive from the page: decoded from JSON, so a null is an NSNull
    private func fromJSON(_ json: String) throws -> Any {
        try JSONSerialization.jsonObject(with: Data(json.utf8))
    }

    private func code(of error: Error) -> String? {
        (error as? BridgeError)?.code
    }

    private func sha(_ text: String) -> String {
        NotesStore.textSha256(text) ?? ""
    }

    private func exists(_ path: String) -> Bool {
        FileManager.default.fileExists(atPath: path)
    }

    private func write(
        _ home: String, _ homes: NotesHomes, _ text: String, expect: Any? = nil, watched: Watched = Watched(), lockWait: TimeInterval = 10
    ) throws -> [String: Any] {
        var more: [String: Any] = ["text": text]
        if let expect = expect { more["expectSha256"] = expect }
        return try writeAnnotationReply(
            args(home, rel, more), homes: homes, lockWait: lockWait, startWatching: { watched.record($0) })
    }

    // MARK: readHomes

    func testReadHomesAnswersWithEachHomesNotesFilesProjectSettingsAndAnOrderingNumber() throws {
        let (home, homes) = newHome()
        writeText("甲", to: home + "/.sniptoss/annotations/a.png.json")
        writeText("乙", to: home + "/.sniptoss/annotations/b.png.json")
        writeText("{ \"language\": \"zh-CN\" }", to: home + "/.sniptoss/project.json")
        let empty = makeTempDir()
        homes.insert(empty)

        let reply = try readHomesReply([home + "/", empty], homes: homes, startWatching: { _ in })

        XCTAssertTrue(JSONSerialization.isValidJSONObject(reply), "the reply can be sent to the page")
        XCTAssertEqual(reply.count, 2)
        XCTAssertEqual(reply[0]["home"] as? String, home, "the home is answered in its normalized spelling")
        let notes = try XCTUnwrap(reply[0]["annotations"] as? [[String: Any]])
        XCTAssertEqual(notes.compactMap { $0["name"] as? String }, ["a.png.json", "b.png.json"])
        XCTAssertEqual(notes.compactMap { $0["text"] as? String }, ["甲", "乙"])
        let project = try XCTUnwrap(reply[0]["project"] as? [String: Any])
        XCTAssertEqual(project["text"] as? String, "{ \"language\": \"zh-CN\" }")
        XCTAssertEqual(project["review"] as? Bool, false)

        XCTAssertEqual(reply[1]["home"] as? String, empty)
        XCTAssertEqual((reply[1]["annotations"] as? [[String: Any]])?.count, 0)
        let none = try XCTUnwrap(reply[1]["project"] as? [String: Any])
        XCTAssertTrue(none["text"] is NSNull)
        XCTAssertEqual(none["review"] as? Bool, false)

        let first = try XCTUnwrap(reply[0]["seq"] as? Int)
        let second = try XCTUnwrap(reply[1]["seq"] as? Int)
        XCTAssertGreaterThan(second, first, "one counter for the whole program")
        let again = try readHomesReply([home], homes: homes, startWatching: { _ in })
        XCTAssertGreaterThan(try XCTUnwrap(again[0]["seq"] as? Int), second)
    }

    func testReadHomesLeavesOutFoldersNoScanHandedOutAndRejectsAMalformedPath() throws {
        let (home, homes) = newHome()
        let stranger = makeTempDir()
        writeText("秘密", to: stranger + "/.sniptoss/annotations/a.png.json")
        let watched = Watched()

        let reply = try readHomesReply([stranger, home], homes: homes, startWatching: { watched.record($0) })

        XCTAssertEqual(reply.compactMap { $0["home"] as? String }, [home])
        XCTAssertEqual(watched.all, [home], "a folder that was not handed out is not watched either")
        XCTAssertTrue(try readHomesReply([], homes: homes, startWatching: { _ in }).isEmpty)
        XCTAssertThrowsError(try readHomesReply(["/a\0b"], homes: homes, startWatching: { _ in })) { error in
            XCTAssertNotNil(error as? BridgeError)
            XCTAssertNil(code(of: error))
        }
    }

    func testReadHomesStartsWatchingBeforeItReads() throws {
        // A write that lands while the read is under way is announced by the watcher, because the watcher recorded the state before it
        let (home, homes) = newHome()
        writeText("早", to: home + "/.sniptoss/annotations/a.png.json")

        let reply = try readHomesReply(
            [home], homes: homes,
            startWatching: { watchedHome in
                self.writeText("晚", to: watchedHome + "/.sniptoss/annotations/late.json")
            })

        let names = (reply[0]["annotations"] as? [[String: Any]])?.compactMap { $0["name"] as? String }
        XCTAssertEqual(names, ["a.png.json", "late.json"])
    }

    func testReadHomesOfAFolderThatIsGoneAnswersWithNoNotes() throws {
        let (home, homes) = newHome()
        try FileManager.default.removeItem(atPath: home)
        let reply = try readHomesReply([home], homes: homes, startWatching: { _ in })
        XCTAssertEqual(reply.count, 1)
        XCTAssertEqual((reply[0]["annotations"] as? [[String: Any]])?.count, 0)
        XCTAssertTrue((reply[0]["project"] as? [String: Any])?["text"] is NSNull)
    }

    // MARK: writeAnnotation

    func testAWrittenNotesFileIsOnDiskAsSentAndTheReplyHasAnOrderingNumber() throws {
        let (home, homes) = newHome()
        let watched = Watched()

        let reply = try write(home, homes, "{\n  \"a\": 1\n}\n", expect: NSNull(), watched: watched)

        XCTAssertTrue(JSONSerialization.isValidJSONObject(reply))
        XCTAssertEqual(reply["written"] as? Bool, true)
        XCTAssertTrue(reply["current"] is NSNull)
        XCTAssertGreaterThan(try XCTUnwrap(reply["seq"] as? Int), 0)
        XCTAssertEqual(readText(home + "/" + rel), "{\n  \"a\": 1\n}\n")
        XCTAssertEqual(names(in: home + "/.sniptoss/annotations"), ["a.png.json"], "no lock or temp file is left")
        XCTAssertEqual(watched.all, [home], "watching starts once the first note exists")
        XCTAssertEqual(readText(home + "/.sniptoss/.gitignore"), DataDir.gitIgnore)
    }

    func testTheTextIsWrittenAsUtf8WithoutAByteOrderMark() throws {
        let (home, homes) = newHome()
        _ = try write(home, homes, "批注", expect: NSNull())
        XCTAssertEqual(Array(try Data(contentsOf: URL(fileURLWithPath: home + "/" + rel))), Array("批注".utf8))
    }

    func testWritingWhenTheDiskHoldsSomethingElseWritesNothingAndReturnsTheCurrentContent() throws {
        let (home, homes) = newHome()
        writeText("别人改的", to: home + "/" + rel)
        let watched = Watched()

        let reply = try write(home, homes, "我的", expect: sha("旧"), watched: watched)

        XCTAssertEqual(reply["written"] as? Bool, false)
        XCTAssertEqual(reply["current"] as? String, "别人改的")
        XCTAssertGreaterThan(try XCTUnwrap(reply["seq"] as? Int), 0)
        XCTAssertEqual(readText(home + "/" + rel), "别人改的")
        XCTAssertEqual(watched.all, [])
        XCTAssertFalse(exists(home + "/.sniptoss/.gitignore"), "a refused write has written nothing")
        XCTAssertEqual(names(in: home + "/.sniptoss/annotations"), ["a.png.json"])

        // The page merges and writes again with the fingerprint of what it was handed
        let again = try write(home, homes, "合并后", expect: sha("别人改的"))
        XCTAssertEqual(again["written"] as? Bool, true)
        XCTAssertGreaterThan(try XCTUnwrap(again["seq"] as? Int), try XCTUnwrap(reply["seq"] as? Int))
        XCTAssertEqual(readText(home + "/" + rel), "合并后")
    }

    func testRefusalOfAFileThatDoesNotExistGivesANullCurrent() throws {
        let (home, homes) = newHome()
        let reply = try write(home, homes, "x", expect: sha("旧"))
        XCTAssertEqual(reply["written"] as? Bool, false)
        XCTAssertTrue(reply["current"] is NSNull)
        XCTAssertFalse(exists(home + "/" + rel))
    }

    func testTheFingerprintInTheParametersMeansAbsentNoComparisonNullNoFileAndAStringTheContentRead() throws {
        let (home, homes) = newHome()
        writeText("在", to: home + "/" + rel)

        // Absent: no comparison, the write goes through
        XCTAssertEqual(try write(home, homes, "一")["written"] as? Bool, true)
        // null from JSON: the page believes the file does not exist, but it does
        let homeJSON = try jsonString(home)
        let nullParams = try fromJSON("{\"home\": \(homeJSON), \"path\": \"\(rel)\", \"text\": \"二\", \"expectSha256\": null}")
        let refused = try writeAnnotationReply(nullParams, homes: homes, startWatching: { _ in })
        XCTAssertEqual(refused["written"] as? Bool, false)
        XCTAssertEqual(refused["current"] as? String, "一")
        // Anything that is not a string counts as "does not exist" too
        XCTAssertEqual(try write(home, homes, "二", expect: 5)["written"] as? Bool, false)
        XCTAssertEqual(readText(home + "/" + rel), "一")
    }

    private func jsonString(_ text: String) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: [text], options: [])
        let array = String(decoding: data, as: UTF8.self)
        return String(array.dropFirst().dropLast())
    }

    func testWritingNeedsTheHomePathAndTextToBeGiven() {
        let (home, homes) = newHome()
        let incomplete: [[String: Any]] = [[:], ["home": home, "text": "x"], ["home": home, "path": rel], ["path": rel, "text": "x"]]
        for params in incomplete {
            XCTAssertThrowsError(try writeAnnotationReply(params, homes: homes, startWatching: { _ in })) { error in
                XCTAssertNotNil(error as? BridgeError)
            }
        }
        XCTAssertThrowsError(try writeAnnotationReply(nil, homes: homes, startWatching: { _ in }))
        XCTAssertEqual(names(in: home), [])
    }

    func testAWriteWhileAnotherWriterKeepsTheLockFailsAsBusyAndWritesNothing() throws {
        let (home, homes) = newHome()
        let full = home + "/" + rel
        let held = try FileLock.acquire(full)
        defer { held.release() }
        XCTAssertThrowsError(try write(home, homes, "x", expect: NSNull(), lockWait: 0.3)) { error in
            XCTAssertEqual(code(of: error), "busy")
        }
        XCTAssertFalse(exists(full))
    }

    func testAWriteIntoAFolderThatRefusesWritesIsDeniedAfterAboutASecond() throws {
        try XCTSkipIf(getuid() == 0, "folder permissions do not apply to root")
        let (home, homes) = newHome()
        let dir = home + "/.sniptoss/annotations"
        try FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        XCTAssertEqual(chmod(dir, 0o555), 0)
        defer { _ = chmod(dir, 0o755) }
        let started = Date()
        XCTAssertThrowsError(try write(home, homes, "x", expect: NSNull())) { error in
            XCTAssertEqual(code(of: error), "denied")
        }
        XCTAssertLessThan(Date().timeIntervalSince(started), 4.0)
    }

    func testTwoThreadsWritingTheSameNotesFileThroughTheBridgeLoseNothing() throws {
        // The page's loop: read, change, write with the fingerprint that was read, and when refused read again
        let (home, homes) = newHome()
        _ = try write(home, homes, "", expect: NSNull())
        let threads = 2
        let each = 30
        let failures = Counter()
        let refusals = Counter()
        let group = DispatchGroup()
        for thread in 0..<threads {
            group.enter()
            DispatchQueue.global().async {
                for k in 0..<each {
                    do {
                        while true {
                            let read = try readHomesReply([home], homes: homes, startWatching: { _ in })
                            let notes = read[0]["annotations"] as? [[String: Any]] ?? []
                            let text = notes.first?["text"] as? String ?? ""
                            let params: [String: Any] = [
                                "home": home, "path": ".sniptoss/annotations/a.png.json", "text": text + "t\(thread)-\(k)\n",
                                "expectSha256": NotesStore.textSha256(text) ?? "",
                            ]
                            let reply = try writeAnnotationReply(params, homes: homes, startWatching: { _ in })
                            if reply["written"] as? Bool == true { break }
                            refusals.increment()
                        }
                    } catch {
                        failures.increment()
                    }
                }
                group.leave()
            }
        }
        group.wait()
        XCTAssertEqual(failures.value, 0)
        let lines = readText(home + "/" + rel).split(separator: "\n").map(String.init)
        XCTAssertEqual(lines.count, threads * each, "a change was lost or written twice")
        XCTAssertEqual(Set(lines).count, threads * each)
        XCTAssertEqual(names(in: home + "/.sniptoss/annotations"), ["a.png.json"], "no lock or temp file is left")
    }

    // MARK: Hard rule 1: only .sniptoss/ of a notes folder a scan handed out

    func testNothingOutsideSniptossIsEverWritten() throws {
        let (home, homes) = newHome()
        writeText("原图", to: home + "/hero.png")
        let blocked = [
            "hero.png", ".sniptoss/../hero.png", "annotations/../../别处.json", ".pizhu/annotations/a.png.json", ".sniptoss2/a.json",
            ".sniptoss", "", "/etc/hosts",
        ]
        let watched = Watched()
        for path in blocked {
            let params = args(home, path, ["text": "x", "data": "eA==", "expectSha256": NSNull()])
            XCTAssertThrowsError(try writeAnnotationReply(params, homes: homes, startWatching: { watched.record($0) }), path)
            XCTAssertThrowsError(try writeTextReply(params, homes: homes, startWatching: { watched.record($0) }), path)
            XCTAssertThrowsError(try writeBase64Reply(params, homes: homes, startWatching: { watched.record($0) }), path)
            XCTAssertThrowsError(try deleteFileReply(params, homes: homes), path)
        }
        XCTAssertEqual(readText(home + "/hero.png"), "原图", "the item is never modified or deleted")
        XCTAssertEqual(names(in: home), ["hero.png"], "nothing was created, not even .sniptoss")
        XCTAssertEqual(watched.all, [])
    }

    func testTheRefusalsAreOfTheDeniedClassExceptAnAbsolutePathWhichIsMalformed() {
        let (home, homes) = newHome()
        for path in ["hero.png", ".sniptoss/../hero.png", ".pizhu/a.json"] {
            XCTAssertThrowsError(try writeTextReply(args(home, path, ["text": "x"]), homes: homes, startWatching: { _ in })) { error in
                XCTAssertEqual(code(of: error), "denied", path)
            }
        }
        XCTAssertThrowsError(try writeTextReply(args(home, "/etc/hosts", ["text": "x"]), homes: homes, startWatching: { _ in })) { error in
            XCTAssertNil(code(of: error))
        }
    }

    func testAFolderNoScanHandedOutIsRefusedByEveryWritingMethod() throws {
        let (_, homes) = newHome()
        let stranger = makeTempDir()
        let params = args(
            stranger, ".sniptoss/annotations/a.png.json",
            ["text": "x", "data": "eA==", "keep": [String](), "expectSha256": NSNull()])
        XCTAssertThrowsError(try writeAnnotationReply(params, homes: homes, startWatching: { _ in })) { error in
            XCTAssertEqual(code(of: error), "denied")
        }
        XCTAssertThrowsError(try writeTextReply(params, homes: homes, startWatching: { _ in }))
        XCTAssertThrowsError(try writeBase64Reply(params, homes: homes, startWatching: { _ in }))
        XCTAssertThrowsError(try deleteFileReply(params, homes: homes))
        XCTAssertThrowsError(try pruneSnapshotsReply(params, homes: homes))
        XCTAssertEqual(names(in: stranger), [])
    }

    func testAFolderThatIsGoneIsNotRecreatedByAWrite() throws {
        // The item's folder was deleted or moved away: writing would leave a folder holding only .sniptoss in the old place
        let (home, homes) = newHome()
        try FileManager.default.removeItem(atPath: home)
        XCTAssertThrowsError(try write(home, homes, "x", expect: NSNull())) { error in
            XCTAssertEqual(code(of: error), "notFound")
        }
        let review = args(home, ".sniptoss/REVIEW.md", ["text": "x"])
        XCTAssertThrowsError(try writeTextReply(review, homes: homes, startWatching: { _ in })) { error in
            XCTAssertEqual(code(of: error), "notFound")
        }
        XCTAssertFalse(exists(home))
    }

    func testNothingIsWrittenThroughALinkInsideSniptoss() throws {
        let (home, homes) = newHome()
        let elsewhere = makeTempDir()
        try FileManager.default.createDirectory(atPath: home + "/.sniptoss", withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(atPath: home + "/.sniptoss/annotations", withDestinationPath: elsewhere)
        XCTAssertThrowsError(try write(home, homes, "x", expect: NSNull())) { error in
            XCTAssertEqual(code(of: error), "denied")
        }
        XCTAssertThrowsError(try writeTextReply(args(home, rel, ["text": "x"]), homes: homes, startWatching: { _ in }))
        XCTAssertEqual(names(in: elsewhere), [])
    }

    // MARK: writeText, writeBase64

    func testWriteTextWritesUtf8WithoutAByteOrderMarkStartsWatchingAndAddsTheGitignore() throws {
        let (home, homes) = newHome()
        let watched = Watched()
        try writeTextReply(args(home, ".sniptoss/REVIEW.md", ["text": "# 批注\n"]), homes: homes, startWatching: { watched.record($0) })
        XCTAssertEqual(Array(try Data(contentsOf: URL(fileURLWithPath: home + "/.sniptoss/REVIEW.md"))), Array("# 批注\n".utf8))
        XCTAssertEqual(watched.all, [home])
        XCTAssertTrue(exists(home + "/.sniptoss/.gitignore"))
        XCTAssertEqual(names(in: home + "/.sniptoss"), [".gitignore", "REVIEW.md"])

        // Written again: replaced as a whole
        try writeTextReply(args(home, ".sniptoss/REVIEW.md", ["text": "短"]), homes: homes, startWatching: { _ in })
        XCTAssertEqual(readText(home + "/.sniptoss/REVIEW.md"), "短")
        XCTAssertEqual(names(in: home + "/.sniptoss"), [".gitignore", "REVIEW.md"])
    }

    func testWriteTextCreatesTheFoldersAboveTheFile() throws {
        let (home, homes) = newHome()
        try writeTextReply(args(home, ".sniptoss/a/b/c.txt", ["text": "x"]), homes: homes, startWatching: { _ in })
        XCTAssertEqual(readText(home + "/.sniptoss/a/b/c.txt"), "x")
    }

    func testWriteBase64WritesTheBytes() throws {
        let (home, homes) = newHome()
        let bytes = Data([0x89, 0x50, 0x4E, 0x47, 0x00, 0xFF, 0x10])
        try writeBase64Reply(
            args(home, ".sniptoss/snapshots/abc123.png", ["data": bytes.base64EncodedString()]), homes: homes, startWatching: { _ in })
        XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: home + "/.sniptoss/snapshots/abc123.png")), bytes)
        XCTAssertTrue(exists(home + "/.sniptoss/.gitignore"))
        XCTAssertEqual(names(in: home + "/.sniptoss/snapshots"), ["abc123.png"])
    }

    func testWriteBase64WithDataThatIsNotBase64WritesNothing() {
        let (home, homes) = newHome()
        XCTAssertThrowsError(
            try writeBase64Reply(args(home, ".sniptoss/snapshots/abc123.png", ["data": "***"]), homes: homes, startWatching: { _ in })
        ) { error in
            XCTAssertNotNil(error as? BridgeError)
        }
        XCTAssertEqual(names(in: home), [])
    }

    // MARK: deleteFile

    func testDeleteFileRemovesOneFileInsideSniptossAndAMissingOneIsNotAnError() throws {
        let (home, homes) = newHome()
        writeText("x", to: home + "/.sniptoss/snapshots/abc123.png")
        writeText("y", to: home + "/.sniptoss/snapshots/def456.png")
        try deleteFileReply(args(home, ".sniptoss/snapshots/abc123.png"), homes: homes)
        XCTAssertEqual(names(in: home + "/.sniptoss/snapshots"), ["def456.png"])
        try deleteFileReply(args(home, ".sniptoss/snapshots/abc123.png"), homes: homes)
        try deleteFileReply(args(home, ".sniptoss/snapshots"), homes: homes)
        XCTAssertEqual(names(in: home + "/.sniptoss/snapshots"), ["def456.png"], "a folder is left alone")
    }

    // MARK: pruneSnapshots

    func testPruneSnapshotsAnswersHowManyWereDeleted() throws {
        let (home, homes) = newHome()
        for name in ["abc123.png", "def456.png", "ghi789.png", "note.txt"] { writeText("x", to: home + "/.sniptoss/snapshots/" + name) }
        let params = args(home, "", ["keep": ["snapshots/abc123.png", 5, ""] as [Any]])

        let deleted = try pruneSnapshotsReply(params, homes: homes, minAge: 0)

        XCTAssertEqual(deleted, 2)
        XCTAssertEqual(names(in: home + "/.sniptoss/snapshots"), ["abc123.png", "note.txt"])
    }

    func testPruneSnapshotsKeepsEverythingModifiedWithinTheLastTenMinutes() throws {
        let (home, homes) = newHome()
        writeText("x", to: home + "/.sniptoss/snapshots/abc123.png")
        let params = args(home, "", ["keep": [String]()])
        XCTAssertEqual(try pruneSnapshotsReply(params, homes: homes), 0)
        XCTAssertEqual(names(in: home + "/.sniptoss/snapshots"), ["abc123.png"])
        try FileManager.default.setAttributes(
            [.modificationDate: Date(timeIntervalSinceNow: -11 * 60)], ofItemAtPath: home + "/.sniptoss/snapshots/abc123.png")
        XCTAssertEqual(try pruneSnapshotsReply(params, homes: homes), 1)
    }

    func testPruneSnapshotsWithoutAKeepListDeletesEveryOldSnapshot() throws {
        let (home, homes) = newHome()
        writeText("x", to: home + "/.sniptoss/snapshots/abc123.png")
        XCTAssertEqual(try pruneSnapshotsReply(args(home, ""), homes: homes, minAge: 0), 1)
    }

    // MARK: Disk errors

    func testADiskErrorIsAnsweredWithTheClassThePageExplains() {
        XCTAssertEqual(bridgeError(FileOperationError(operation: "write", path: "/x", code: EACCES)).code, "denied")
        XCTAssertEqual(bridgeError(FileOperationError(operation: "write", path: "/x", code: ENOSPC)).code, "diskFull")
        XCTAssertEqual(bridgeError(FileOperationError(operation: "create lock", path: "/x", code: EBUSY)).code, "busy")
        XCTAssertNil(bridgeError(FileOperationError(operation: "write", path: "/x", code: EIO)).code)
    }
}
