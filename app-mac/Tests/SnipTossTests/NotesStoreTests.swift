import CryptoKit
import XCTest

@testable import SnipToss

/// Reading and writing the notes of a notes folder (NotesStore, DataDir): the conditional write of docs/adr/0005-write-protocol.md, the
/// ordering numbers of hard rule 3a, project settings, snapshot clean-up and the `.gitignore` in `.sniptoss`
final class NotesStoreTests: SnipTestCase {
    /// Numbers handed in from several threads
    private final class Collector {
        private let guardLock = NSLock()
        private var items: [Int] = []

        func add(_ more: [Int]) {
            guardLock.lock()
            items.append(contentsOf: more)
            guardLock.unlock()
        }

        var values: [Int] {
            guardLock.lock()
            defer { guardLock.unlock() }
            return items
        }
    }

    @discardableResult
    private func make(_ path: String, _ text: String = "{}") -> String {
        writeText(text, to: path)
        return path
    }

    private func setModified(_ path: String, secondsAgo: TimeInterval) throws {
        try FileManager.default.setAttributes([.modificationDate: Date(timeIntervalSinceNow: -secondsAgo)], ofItemAtPath: path)
    }

    private func exists(_ path: String) -> Bool {
        FileManager.default.fileExists(atPath: path)
    }

    // MARK: Fingerprint

