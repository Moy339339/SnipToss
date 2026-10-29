import XCTest

@testable import SnipToss

/// Adding to and removing from the library (Library). Regressions covered: adding a subfolder and then its parent produced
/// two entries, so the same item was listed twice and its notes landed wherever the clicked row pointed; files skipped by the scan
/// (hidden, or under bin / dist) were reported as "already in the library" when they were not listed anywhere;
/// removing the item being viewed left nothing selected on the next launch
final class LibraryTests: SnipTestCase {
    /// A settings file and a project folder in a temporary folder
    private final class Project {
        let settings: Settings
        let root: String

        init(dir: String) {
            settings = Settings.load(from: dir + "/settings.json")
            root = dir + "/项目"
            try! FileManager.default.createDirectory(atPath: root, withIntermediateDirectories: true)
        }

        /// Creates a file in the project (relative path) and returns its absolute path
        @discardableResult
        func touch(_ rel: String) -> String {
            let full = root + "/" + rel
            try! FileManager.default.createDirectory(atPath: (full as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
            FileManager.default.createFile(atPath: full, contents: Data([1, 2, 3]))
            return full
        }

        /// Creates a folder in the project and returns its absolute path
        @discardableResult
        func dir(_ rel: String) -> String {
            let full = root + "/" + rel
            try! FileManager.default.createDirectory(atPath: full, withIntermediateDirectories: true)
            return full
        }

        var entries: [String] { settings.library.map { $0.path } }
    }

    private func makeProject() -> Project {
        Project(dir: makeTempDir())
    }

    /// A mount point under /Volumes that does not exist here: stands in for an unplugged drive
    private func absentVolume() -> String {
        "/Volumes/SnipTossAbsent-" + UUID().uuidString
    }

    private func isCaseInsensitive(_ path: String) -> Bool {
        let values = try? URL(fileURLWithPath: path).resourceValues(forKeys: [.volumeSupportsCaseSensitiveNamesKey])
        return values?.volumeSupportsCaseSensitiveNames == false
    }

    // MARK: Adding

    func testDroppingManySingleFilesAtOnceDoesNotNormalisePathsPairwiseAndFinishesWithinSeconds() {
        // Adding each file used to normalise the whole list again: thousands of files meant millions of calls
        let p = makeProject()
        let count = 1000
        let first = (0..<count).map { p.touch("a/\($0).png") }
        let second = (0..<count).map { p.touch("b/\($0).png") }
        Library.add(p.settings, paths: first)
        let started = Date()
        let r = Library.add(p.settings, paths: second + [first[234]])
        let elapsed = Date().timeIntervalSince(started)
        XCTAssertEqual(r.added.count, count, "the one already in the library was not added twice")
        XCTAssertEqual(p.entries.count, 2 * count)
        XCTAssertLessThan(elapsed, 20, "adding \(count) took \(elapsed) s")
        XCTAssertEqual(Library.remove(p.settings, where: { $0.path == first[0] || $0.path == second[0] }), 2)
    }

    func testAddingASubfolderThenItsParentMergesTheSubfolderIntoTheParent() {
        let p = makeProject()
        p.touch("图/a.png")
        let sub = p.dir("图")
        Library.add(p.settings, paths: [sub])
        let r = Library.add(p.settings, paths: [p.root])
        XCTAssertEqual(p.entries, [p.root])
        XCTAssertEqual(r.added, [p.root])
    }

    func testAddingASingleFileThenItsFolderMergesTheFileIntoTheFolder() {
        let p = makeProject()
        let file = p.touch("a.png")
        Library.add(p.settings, paths: [file])
        Library.add(p.settings, paths: [p.root])
        XCTAssertEqual(p.entries, [p.root])
    }

    func testWhenAMergedEntryWasPinnedTheParentFolderIsPinnedToo() throws {
        let p = makeProject()
        let other = p.touch("别处/b.png")
        Library.add(p.settings, paths: [other])
        let sub = p.dir("图")
        p.touch("图/a.png")
        Library.add(p.settings, paths: [sub])
        try Library.pin(p.settings, paths: [sub], pinned: true)
        Library.add(p.settings, paths: [p.root])
        // 别处/b.png is inside the project folder too and is merged along with it; the project folder inherits the pin and sits in the pinned area
        XCTAssertEqual(p.entries, [p.root])
        XCTAssertTrue(p.settings.library[0].pinned)
    }

    func testAddingAParentFolderKeepsChildEntriesTheScanCannotSee() {
        // dist is skipped by default and so are hidden folders (leading dot): these were added individually, are absent from the
        // parent's scan, and would vanish if merged
        let p = makeProject()
        let built = p.touch("dist/out.png")
        let hidden = p.touch(".cache/x.png")
        Library.add(p.settings, paths: [built, hidden])
        Library.add(p.settings, paths: [p.root])
        XCTAssertEqual(p.entries.count, 3)
        XCTAssertTrue(p.entries.contains(built))
        XCTAssertTrue(p.entries.contains(hidden))
    }

    func testAFileTheFolderScanAlreadyFindsIsNotAddedAgainAndIsLocatedInstead() {
        let p = makeProject()
        let file = p.touch("图/a.png")
        Library.add(p.settings, paths: [p.root])
        let r = Library.add(p.settings, paths: [file])
        XCTAssertTrue(r.added.isEmpty)
        XCTAssertEqual(r.focus, file)
        XCTAssertEqual(p.entries, [p.root])
    }

    func testAFileInsideAFolderThatTheScanSkipsCanBeAddedIndividually() {
        // It used to say "already in the library, located", although the library did not contain it
        for rel in ["dist/out.png", ".cache/x.png", "node_modules/pkg/logo.png"] {
            let p = makeProject()
            let file = p.touch(rel)
            Library.add(p.settings, paths: [p.root])
            let r = Library.add(p.settings, paths: [file])
            XCTAssertEqual(r.added, [file], rel)
            XCTAssertTrue(p.entries.contains(file), rel)
        }
    }

    func testAFolderLinkIsNotEnteredByTheScanSoAFileBehindItCanBeAddedIndividually() throws {
        let p = makeProject()
        let real = p.dir("真")
        let file = p.touch("真/a.png")
        try FileManager.default.createSymbolicLink(atPath: p.root + "/链", withDestinationPath: real)
        Library.add(p.settings, paths: [p.root])
        // Reached through the real folder, the scan lists it; reached through the link it is not listed there
        XCTAssertTrue(Library.covers(folder: p.root, path: file, kinds: ["image"], skipDirs: []))
        XCTAssertFalse(Library.covers(folder: p.root, path: p.root + "/链/a.png", kinds: ["image"], skipDirs: []))
        let r = Library.add(p.settings, paths: [p.root + "/链/a.png"])
        XCTAssertEqual(r.added, [p.root + "/链/a.png"])
    }

    func testADisabledKindIsLeftOutOfFolderScansButStillAddedWhenAddedIndividually() {
        let p = makeProject()
        let clip = p.touch("片子/a.mp4")
        p.settings.update { v in v.prefs = ["kinds": ["image": true, "video": false]] }
        Library.add(p.settings, paths: [p.root])
        let r = Library.add(p.settings, paths: [clip])
        XCTAssertEqual(r.added, [clip])
    }

    func testPDFAndPPTAreNotAcceptedUntilTheyCanBeAnnotatedEvenIfEnabledInSettings() {
        // They used to be listed, and opening one only showed a "supported in a later version" message
        let p = makeProject()
        let pdf = p.touch("文档/说明.pdf")
        p.touch("文档/方案.pptx")
        p.settings.update { v in v.prefs = ["kinds": ["pdf": true, "slides": true]] }
        let r = Library.add(p.settings, paths: [pdf])
        XCTAssertTrue(r.added.isEmpty)
        XCTAssertEqual(r.skipped.count, 1)
        XCTAssertTrue(r.skipped.first?.contains(".pdf") == true)
        XCTAssertNil(MaterialKinds.listed("说明.pdf", enabledKinds: p.settings.current.enabledKinds))
        XCTAssertFalse(MaterialKinds.extensions.contains(".pdf"))
    }

    func testFilesInsideTheNotesDataFolderAreNotTreatedAsItems() {
        // Opening a note snapshot from outside used to treat it as an item to locate, and failed to locate it without any message
        for rel in [".sniptoss/snapshots/a.png", ".pizhu/snapshots/a.png"] {
            let p = makeProject()
            let shot = p.touch(rel)
            let r = Library.add(p.settings, paths: [shot])
            XCTAssertTrue(r.added.isEmpty, rel)
            XCTAssertNil(r.focus, rel)
            XCTAssertEqual(r.skipped.count, 1, rel)
            XCTAssertTrue(r.skipped.first?.contains(".sniptoss") == true, rel)
            XCTAssertTrue(p.entries.isEmpty, rel)
        }
    }

    func testTheNotesDataFolderItselfIsNotTreatedAsAnItemFolder() {
        let p = makeProject()
        p.touch(".sniptoss/snapshots/a.png")
        let r = Library.add(p.settings, paths: [p.root + "/.sniptoss"])
        XCTAssertTrue(r.added.isEmpty)
        XCTAssertEqual(r.skipped.count, 1)
    }

    // MARK: Removing, tidying, pinning

    func testRemovingTheEntryContainingTheItemBeingViewedAlsoClearsTheLastSelection() {
        let p = makeProject()
        let a = p.touch("甲/a.png")
        let b = p.touch("乙/b.png")
        Library.add(p.settings, paths: [p.dir("甲"), b])
        p.settings.update { v in v.selected = a }
        Library.remove(p.settings, where: { Library.same($0.path, b) })
        XCTAssertEqual(p.settings.selected, a)
        Library.remove(p.settings, where: { Library.same($0.path, p.root + "/甲") })
        XCTAssertNil(p.settings.selected)
    }

    func testExistingDuplicateEntriesAreTidiedUpAtStartup() {
        // Settings saved before the fix may already hold both a subfolder and its parent
        let p = makeProject()
        p.touch("图/a.png")
        let sub = p.dir("图")
        let root = p.root
        p.settings.update { v in
            v.library.append(LibraryEntry(path: sub))
            v.library.append(LibraryEntry(path: root))
        }
        XCTAssertEqual(Library.tidy(p.settings), 1)
        XCTAssertEqual(p.entries, [p.root])
        XCTAssertEqual(Library.tidy(p.settings), 0)
    }

    func testTidyingKeepsThePinOfAMergedEntryOnTheParent() throws {
        let p = makeProject()
        p.touch("图/a.png")
        let sub = p.dir("图")
        let root = p.root
        p.settings.update { v in
            v.library.append(LibraryEntry(path: sub, pinned: true))
            v.library.append(LibraryEntry(path: root))
        }
        XCTAssertEqual(Library.tidy(p.settings), 1)
        XCTAssertEqual(p.entries, [p.root])
        XCTAssertTrue(p.settings.library[0].pinned)
    }

    func testAFileAddedIndividuallyInsideAFolderInTheLibrarySharesThatFoldersNotesFolder() {
        // With no .sniptoss yet, the notes for items in a folder are kept at the folder entry; files added individually (skipped by the scan)
        // must be kept in the same place rather than each working out its own
        let p = makeProject()
        let built = p.touch("dist/out.png")
        Library.add(p.settings, paths: [p.root, built])
        XCTAssertEqual(Library.outerFolder(p.settings, path: built), p.root)
        XCTAssertEqual(Library.outerFolder(p.settings, path: p.root), p.root)
        XCTAssertNil(Library.outerFolder(p.settings, path: NSTemporaryDirectory()))
    }

    func testRemovingClearsItAndEverythingInsideItFromTheExpandedRecordAndLeavesThingsNotInTheLibraryAlone() {
        let p = makeProject()
        let dir = p.dir("片子")
        let keep = p.dir("留着")
        Library.add(p.settings, paths: [dir, keep])
        p.settings.update { v in v.expanded = [dir, dir + "/子", keep] }
        XCTAssertEqual(Library.remove(p.settings, where: { $0.path == p.root + "/没有这个" }), 0)
        XCTAssertEqual(Library.remove(p.settings, where: { $0.path == dir }), 1)
        XCTAssertEqual(p.entries, [keep])
        XCTAssertEqual(p.settings.expanded, [keep])
    }

    func testPinnedEntriesGoToTheEndOfThePinnedAreaUnpinnedToTheStartOfTheNormalAreaAndNoMatchAtAllThrows() throws {
        let p = makeProject()
        let (a, b, c, d) = (p.dir("a"), p.dir("b"), p.dir("c"), p.dir("d"))
        Library.add(p.settings, paths: [a, b, c, d])
        try Library.pin(p.settings, paths: [a], pinned: true)
        try Library.pin(p.settings, paths: [d, b], pinned: true)  // several at once: ordered by their position in the library
        XCTAssertEqual(p.entries, [a, b, d, c])
        try Library.pin(p.settings, paths: [a], pinned: false)
        XCTAssertEqual(p.entries, [b, d, a, c])
        XCTAssertThrowsError(try Library.pin(p.settings, paths: [p.root + "/没有"], pinned: true)) { error in
            guard case LibraryError.notInLibrary = error else { return XCTFail("unexpected error \(error)") }
        }
        XCTAssertEqual(p.entries, [b, d, a, c])
    }

    func testRemovingAndPinningThousandsOfEntriesFinishesWithinSeconds() throws {
        // Remove / pin used to normalise paths "entries x entries to change" times
        let p = makeProject()
        let count = 1500
        let files = (0..<count).map { p.touch("a/\($0).png") }
        Library.add(p.settings, paths: files)
        p.settings.update { v in v.expanded = Array(files.prefix(50)) }

        var started = Date()
        try Library.pin(p.settings, paths: Array(files.prefix(count / 2)), pinned: true)
        var elapsed = Date().timeIntervalSince(started)
        XCTAssertEqual(p.settings.library.filter { $0.pinned }.count, count / 2)
        XCTAssertLessThan(elapsed, 20, "pinning took \(elapsed) s")

        started = Date()
        let removed = Library.remove(p.settings, where: { _ in true })
        elapsed = Date().timeIntervalSince(started)
        XCTAssertEqual(removed, count)
        XCTAssertTrue(p.entries.isEmpty)
        XCTAssertTrue(p.settings.expanded.isEmpty)
        XCTAssertLessThan(elapsed, 20, "removing took \(elapsed) s")
    }

    // MARK: Moved: locate it, and recognise it when added again

    func testLocatingReplacesTheEntryInPlaceAndPinPositionExpansionAndSelectionFollow() throws {
        let p = makeProject()
        let other = p.dir("别的")
        let old = p.dir("旧位置/片子")
        p.touch("旧位置/片子/镜头/01.png")
        Library.add(p.settings, paths: [other, old])
        try Library.pin(p.settings, paths: [old], pinned: true)
        p.settings.update { v in
            v.expanded = [old, old + "/镜头"]
            v.collapsed = [old]
            v.selected = old + "/镜头/01.png"
        }
        let moved = p.root + "/新位置/片子"
        try FileManager.default.createDirectory(atPath: (moved as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
        try FileManager.default.moveItem(atPath: old, toPath: moved)

        let r = try Library.relocate(p.settings, from: old, to: moved)

        XCTAssertEqual(r.to, moved)
        XCTAssertEqual(p.entries, [moved, other], "the pinned entry is still first and no extra entry was added")
        XCTAssertTrue(p.settings.library[0].pinned)
        XCTAssertEqual(p.settings.expanded, [moved, moved + "/镜头"])
        XCTAssertEqual(p.settings.collapsed, [moved])
        XCTAssertEqual(p.settings.selected, moved + "/镜头/01.png")
    }

    func testLocatingWhenTheNewLocationWasAlreadyAddedMergesThatEntryAndKeepsTheOriginalPosition() throws {
        let p = makeProject()
        let old = p.dir("旧/片子")
        let other = p.dir("别的")
        Library.add(p.settings, paths: [old])
        Library.add(p.settings, paths: [other])  // newly added entries go first: [别的, 片子]
        let moved = p.root + "/新/片子"
        try FileManager.default.createDirectory(atPath: (moved as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
        try FileManager.default.moveItem(atPath: old, toPath: moved)
        p.settings.update { v in v.library.insert(LibraryEntry(path: moved), at: 0) }  // the new location was added first

        try Library.relocate(p.settings, from: old, to: moved)

        XCTAssertEqual(p.entries, [other, moved])
    }

    func testLocatingToAPlaceThatDoesNotExistThrowsAndLeavesTheLibraryUnchanged() {
        let p = makeProject()
        let old = p.dir("片子")
        Library.add(p.settings, paths: [old])
        XCTAssertThrowsError(try Library.relocate(p.settings, from: old, to: p.root + "/没有这个")) { error in
            guard case LibraryError.notFound = error else { return XCTFail("unexpected error \(error)") }
        }
        XCTAssertEqual(p.entries, [old])
    }

    func testLocatingAnEntryThatIsNotInTheLibraryThrows() {
        let p = makeProject()
        let there = p.dir("片子")
        XCTAssertThrowsError(try Library.relocate(p.settings, from: p.root + "/不在", to: there)) { error in
            guard case LibraryError.notInLibrary = error else { return XCTFail("unexpected error \(error)") }
        }
    }

    func testAddingAMovedFolderBackIsRecognisedAsTheOriginalEntryAndReplacesItInPlace() throws {
        let p = makeProject()
        let old = p.dir("旧/片子")
        let other = p.dir("别的")
        Library.add(p.settings, paths: [old])
        Library.add(p.settings, paths: [other])
        try Library.pin(p.settings, paths: [old], pinned: true)
        let moved = p.root + "/新/片子"
        try FileManager.default.createDirectory(atPath: (moved as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
        try FileManager.default.moveItem(atPath: old, toPath: moved)

        let r = Library.add(p.settings, paths: [moved])

        XCTAssertEqual(r.relocated, [Library.Relocation(from: old, to: moved)])
        XCTAssertEqual(p.entries, [moved, other])
        XCTAssertTrue(p.settings.library[0].pinned)
    }

    func testSameNameButTheOriginalStillExistsIsNotAMoveAndAddsANewEntry() {
        let p = makeProject()
        let a = p.dir("甲/片子")
        let b = p.dir("乙/片子")
        Library.add(p.settings, paths: [a])
        let r = Library.add(p.settings, paths: [b])
        XCTAssertTrue(r.relocated.isEmpty)
        XCTAssertEqual(p.entries, [b, a])
    }

    func testAMovedSingleFileIsNotMatchedToOneWithADifferentExtension() throws {
        let p = makeProject()
        let old = p.touch("旧/封面.png")
        Library.add(p.settings, paths: [old])
        try FileManager.default.removeItem(atPath: old)
        let jpg = p.touch("新/封面.jpg")
        let png = p.touch("新/封面.png")
        XCTAssertTrue(Library.add(p.settings, paths: [jpg]).relocated.isEmpty)
        XCTAssertEqual(Library.add(p.settings, paths: [png]).relocated, [Library.Relocation(from: old, to: png)])
    }

    // MARK: Volumes that are not mounted

    func testANewFolderWithTheSameNameWhileTheOriginalIsOnAnUnpluggedVolumeIsNotAMoveAndAddsANewEntry() {
        // While the drive is unplugged its entry is also "not found"; adding a same-named folder (a common name like assets)
        // used to replace it, and the entry was gone when the drive came back
        let p = makeProject()
        let offline = absentVolume() + "/旧/片子"
        p.settings.update { v in v.library.append(LibraryEntry(path: offline)) }
        let other = p.dir("新/片子")

        let r = Library.add(p.settings, paths: [other])

        XCTAssertTrue(r.relocated.isEmpty)
        XCTAssertEqual(r.added, [other])
        XCTAssertEqual(p.entries, [other, offline])
    }

    func testAddingSomethingOnAnUnpluggedVolumeReportsNotFoundAndLeavesTheLibraryUnchanged() {
        let p = makeProject()
        let offline = absentVolume() + "/片子/a.png"
        let r = Library.add(p.settings, paths: [offline])
        XCTAssertTrue(r.added.isEmpty)
        XCTAssertEqual(r.skipped, ["File or folder not found: \(offline)"])
        XCTAssertTrue(p.entries.isEmpty)
    }

    func testAVolumeIsRecognisedByItsMountPointUnderVolumes() {
        XCTAssertEqual(Volumes.rootOf("/Volumes/Disk/a/b.png"), "/Volumes/Disk")
        XCTAssertEqual(Volumes.rootOf("/Volumes/Disk"), "/Volumes/Disk")
        XCTAssertEqual(Volumes.rootOf("/Volumes//Disk/./x"), "/Volumes/Disk")
        XCTAssertEqual(Volumes.rootOf("/volumes/Disk/x"), "/Volumes/Disk")
        XCTAssertNil(Volumes.rootOf("/Volumes"))
        XCTAssertNil(Volumes.rootOf("/Users/me/Volumes/Disk"))
        XCTAssertNil(Volumes.rootOf("/"))
        XCTAssertNil(Volumes.rootOf("not\0valid"))
    }

    func testAVolumeThatIsNotMountedIsNotThereAndEverythingElseIs() {
        let p = makeProject()
        XCTAssertTrue(Volumes.isThere(p.root))
        XCTAssertTrue(Volumes.isThere("/"))
        XCTAssertFalse(Volumes.isThere(absentVolume() + "/片子"))
        XCTAssertTrue(Volumes.isThere("/Volumes"))
    }

    // MARK: Paths

    func testInsideExcludesThePathItself() {
        // The root is the key "\", and comparing it against itself as a prefix must not make it inside itself
        XCTAssertFalse(Library.inside("/", "/"))
        XCTAssertFalse(Library.inside("/a", "/a/"))
        XCTAssertTrue(Library.inside("/a", "/"))
        XCTAssertFalse(Library.inside("/ab", "/a"))
        XCTAssertTrue(Library.inside("/A/b.png", "/a"))
        XCTAssertTrue(Library.inside("/a/b/../c/d.png", "/a/c"))
    }

    func testNormalisingStripsTrailingSlashesResolvesDotSegmentsKeepsTheRootAndLeavesInvalidPathsAsTheyAre() throws {
        XCTAssertEqual(try Library.norm("/a/./c/../b/"), "/a/b")
        XCTAssertEqual(try Library.norm("/"), "/")
        XCTAssertEqual(try Library.norm("//a///b"), "/a/b")
        XCTAssertEqual(try Library.norm("/.."), "/")
        XCTAssertEqual(try Library.norm("/项目/素材/"), "/项目/素材")
        XCTAssertThrowsError(try Library.norm(""))
        XCTAssertThrowsError(try Library.norm("/a\0b"))
        XCTAssertTrue(Library.same("/A/B.PNG", "/a/b.png"))
        XCTAssertFalse(Library.same("/a/b.png", "/a/b.jpg"))
        XCTAssertEqual(Library.key("/a/\0b"), Library.keyOf("/a/\0b"), "a path that can't be normalised is compared as it is, and never throws")
        let has = Library.contains(["/项目/素材", "/x.png"])
        XCTAssertTrue(has("/项目/素材/"))
        XCTAssertTrue(has("/项目/./素材"))
        XCTAssertFalse(has("/项目"))
        XCTAssertFalse(has("/x\0.png"))
    }

    func testARelativePathIsTakenFromTheCurrentFolder() throws {
        let cwd = FileManager.default.currentDirectoryPath
        let relative = try Library.norm("sub/../a.png")
        let absolute = try Library.norm(cwd + "/a.png")
        XCTAssertEqual(relative, absolute)
    }

    func testTheComparisonKeyIsTheSameAsKeyOfInTheUI() {
        // The same cases as packages/web/test/host.test.ts
        XCTAssertEqual(Library.keyOf("/Users/Alex/P"), "\\users\\alex\\p")
        XCTAssertTrue(Library.keyOf("/Users/Alex/P/a.png").hasPrefix(Library.keyOf("/Users/Alex/P") + "\\"))
        XCTAssertEqual(Library.keyOf("E:/Proj/A.PNG"), "e:\\proj\\a.png")
        XCTAssertEqual(Library.keyOf("E:\\"), "e:\\")
        // macOS can hand over the same name composed or decomposed
        let composed = "caf\u{E9}"
        let decomposed = "cafe\u{301}"
        XCTAssertEqual(Library.keyOf("/Users/alex/\(decomposed).png"), Library.keyOf("/Users/alex/\(composed).png"))
        XCTAssertTrue(Library.same("/Users/alex/\(decomposed).png", "/Users/alex/\(composed).png"))
        // Only the slash is replaced, not a slash followed by a combining mark glued to it
        XCTAssertEqual(Library.keyOf("/a/\u{301}b"), "\\a\\\u{301}b")
    }

    func testPartsOfAPath() {
        XCTAssertEqual(Library.components("/a//b/c/"), ["a", "b", "c"])
        XCTAssertEqual(Library.nameOf("/a/b/c.png"), "c.png")
        XCTAssertEqual(Library.nameOf("/a/b/"), "b")
        XCTAssertEqual(Library.extensionOf("/a/b.d/c.PNG"), ".PNG")
        XCTAssertEqual(Library.extensionOf("/a/b.d/c"), "")
        XCTAssertEqual(Library.extensionOf("/a/c."), "")
        XCTAssertEqual(Library.extensionOf("/a/.png"), ".png")
        XCTAssertEqual(Library.parentDirectory(of: "/a/b/c.png"), "/a/b")
        XCTAssertEqual(Library.parentDirectory(of: "/a.png"), "/")
        XCTAssertNil(Library.parentDirectory(of: "/"))
        XCTAssertNil(Library.parentDirectory(of: "a.png"))
        XCTAssertEqual(Library.ancestorKeys(of: "\\a\\b\\c"), ["\\a\\b", "\\a", "\\"])
        XCTAssertEqual(Library.ancestorKeys(of: "\\"), [])
    }

    func testAddingTheSameThingAgainInADifferentSpellingOrTwiceInOneBatchCountsOnceAndLocatesIt() {
        let p = makeProject()
        let dir = p.dir("片子")
        Library.add(p.settings, paths: [dir])
        var spellings = [dir + "/", dir + "/./", p.root + "//片子"]
        if isCaseInsensitive(p.root) { spellings.append(dir.uppercased()) }
        var r = Library.add(p.settings, paths: spellings)
        XCTAssertTrue(r.added.isEmpty)
        XCTAssertEqual(r.focus?.lowercased(), dir.lowercased())
        let file = p.touch("单张.png")
        r = Library.add(p.settings, paths: [file, file])
        XCTAssertEqual(r.added, [file])
        XCTAssertEqual(p.entries, [file, dir])
    }

    func testUnsupportedMissingAndMalformedPathsAreNeitherAddedNorLocatedAndTheReasonIsGiven() {
        let p = makeProject()
        let txt = p.touch("说明.txt")
        let missing = p.root + "/没有这个.png"
        let r = Library.add(p.settings, paths: [txt, missing, "/a\0b.png"])
        XCTAssertTrue(r.added.isEmpty)
        XCTAssertNil(r.focus)
        XCTAssertEqual(r.skipped, ["Unsupported file type (.txt): 说明.txt", "File or folder not found: \(missing)", "Invalid path: /a\0b.png"])
        XCTAssertTrue(p.entries.isEmpty)
    }

    func testAddingSeveralAtOncePlacesThemAfterThePinnedAndBeforeTheRestInTheGivenOrderAndLocatesTheFirstOpenable() throws {
        let p = makeProject()
        let pinned = p.dir("置顶的")
        let old = p.dir("原来的")
        Library.add(p.settings, paths: [pinned, old])
        try Library.pin(p.settings, paths: [pinned], pinned: true)
        let (a, b, c) = (p.touch("新/a.png"), p.dir("新/b"), p.touch("新/c.mp4"))
        let r = Library.add(p.settings, paths: [p.touch("新/不认.txt"), a, b, c])
        XCTAssertEqual(r.focus, a)
        XCTAssertEqual(p.entries, [pinned, a, b, c, old])
    }
}
