import XCTest

@testable import SnipToss

/// Rules of the folder scan (MaterialScanner): which files are recognised, what is skipped, and what happens with unreadable folders,
/// links and the limit
final class MaterialScannerTests: SnipTestCase {
    private let all: Set<String> = ["image", "video"]

    /// Creates a three-byte file at a relative path and returns its absolute path
    @discardableResult
    private func touch(_ root: String, _ rel: String) -> String {
        let full = root + "/" + rel
        try! FileManager.default.createDirectory(atPath: (full as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
        FileManager.default.createFile(atPath: full, contents: Data([1, 2, 3]))
        return full
    }

    /// Relative paths of what a scan lists, sorted
    private func listed(
        _ root: String, kinds: Set<String>? = nil, skip: Set<String> = [], limit: Int = MaterialScanner.limit,
        stats: MaterialScanner.Stats? = nil
    ) -> [String] {
        MaterialScanner.scan(root, enabledKinds: kinds ?? all, skipDirs: skip, limit: limit, stats: stats)
            .map { String($0.fullPath.dropFirst(root.count + 1)) }.sorted()
    }

    private func hide(_ path: String) throws {
        var url = URL(fileURLWithPath: path)
        var values = URLResourceValues()
        values.isHidden = true
        try url.setResourceValues(values)
    }

    // MARK: What is recognised

    func testRecognisedExtensionsAreEighteenImageTypesAndFiveVideoTypesWithoutRegardToCase() {
        let images = [
            ".png", ".jpg", ".jpeg", ".jfif", ".jpe", ".pjpeg", ".pjp", ".webp", ".gif", ".apng", ".bmp", ".avif", ".ico", ".svg",
            ".tif", ".tiff", ".heic", ".heif",
        ]
        for ext in images { XCTAssertEqual(MaterialKinds.kindOf("a" + ext.uppercased()), "image", ext) }
        for ext in [".mp4", ".webm", ".mov", ".m4v", ".mkv"] { XCTAssertEqual(MaterialKinds.kindOf("a" + ext), "video", ext) }
        for ext in [".pdf", ".pptx", ".ppt", ".txt", ".psd", ".jxl", ".avi", ".svgz", ""] {
            XCTAssertNil(MaterialKinds.kindOf("a" + ext), ext)
        }
        XCTAssertEqual(MaterialKinds.extensions.count, 23)
        XCTAssertEqual(MaterialScanner.limit, 20000)
    }

    func testMoreFormatsAreListedOnlyWhenTurnedOnAndCountedWhenLeftOut() {
        let dir = makeTempDir()
        let names = ["a.png", "b.jpg", "c.svg", "d.mp4", "e.m4v", "f.tif", "g.heic", "h.ico", "i.apng", "j.jfif", "k.mkv"]
        for name in names { touch(dir, name) }
        let off = MaterialScanner.Stats()
        XCTAssertEqual(listed(dir, kinds: ["image", "video"], stats: off), ["a.png", "b.jpg", "c.svg", "d.mp4", "e.m4v"])
        XCTAssertEqual(off.moreOff, 6)
        XCTAssertEqual(off.sortedMoreOffExts, ["apng", "heic", "ico", "jfif", "mkv", "tif"])
        XCTAssertEqual(off.others, 0)
        // With videos turned off the MKV is left out like the MP4, not reported as a More format
        let noVideo = MaterialScanner.Stats()
        _ = listed(dir, kinds: ["image"], stats: noVideo)
        XCTAssertFalse(noVideo.moreOffExts.contains("mkv"))
        let on = MaterialScanner.Stats()
        XCTAssertEqual(listed(dir, kinds: ["image", "video", MaterialKinds.moreKind], stats: on).count, 11)
        XCTAssertEqual(on.moreOff, 0)
    }

    func testPDFAndSlidesAreNeverListedEvenWhenTheirKindsAreEnabled() {
        let dir = makeTempDir()
        touch(dir, "文档/说明.pdf")
        touch(dir, "文档/方案.pptx")
        XCTAssertEqual(listed(dir, kinds: ["image", "video", "pdf", "slides"]), [])
        XCTAssertFalse(MaterialKinds.extensions.contains(".pdf"))
    }

    func testScanCountsUnsupportedFilesAndRecordsSkippedFolders() {
        // The end of the folder says "N more files not supported yet" and "folders skipped"
        let dir = makeTempDir()
        touch(dir, "a.png")
        touch(dir, "设计/封面.psd")
        touch(dir, "设计/图标.AI")
        touch(dir, "文档/说明.pdf")
        touch(dir, "文档/readme.txt")  // not item-like, so not counted
        touch(dir, "dist/b.png")
        touch(dir, "node_modules/x/c.png")
        let stats = MaterialScanner.Stats()
        XCTAssertEqual(listed(dir, skip: ["node_modules", "dist"], stats: stats), ["a.png"])
        XCTAssertEqual(stats.others, 3)
        XCTAssertEqual(stats.sortedOtherExts, ["ai", "pdf", "psd"])
        XCTAssertEqual(stats.skippedDirs, ["dist", "node_modules"])
    }

    func testOfficeLockFilesAreNotListedAndNotCountedAsUnsupported() {
        let dir = makeTempDir()
        touch(dir, "a.png")
        touch(dir, "~$a.png")
        touch(dir, "方案.pptx")
        touch(dir, "~$方案.pptx")
        let stats = MaterialScanner.Stats()
        XCTAssertEqual(listed(dir, stats: stats), ["a.png"])
        XCTAssertEqual(stats.others, 1)
        XCTAssertEqual(stats.sortedOtherExts, ["pptx"])
    }

    func testDisabledKindsAreNotListedAndNotCountedAsUnsupported() {
        let dir = makeTempDir()
        touch(dir, "a.png")
        touch(dir, "b.mp4")
        let stats = MaterialScanner.Stats()
        XCTAssertEqual(listed(dir, kinds: ["image"], stats: stats), ["a.png"])
        XCTAssertEqual(stats.others, 0)
    }

    // MARK: Hidden things and skipped folders

    func testDotPrefixedFilesAndFoldersAndTheMacsOwnLitterAreLeftOutAndNotCountedAsUnsupported() {
        let dir = makeTempDir()
        touch(dir, "看得见.png")
        touch(dir, ".cache/a.png")
        touch(dir, ".点开头.png")
        touch(dir, ".DS_Store")
        touch(dir, "._看得见.png")  // the AppleDouble companion a copy to a non-Mac volume leaves behind
        touch(dir, ".hidden/c.psd")
        let stats = MaterialScanner.Stats()
        XCTAssertEqual(listed(dir, stats: stats), ["看得见.png"])
        XCTAssertEqual(stats.others, 0)
    }

    func testFilesAndFoldersWithTheHiddenFlagAreLeftOutLikeDotFiles() throws {
        let dir = makeTempDir()
        touch(dir, "看得见.png")
        let flagged = touch(dir, "隐藏的.png")
        touch(dir, "隐藏夹/b.png")
        touch(dir, "隐藏夹/c.psd")
        do {
            try hide(flagged)
            try hide(dir + "/隐藏夹")
        } catch {
            throw XCTSkip("the hidden flag can't be set here: \(error)")
        }
        let stats = MaterialScanner.Stats()
        XCTAssertEqual(listed(dir, stats: stats), ["看得见.png"])
        XCTAssertEqual(stats.others, 0)
    }

    func testSkippedFoldersMatchWithoutRegardToCaseAreNotEnteredAtAnyDepthAndAreRecordedOnce() {
        let dir = makeTempDir()
        touch(dir, "a.png")
        touch(dir, "DIST/深/b.png")
        touch(dir, "子/dist/c.png")
        touch(dir, "子/d.png")
        let stats = MaterialScanner.Stats()
        XCTAssertEqual(listed(dir, skip: ["dist"], stats: stats), ["a.png", "子/d.png"])
        XCTAssertEqual(stats.skippedDirs.map { $0.uppercased() }, ["DIST"])
    }

    // MARK: Links, unreadable folders, odd files

    func testALinkToAFolderPointingBackUpIsNotEntered() throws {
        let dir = makeTempDir()
        touch(dir, "a.png")
        try FileManager.default.createSymbolicLink(atPath: dir + "/回环", withDestinationPath: dir)
        let started = Date()
        XCTAssertEqual(listed(dir), ["a.png"])
        XCTAssertLessThan(Date().timeIntervalSince(started), 5)
    }

    func testALinkToAFileIsListedWithTheTargetsSizeAndOneThatPointsNowhereIsNot() throws {
        let dir = makeTempDir()
        let elsewhere = makeTempDir()
        writeText("0123456789", to: elsewhere + "/real.png")
        try FileManager.default.createSymbolicLink(atPath: dir + "/link.png", withDestinationPath: elsewhere + "/real.png")
        try FileManager.default.createSymbolicLink(atPath: dir + "/gone.png", withDestinationPath: elsewhere + "/none.png")
        let found = MaterialScanner.scan(dir, enabledKinds: all, skipDirs: [])
        XCTAssertEqual(found.map { $0.fullPath }, [dir + "/link.png"])
        XCTAssertEqual(found.first?.size, 10)
        XCTAssertNil(MaterialScanner.describe(dir + "/gone.png"))
    }

    func testAnUnreadableSubfolderIsSkippedAndTheRestIsListed() throws {
        try XCTSkipIf(geteuid() == 0, "root can read any folder")
        let dir = makeTempDir()
        touch(dir, "a.png")
        touch(dir, "锁住/b.png")
        let locked = dir + "/锁住"
        XCTAssertEqual(chmod(locked, 0o000), 0)
        defer { _ = chmod(locked, 0o755) }
        XCTAssertThrowsError(try FileManager.default.contentsOfDirectory(atPath: locked), "it really cannot be read")
        XCTAssertEqual(listed(dir), ["a.png"])
    }

    func testAPipeOrOtherSpecialFileWithAnItemNameIsNotAnItem() {
        let dir = makeTempDir()
        touch(dir, "a.png")
        XCTAssertEqual(mkfifo(dir + "/pipe.png", 0o644), 0)
        XCTAssertEqual(listed(dir), ["a.png"])
        XCTAssertNil(MaterialScanner.describe(dir + "/pipe.png"))
    }

    // MARK: The limit

    func testScanStopsAtTheLimit() {
        let dir = makeTempDir()
        for i in 0..<5 { touch(dir, "图/\(i).png") }
        XCTAssertEqual(listed(dir, limit: 3).count, 3)
        XCTAssertEqual(listed(dir).count, 5)
    }

    func testWhichItemsAreCutOffAtTheLimitDoesNotDependOnTheDisksOrder() {
        let dir = makeTempDir()
        for name in ["3.png", "0.png", "4.png", "1.png", "2.png"] { touch(dir, name) }
        XCTAssertEqual(listed(dir, limit: 3), ["0.png", "1.png", "2.png"])
    }

    func testReachingTheLimitExactlyIsNotTruncationOneMoreIs() {
        let dir = makeTempDir()
        for i in 0..<3 { touch(dir, "图/\(i).png") }
        let exact = MaterialScanner.Stats()
        XCTAssertEqual(listed(dir, limit: 3, stats: exact).count, 3)
        XCTAssertFalse(exact.truncated, "exactly 20,000 items used to be flagged as too many")
        touch(dir, "图/3.png")
        let more = MaterialScanner.Stats()
        XCTAssertEqual(listed(dir, limit: 3, stats: more).count, 3)
        XCTAssertTrue(more.truncated)
    }

    // MARK: What a result carries

    func testResultsCarryTheFilesSizeModifiedTimeAndCreatedTime() throws {
        let dir = makeTempDir()
        let file = touch(dir, "子/a.png")
        // A time with an exact binary fraction, so milliseconds come out exact
        let when = Date(timeIntervalSince1970: 1_790_843_415.5)
        try FileManager.default.setAttributes([.modificationDate: when], ofItemAtPath: file)
        let found = MaterialScanner.scan(dir, enabledKinds: all, skipDirs: [])
        XCTAssertEqual(found.count, 1)
        let item = try XCTUnwrap(found.first)
        XCTAssertEqual(item.fullPath, file)
        XCTAssertEqual(item.kind, "image")
        XCTAssertEqual(item.size, 3)
        XCTAssertEqual(item.mtime, 1_790_843_415_500)
        let created = try XCTUnwrap(FileManager.default.attributesOfItem(atPath: file)[.creationDate] as? Date)
        XCTAssertEqual(Double(item.ctime), created.timeIntervalSince1970 * 1000, accuracy: 2)
        XCTAssertEqual(MaterialScanner.describe(file), item)
        XCTAssertNil(MaterialScanner.describe(dir + "/没有.png"))
        XCTAssertNil(MaterialScanner.describe(dir + "/子"), "a folder is not an item")
        XCTAssertNil(MaterialScanner.describe(touch(dir, "说明.txt")), "an unsupported extension is not an item")
    }
}