    func testTheFingerprintIsTheSha256OfTheUtf8TextAsLowerCaseHex() {
        XCTAssertEqual(NotesStore.textSha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        XCTAssertEqual(NotesStore.textSha256(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        let expected = SHA256.hash(data: Data("旧".utf8)).map { String(format: "%02x", $0) }.joined()
        XCTAssertEqual(NotesStore.textSha256("旧"), expected)
        XCTAssertNil(NotesStore.textSha256(nil))
    }

    // MARK: Conditional write

    func testWritingWhenSomeoneElseChangedTheNotesFirstDoesNotOverwriteAndReturnsTheCurrentContent() throws {
        // Two windows or an agent change the same notes file at once: the page writes with the fingerprint it read, and a mismatch means no
        // write; the current content is handed back so the page can merge
        let file = make(makeTempDir() + "/a.json", "旧")
        let seen = NotesStore.textSha256("旧")
        writeText("别人改的", to: file)

        let rejected = try NotesStore.writeIfUnchanged(file, text: "我的", check: true, expectSha256: seen)
        XCTAssertFalse(rejected.written)
        XCTAssertEqual(rejected.current, "别人改的")
        XCTAssertEqual(readText(file), "别人改的")

        // Ordering numbers (ADR-0005 item 8): the number taken before a later read and the one from a later successful write are both
        // greater than the one from this rejection
        let readAfter = NotesStore.observe()
        XCTAssertGreaterThan(readAfter, rejected.seq)
        let accepted = try NotesStore.writeIfUnchanged(file, text: "我的", check: true, expectSha256: NotesStore.textSha256("别人改的"))
        XCTAssertTrue(accepted.written)
        XCTAssertNil(accepted.current)
        XCTAssertGreaterThan(accepted.seq, readAfter)
        XCTAssertEqual(readText(file), "我的")
    }

    func testAFileTheCallerBelievesDoesNotExistIsWrittenOnlyWhileItDoesNot() throws {
        let file = makeTempDir() + "/b.json"
        XCTAssertTrue(try NotesStore.writeIfUnchanged(file, text: "新", check: true, expectSha256: nil).written)
        let second = try NotesStore.writeIfUnchanged(file, text: "又新", check: true, expectSha256: nil)
        XCTAssertFalse(second.written)
        XCTAssertEqual(second.current, "新")
        XCTAssertEqual(readText(file), "新")
    }

    func testAFileThatDoesNotExistIsReportedAsNilWhenTheCallerExpectedSomething() throws {
        let file = makeTempDir() + "/gone.json"
        let result = try NotesStore.writeIfUnchanged(file, text: "x", check: true, expectSha256: NotesStore.textSha256("旧"))
        XCTAssertFalse(result.written)
        XCTAssertNil(result.current)
        XCTAssertFalse(exists(file), "nothing was written")
    }

    func testWithoutAComparisonTheWriteAlwaysGoesThrough() throws {
        let file = make(makeTempDir() + "/a.json", "别人的")
        XCTAssertTrue(try NotesStore.writeIfUnchanged(file, text: "我的", check: false, expectSha256: nil).written)
        XCTAssertEqual(readText(file), "我的")
    }

    func testTheComparisonIgnoresAByteOrderMarkOnDiskAndTheTextIsWrittenWithoutOne() throws {
        let dir = makeTempDir()
        let file = dir + "/a.json"
        try Data([0xEF, 0xBB, 0xBF] + Array("{\"a\":1}".utf8)).write(to: URL(fileURLWithPath: file))
        let rejected = try NotesStore.writeIfUnchanged(file, text: "x", check: true, expectSha256: "0000")
        XCTAssertEqual(rejected.current, "{\"a\":1}", "what comes back has no byte order mark")
        let accepted = try NotesStore.writeIfUnchanged(
            file, text: "{\"a\":2}\n", check: true, expectSha256: NotesStore.textSha256("{\"a\":1}"))
        XCTAssertTrue(accepted.written)
        XCTAssertEqual(Array(try Data(contentsOf: URL(fileURLWithPath: file)).prefix(3)), Array("{\"a".utf8))
    }

    func testAWriteLeavesNeitherALockNorATempFile() throws {
        let dir = makeTempDir()
        let file = dir + "/.sniptoss/annotations/a.json"
        _ = try NotesStore.writeIfUnchanged(file, text: "1", check: true, expectSha256: nil)
        _ = try NotesStore.writeIfUnchanged(file, text: "2", check: true, expectSha256: "ffff")
        XCTAssertEqual(names(in: dir + "/.sniptoss/annotations"), ["a.json"])
    }

    func testAWriteWaitsForTheLockAndGivesUpWhenItStaysTaken() throws {
        let dir = makeTempDir()
        let file = dir + "/a.json"
        let held = try FileLock.acquire(file)
        defer { held.release() }
        let started = Date()
        XCTAssertThrowsError(try NotesStore.writeIfUnchanged(file, text: "x", check: false, expectSha256: nil, lockWait: 0.4)) { error in
            guard case FileLockError.stayedLocked = error else { return XCTFail("\(error)") }
        }
        XCTAssertGreaterThanOrEqual(Date().timeIntervalSince(started), 0.4)
        XCTAssertFalse(exists(file), "nothing was written")
    }

    func testWritersInOneProcessTakingTurnsLoseNoChange() throws {
        // The page's side of the protocol: read, change, write with the fingerprint that was read, and if refused read again
        let dir = makeTempDir()
        let file = dir + "/a.json"
        writeText("", to: file)
        let writers = 4
        let each = 25
        let failures = Counter()
        let rejections = Counter()
        let group = DispatchGroup()
        for writer in 0..<writers {
            group.enter()
            DispatchQueue.global().async {
                for k in 0..<each {
                    do {
                        while true {
                            let text = try AtomicFile.readAllText(file)
                            let outcome = try NotesStore.writeIfUnchanged(
                                file, text: text + "w\(writer)-\(k)\n", check: true, expectSha256: NotesStore.textSha256(text))
                            if outcome.written { break }
                            rejections.increment()
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
        let lines = readText(file).split(separator: "\n").map(String.init)
        XCTAssertEqual(lines.count, writers * each, "a change was lost or written twice")
        XCTAssertEqual(Set(lines).count, writers * each)
        XCTAssertEqual(names(in: dir), ["a.json"], "no lock or temp file is left")
    }

    // MARK: Ordering numbers

    func testOrderingNumbersOnlyGoUpAndNeverRepeatAcrossThreads() {
        let collected = Collector()
        let outOfOrder = Counter()
        let group = DispatchGroup()
        for _ in 0..<4 {
            group.enter()
            DispatchQueue.global().async {
                var mine: [Int] = []
                for _ in 0..<500 { mine.append(NotesStore.observe()) }
                if mine != mine.sorted() { outOfOrder.increment() }
                collected.add(mine)
                group.leave()
            }
        }
        group.wait()
        let all = collected.values
        XCTAssertEqual(outOfOrder.value, 0, "numbers taken one after another on a thread go up")
        XCTAssertEqual(all.count, 2000)
        XCTAssertEqual(Set(all).count, 2000, "two callers were given the same number")
    }

    // MARK: Reading

    func testTheNotesFilesOfAHomeAreListedByNameWithTheirTextAndNothingElse() throws {
        let home = makeTempDir()
        let dir = home + "/.sniptoss/annotations"
        make(dir + "/b.png.json", "乙")
        make(dir + "/a.png.json", "甲")
        make(dir + "/.a.png.json.lock", "1 2 pc")
        make(dir + "/.a.png.json.123-abc.tmp", "half")
        make(dir + "/readme.txt")
        try FileManager.default.createDirectory(atPath: dir + "/folder.json", withIntermediateDirectories: true)
        try Data([0xEF, 0xBB, 0xBF] + Array("丙".utf8)).write(to: URL(fileURLWithPath: dir + "/c.png.json"))

        let notes = try NotesStore.readAnnotations(home: home)

        XCTAssertEqual(notes.compactMap { $0["name"] as? String }, ["a.png.json", "b.png.json", "c.png.json"])
        XCTAssertEqual(notes.compactMap { $0["text"] as? String }, ["甲", "乙", "丙"])
    }

    func testAHomeWithoutNotesHasNoNotesFiles() throws {
        let home = makeTempDir()
        XCTAssertTrue(try NotesStore.readAnnotations(home: home).isEmpty)
        try FileManager.default.createDirectory(atPath: home + "/.sniptoss", withIntermediateDirectories: true)
        XCTAssertTrue(try NotesStore.readAnnotations(home: home).isEmpty)
    }

    func testFolderSettingsAreReadAsNullWhenAbsentAndReportWhetherReviewExists() throws {
        let home = makeTempDir()
        var project = try NotesStore.readProject(home: home)
        XCTAssertTrue(project["text"] is NSNull)
        XCTAssertEqual(project["review"] as? Bool, false)

        make(home + "/.sniptoss/project.json", "{ \"language\": \"en\" }")
        make(home + "/.sniptoss/REVIEW.md", "# x")
        project = try NotesStore.readProject(home: home)
        XCTAssertEqual(project["text"] as? String, "{ \"language\": \"en\" }")
        XCTAssertEqual(project["review"] as? Bool, true)
        XCTAssertTrue(JSONSerialization.isValidJSONObject(project))
    }

    func testAReviewFolderIsNotAReviewFile() throws {
        let home = makeTempDir()
        try FileManager.default.createDirectory(atPath: home + "/.sniptoss/REVIEW.md", withIntermediateDirectories: true)
        XCTAssertEqual(try NotesStore.readProject(home: home)["review"] as? Bool, false)
    }

    // MARK: Deleting

    func testDeletingAFileRemovesItAndAFileThatIsNotThereIsNotAnError() throws {
        let dir = makeTempDir()
        let file = make(dir + "/x.png")
        try NotesStore.deleteFile(file)
        XCTAssertFalse(exists(file))
        try NotesStore.deleteFile(file)
        try FileManager.default.createDirectory(atPath: dir + "/sub", withIntermediateDirectories: true)
        try NotesStore.deleteFile(dir + "/sub")
        XCTAssertTrue(exists(dir + "/sub"), "a folder is not a file")
    }

    // MARK: Snapshots

    func testOnlyNamesTheAppGeneratesAreSnapshotNames() {
        for name in ["abc123.png", "abc123.jpg", "000000.png", "zzzzzz.jpg"] { XCTAssertTrue(NotesStore.isSnapshotName(name), name) }
        for name in [
            "ABC123.png", "abc123.PNG", "abc12.png", "abc1234.png", "abc123.gif", "abc123", "abc123.png.bak", ".png", "abc-23.png",
            "我的说明.png", "abc123.jpeg", "",
        ] {
            XCTAssertFalse(NotesStore.isSnapshotName(name), name)
        }
    }

    func testPruningSnapshotsRemovesOnlyUnusedAppNamedOldEnoughFiles() throws {
        // Snapshots of deleted notes, or in a replaced format, would otherwise stay forever
        let home = makeTempDir()
        let shots = home + "/.sniptoss/snapshots"
        func snapshot(_ name: String, secondsAgo: TimeInterval) throws -> String {
            let file = make(shots + "/" + name, "x")
            try setModified(file, secondsAgo: secondsAgo)
            return file
        }
        let used = try snapshot("abc123.png", secondsAgo: 3600)
        let orphan = try snapshot("def456.png", secondsAgo: 3600)
        let oldFormat = try snapshot("abc123.jpg", secondsAgo: 3600)  // the one from before the switch to PNG
        let fresh = try snapshot("new789.png", secondsAgo: 5)  // another window just took it, the note is not written yet
        let mine = try snapshot("我的说明.png", secondsAgo: 3600)  // not a name the app generates
        let upper = try snapshot("ABC999.png", secondsAgo: 3600)

        let deleted = try NotesStore.pruneSnapshots(home: home, keep: ["snapshots/abc123.png", "snapshots\\zzz000.png"], minAge: 600)

        XCTAssertEqual(deleted, 2)
        XCTAssertTrue(exists(used))
        XCTAssertFalse(exists(orphan))
        XCTAssertFalse(exists(oldFormat))
        XCTAssertTrue(exists(fresh))
        XCTAssertTrue(exists(mine))
        XCTAssertTrue(exists(upper))
    }

    func testTheKeepListIsReadWithEitherSlashAndAnyCase() throws {
        let home = makeTempDir()
        let a = make(home + "/.sniptoss/snapshots/aaaaaa.png")
        let b = make(home + "/.sniptoss/snapshots/bbbbbb.png")
        let c = make(home + "/.sniptoss/snapshots/cccccc.png")
        let d = make(home + "/.sniptoss/snapshots/dddddd.png")
        let deleted = try NotesStore.pruneSnapshots(
            home: home, keep: ["Snapshots/AAAAAA.png", "snapshots\\bbbbbb.png", "other/cccccc.png"], minAge: 0)
        XCTAssertEqual(deleted, 2, "only entries under snapshots/ count")
        XCTAssertTrue(exists(a))
        XCTAssertTrue(exists(b))
        XCTAssertFalse(exists(c))
        XCTAssertFalse(exists(d))
    }

    func testPruningWithoutASnapshotsFolderDoesNothingAndCreatesNothing() throws {
        let home = makeTempDir()
        XCTAssertEqual(try NotesStore.pruneSnapshots(home: home, keep: [], minAge: 0), 0)
        XCTAssertFalse(exists(home + "/.sniptoss"))
    }

    func testPruningNeverFollowsALinkOrTouchesAFolder() throws {
        let dir = makeTempDir()
        let home = dir + "/项目"
        let outside = make(dir + "/别处/aaaaaa.png", "keep me")
        try FileManager.default.createDirectory(atPath: home + "/.sniptoss/snapshots/bbbbbb.png", withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(atPath: home + "/.sniptoss/snapshots/cccccc.png", withDestinationPath: outside)
        try setModified(home + "/.sniptoss/snapshots/bbbbbb.png", secondsAgo: 3600)

        XCTAssertEqual(try NotesStore.pruneSnapshots(home: home, keep: [], minAge: 0), 0)
        XCTAssertTrue(exists(outside))
        XCTAssertTrue(exists(home + "/.sniptoss/snapshots/bbbbbb.png"))
    }

    // MARK: .gitignore

    func testAfterNotesAreWrittenAGitignoreIsAddedIfMissingIgnoringOnlyTempAndLockFilesAndAnExistingOneIsLeftAlone() {
        // A .tmp or .lock left behind by a power cut mid-write would otherwise show up in the user's project git changes
        let home = makeTempDir()
        DataDir.ensureGitIgnore(home: home)  // no .sniptoss yet: not created
        XCTAssertFalse(exists(home + "/.sniptoss"))

        make(home + "/.sniptoss/annotations/a.json")
        let ignore = home + "/.sniptoss/.gitignore"
        DataDir.ensureGitIgnore(home: home)
        let lines = readText(ignore).split(separator: "\n").map(String.init).filter { !$0.hasPrefix("#") }
        XCTAssertEqual(lines, ["*.tmp", "*.lock"], "the notes themselves are not ignored: whether to commit them is the user's call")

        writeText("我自己改的\n", to: ignore)
        DataDir.ensureGitIgnore(home: home)
        XCTAssertEqual(readText(ignore), "我自己改的\n")
    }

    func testTheGitignoreIsTheSameTextAsTheWindowsShellsAndTheMockHosts() {
        XCTAssertEqual(
            DataDir.gitIgnore,
            "# SnipToss: temporary and lock files left while saving notes (normally removed right away).\n"
                + "# Your notes are not ignored; commit them or not as you like.\n*.tmp\n*.lock\n")
    }
}
