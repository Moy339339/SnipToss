import XCTest

@testable import SnipToss

/// An empty .sniptoss is removed (HomeTidy): only what the app wrote is deleted, and undo can still bring the snapshots back. The same rules
/// as the Windows shell's (tests/AppTests/HomeTidyTests.cs); there is no hiding to test, a name starting with a dot is hidden on the Mac
final class HomeTidyTests: SnipTestCase {
    private let empty = #"{ "schema": "sniptoss/5", "material": { "path": "a.png", "kind": "image" }, "annotations": [] }"#
    private let oneNote = #"{ "schema": "sniptoss/5", "material": { "path": "a.png", "kind": "image" }, "annotations": [{ "id": "abc123" }] }"#
    private let oneDrawing =
        #"{ "schema": "sniptoss/5", "material": { "path": "a.png", "kind": "image" }, "annotations": [], "drawings": [{ "id": "abc123" }] }"#

    private var home = ""
    private var tidy: HomeTidy!

    override func setUp() {
        super.setUp()
        home = makeTempDir()
        tidy = HomeTidy(stashRoot: makeTempDir() + "/removed-snapshots")
    }

    override func tearDown() {
        tidy.dropStashes()
        super.tearDown()
    }

    private func path(_ rel: String) -> String { home + "/" + rel }

    private func makeUsual(_ notes: String) {
        writeText(notes, to: path(".sniptoss/annotations/a.png.json"))
        writeText("# Review", to: path(".sniptoss/REVIEW.md"))
        writeText("{}", to: path(".sniptoss/project.json"))
        writeText(DataDir.gitIgnore, to: path(".sniptoss/.gitignore"))
        writeText("shot", to: path(".sniptoss/snapshots/abc123.png"))
    }

    private func exists(_ rel: String) -> Bool {
        var st = stat()
        return lstat(path(rel), &st) == 0
    }

    /// Every file under `.sniptoss`, relative to it, sorted
    private func filesLeft() -> [String] {
        let root = path(".sniptoss")
        guard let walk = FileManager.default.enumerator(atPath: root) else { return [] }
        return walk.compactMap { $0 as? String }.filter { !Library.isDirectory(root + "/" + $0) }.sorted()
    }

    func testAFolderWhoseNotesFilesAreAllEmptyIsRemovedEntirely() {
        makeUsual(empty)
        writeText(empty, to: path(".sniptoss/annotations/b.png.json"))

        XCTAssertEqual(tidy.tidy(home: home), .removed)
        XCTAssertFalse(exists(".sniptoss"))
    }

    func testAnEmptyNotesFileOfTheOldFormatCountsAsEmptyToo() {
        makeUsual(#"{ "schema": "pizhu/1", "material": { "path": "a.png" }, "annotations": [] }"#)

        XCTAssertEqual(tidy.tidy(home: home), .removed)
    }

    func testNoFolderMeansNothingToDo() {
        XCTAssertEqual(tidy.tidy(home: home), .nothing)
        // A file by that name is not a notes folder either
        writeText("x", to: path(".sniptoss"))
        XCTAssertEqual(tidy.tidy(home: home), .nothing)
        XCTAssertTrue(exists(".sniptoss"))
    }

    func testAFolderWithANoteADrawingOrAnUnreadableNotesFileIsLeftUntouched() {
        for notes in [
            oneNote, oneDrawing, "not json", "[]", #"{ "schema": "sniptoss/5", "annotations": [], "drawings": null }"#,
            #"{ "annotations": [], "mine": "some other JSON that only looks alike" }"#,
            #"{ "schema": "other/1", "annotations": [] }"#,
            // A later version keeps something this one does not know about
            #"{ "schema": "sniptoss/9", "material": { "path": "a.png", "kind": "image" }, "annotations": [], "sketches": [{ "id": "later" }] }"#,
        ] {
            makeUsual(notes)
            // The empty one next to it stays too: nothing is deleted unless everything is empty
            writeText(empty, to: path(".sniptoss/annotations/b.png.json"))

            XCTAssertEqual(tidy.tidy(home: home), .kept, notes)
            XCTAssertEqual(readText(path(".sniptoss/annotations/a.png.json")), notes)
            for rel in [".sniptoss/annotations/b.png.json", ".sniptoss/REVIEW.md", ".sniptoss/project.json", ".sniptoss/snapshots/abc123.png"] {
                XCTAssertTrue(exists(rel), "\(rel) with \(notes)")
            }
        }
    }

    func testANotesFileBeingWrittenKeepsTheFolder() {
        makeUsual(empty)
        writeText("1 1 x", to: path(".sniptoss/annotations/.a.png.json.lock"))

        XCTAssertEqual(tidy.tidy(home: home), .kept)
        XCTAssertTrue(exists(".sniptoss/annotations/a.png.json"))
    }

    func testFilesTheAppDidNotWriteStayAndSoDoesTheFolder() {
        makeUsual(empty)
        writeText("mine", to: path(".sniptoss/my-notes.txt"))
        writeText("mine", to: path(".sniptoss/snapshots/holiday.png"))
        writeText("edited\n", to: path(".sniptoss/.gitignore"))

        XCTAssertEqual(tidy.tidy(home: home), .left)
        XCTAssertEqual(filesLeft(), [".gitignore", "my-notes.txt", "snapshots/holiday.png"])
    }

    func testFindersOwnFilesDoNotKeepAnEmptiedFolder() {
        makeUsual(empty)
        for folder in [".sniptoss", ".sniptoss/annotations", ".sniptoss/snapshots"] { writeText("finder", to: path(folder + "/.DS_Store")) }

        XCTAssertEqual(tidy.tidy(home: home), .removed)
        XCTAssertFalse(exists(".sniptoss"))
    }

    func testALinkInsteadOfAFolderOrANotesFileIsNotFollowed() throws {
        // The notes folder itself, its annotations folder, or a notes file is a link: none of it is ours to judge
        let elsewhere = makeTempDir()
        writeText(empty, to: elsewhere + "/annotations/a.png.json")
        try FileManager.default.createSymbolicLink(atPath: path(".sniptoss"), withDestinationPath: elsewhere)
        XCTAssertEqual(tidy.tidy(home: home), .kept)
        XCTAssertTrue(FileManager.default.fileExists(atPath: elsewhere + "/annotations/a.png.json"))

        try FileManager.default.removeItem(atPath: path(".sniptoss"))
        writeText("# Review", to: path(".sniptoss/REVIEW.md"))
        try FileManager.default.createSymbolicLink(atPath: path(".sniptoss/annotations"), withDestinationPath: elsewhere + "/annotations")
        XCTAssertEqual(tidy.tidy(home: home), .kept)

        try FileManager.default.removeItem(atPath: path(".sniptoss/annotations"))
        try FileManager.default.createDirectory(atPath: path(".sniptoss/annotations"), withIntermediateDirectories: true)
        try FileManager.default.createSymbolicLink(atPath: path(".sniptoss/annotations/a.png.json"), withDestinationPath: elsewhere + "/annotations/a.png.json")
        XCTAssertEqual(tidy.tidy(home: home), .kept)
        XCTAssertTrue(exists(".sniptoss/REVIEW.md"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: elsewhere + "/annotations/a.png.json"))
    }

    func testSnapshotsOfARemovedFolderComeBackBeforeTheNextWriteSoUndoStillHasThem() {
        makeUsual(empty)
        XCTAssertEqual(tidy.tidy(home: home), .removed)
        XCTAssertFalse(names(in: tidy.stashRoot).isEmpty)

        tidy.restore(home: home)

        XCTAssertEqual(readText(path(".sniptoss/snapshots/abc123.png")), "shot")
        XCTAssertEqual(names(in: tidy.stashRoot), [])
        // Nothing set aside any more: does nothing
        tidy.restore(home: home)
        XCTAssertEqual(filesLeft(), ["snapshots/abc123.png"])
    }

    func testARestoredSnapshotDoesNotReplaceOneWrittenSince() {
        makeUsual(empty)
        XCTAssertEqual(tidy.tidy(home: home), .removed)
        writeText("newer", to: path(".sniptoss/snapshots/abc123.png"))

        tidy.restore(home: home)

        XCTAssertEqual(readText(path(".sniptoss/snapshots/abc123.png")), "newer")
    }

    /// Every file under the folder where snapshots are set aside
    private func setAside() -> [String] {
        guard let walk = FileManager.default.enumerator(atPath: tidy.stashRoot) else { return [] }
        return walk.compactMap { $0 as? String }.filter { !Library.isDirectory(tidy.stashRoot + "/" + $0) }
    }

    func testSnapshotsThatCouldNotBePutBackAreTriedAgainOnTheNextWrite() throws {
        makeUsual(empty)
        XCTAssertEqual(tidy.tidy(home: home), .removed)
        // A file where the folder should be: putting back fails
        writeText("", to: path(".sniptoss"))

        tidy.restore(home: home)
        XCTAssertEqual(setAside().count, 1, "still set aside")

        try FileManager.default.removeItem(atPath: path(".sniptoss"))
        tidy.restore(home: home)
        XCTAssertEqual(readText(path(".sniptoss/snapshots/abc123.png")), "shot")
        XCTAssertEqual(setAside(), [])
    }

    func testRemovingTheFolderAndWritingIntoItTakeTurns() {
        makeUsual(empty)
        // A write into this folder is under way
        let entered = DispatchSemaphore(value: 0)
        let release = DispatchSemaphore(value: 0)
        let writeDone = DispatchSemaphore(value: 0)
        DispatchQueue.global().async {
            self.tidy.withHome(self.home) { _ in
                entered.signal()
                release.wait()
            }
            writeDone.signal()
        }
        entered.wait()
        var result: HomeTidy.Result?
        let tidied = DispatchSemaphore(value: 0)
        DispatchQueue.global().async {
            result = self.tidy.tidy(home: self.home)
            tidied.signal()
        }

        XCTAssertEqual(tidied.wait(timeout: .now() + 0.3), .timedOut, "removing waits for the write")
        XCTAssertTrue(exists(".sniptoss/snapshots/abc123.png"))

        release.signal()
        XCTAssertEqual(tidied.wait(timeout: .now() + 10), .success)
        XCTAssertEqual(result, .removed)
        writeDone.wait()
    }

    func testAWriteThroughTheBridgeWaitsForItsTurnToo() {
        let homes = handedOut()
        makeUsual(empty)
        // Removing (or another write) holds this folder's turn
        let entered = DispatchSemaphore(value: 0)
        let release = DispatchSemaphore(value: 0)
        let holderDone = DispatchSemaphore(value: 0)
        DispatchQueue.global().async {
            self.tidy.withHome(self.home) { _ in
                entered.signal()
                release.wait()
            }
            holderDone.signal()
        }
        entered.wait()
        var failure: Error?
        let written = DispatchSemaphore(value: 0)
        DispatchQueue.global().async {
            do {
                try writeTextReply(
                    ["home": self.home, "path": ".sniptoss/REVIEW.md", "text": "# Later"], homes: homes, startWatching: { _ in }, tidy: self.tidy)
            } catch {
                failure = error
            }
            written.signal()
        }

        XCTAssertEqual(written.wait(timeout: .now() + 0.3), .timedOut, "the write waits for its turn")
        XCTAssertEqual(readText(path(".sniptoss/REVIEW.md")), "# Review")

        release.signal()
        XCTAssertEqual(written.wait(timeout: .now() + 10), .success)
        XCTAssertNil(failure)
        XCTAssertEqual(readText(path(".sniptoss/REVIEW.md")), "# Later")
        holderDone.wait()
    }

    func testOneFolderSpelledInAnotherCaseIsOneNotesFolderAndTwoFoldersAreTwo() throws {
        // The same path with its last letter in the other case
        var chars = Array(home)
        guard let i = chars.lastIndex(where: { $0.isLetter }) else { throw XCTSkip("no letter in the path") }
        chars[i] = Character(chars[i].isUppercase ? chars[i].lowercased() : chars[i].uppercased())
        let other = String(chars)
        guard Library.isDirectory(other) else { throw XCTSkip("this volume tells letters of different case apart") }
        XCTAssertEqual(HomeTidy.key(home), HomeTidy.key(other))
        XCTAssertNotEqual(HomeTidy.key(home), HomeTidy.key(makeTempDir()))
        // Set aside under one spelling, put back under the other
        makeUsual(empty)
        XCTAssertEqual(tidy.tidy(home: home), .removed)
        tidy.restore(home: other)
        XCTAssertEqual(readText(path(".sniptoss/snapshots/abc123.png")), "shot")
    }

    func testSetAsideSnapshotsAreDroppedOnQuit() {
        makeUsual(empty)
        _ = tidy.tidy(home: home)
        XCTAssertFalse(names(in: tidy.stashRoot).isEmpty)

        tidy.dropStashes()
        tidy.restore(home: home)

        XCTAssertFalse(FileManager.default.fileExists(atPath: tidy.stashRoot))
        XCTAssertFalse(exists(".sniptoss"))
    }

    // MARK: The bridge

    private func handedOut() -> NotesHomes {
        let homes = NotesHomes()
        homes.insert(home)
        return homes
    }

    func testTidyHomeAnswersWhatItDidAndOnlyForAFolderAScanHandedOut() throws {
        makeUsual(oneNote)
        XCTAssertThrowsError(try tidyHomeReply(["home": home], homes: NotesHomes(), tidy: tidy)) { error in
            XCTAssertNotNil(error as? BridgeError)
        }
        let homes = handedOut()
        XCTAssertEqual(try tidyHomeReply(["home": home], homes: homes, tidy: tidy), "kept")
        writeText(empty, to: path(".sniptoss/annotations/a.png.json"))
        XCTAssertEqual(try tidyHomeReply(["home": home], homes: homes, tidy: tidy), "removed")
        XCTAssertEqual(try tidyHomeReply(["home": home], homes: homes, tidy: tidy), "nothing")
    }

    func testEachWriteIntoAnEmptiedFolderPutsItsSnapshotsBackFirst() throws {
        let homes = handedOut()
        let writes: [(String, () throws -> Void)] = [
            ("writeAnnotation", { _ = try writeAnnotationReply(["home": self.home, "path": ".sniptoss/annotations/a.png.json", "text": self.oneNote], homes: homes, startWatching: { _ in }, tidy: self.tidy) }),
            ("writeText", { try writeTextReply(["home": self.home, "path": ".sniptoss/REVIEW.md", "text": "# Review"], homes: homes, startWatching: { _ in }, tidy: self.tidy) }),
            ("writeBase64", { try writeBase64Reply(["home": self.home, "path": ".sniptoss/snapshots/def456.png", "data": "AAAA"], homes: homes, startWatching: { _ in }, tidy: self.tidy) }),
        ]
        for (name, write) in writes {
            makeUsual(empty)
            XCTAssertEqual(tidy.tidy(home: home), .removed, name)
            try write()
            XCTAssertEqual(readText(path(".sniptoss/snapshots/abc123.png")), "shot", name)
            try FileManager.default.removeItem(atPath: path(".sniptoss"))
        }
    }

    func testReadHomesSaysWhetherThereIsANotesFolder() throws {
        let homes = handedOut()
        XCTAssertEqual((try readHomesReply([home], homes: homes, startWatching: { _ in })[0]["project"] as? [String: Any])?["exists"] as? Bool, false)
        try FileManager.default.createDirectory(atPath: path(".sniptoss"), withIntermediateDirectories: true)
        let reply = try readHomesReply([home], homes: homes, startWatching: { _ in })
        XCTAssertTrue(JSONSerialization.isValidJSONObject(reply))
        XCTAssertEqual((reply[0]["project"] as? [String: Any])?["exists"] as? Bool, true)
    }

    func testEntriesLeavingTheLibraryHaveTheirEmptyNotesFolderTidied() {
        // A folder entry (its own notes folder), a file in it, a file whose notes folder holds notes, and one no scan handed out
        let kept = makeTempDir()
        let stranger = makeTempDir()
        makeUsual(empty)
        writeText("x", to: path("assets/a.png"))
        writeText(oneNote, to: kept + "/.sniptoss/annotations/a.png.json")
        writeText("x", to: kept + "/a.png")
        writeText(empty, to: stranger + "/.sniptoss/annotations/a.png.json")
        let homes = handedOut()
        homes.insert(kept)

        let done = tidyLeaving([home, path("assets/a.png"), kept + "/a.png", stranger, path("not-there.png")], homes: homes, tidy: tidy)

        XCTAssertEqual(done, [home: .removed, kept: .kept], "each notes folder once, only those a scan handed out")
        XCTAssertFalse(exists(".sniptoss"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: kept + "/.sniptoss/annotations/a.png.json"))
        XCTAssertTrue(FileManager.default.fileExists(atPath: stranger + "/.sniptoss/annotations/a.png.json"))
    }
}
