import AppKit
import XCTest

@testable import SnipToss

/// The main app's Copy as Images: how the image is composed, what goes on the clipboard, and the `copyImages` method with the parameters
/// as the page sends them. The same rules as the Windows shell's (tests/AppTests/HandoffImagesTests.cs). The system clipboard is never
/// touched: a recorder stands in for it
final class HandoffImagesTests: SnipTestCase {
    private let orange = MarkColor(hex: 0xff6a3d)

    private final class RecordingClipboard: HandoffClipboard {
        private(set) var images: [(png: Data, tiff: Data?)] = []
        private(set) var files: [[String]] = []
        var fails = false

        func putImage(png: Data, tiff: Data?) throws {
            if fails { throw HandoffImages.Failure.clipboardBusy }
            images.append((png: png, tiff: tiff))
        }

        func putFiles(_ paths: [String]) throws {
            if fails { throw HandoffImages.Failure.clipboardBusy }
            files.append(paths)
        }
    }

    /// A solid-color PNG standing in for a screenshot; returns its path
    private func shot(_ dir: String, _ name: String, _ w: Int, _ h: Int, _ color: MarkColor) -> String {
        let context = CGContext(
            data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
        context.setFillColor(color.nsColor.cgColor)
        context.fill(CGRect(x: 0, y: 0, width: w, height: h))
        let path = dir + "/" + name
        try! FileManager.default.createDirectory(atPath: (path as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
        try! CaptureOutput.png(context.makeImage()!, scale: 1)!.write(to: URL(fileURLWithPath: path))
        return path
    }

    private func note(_ number: Int = 1, body: String = "标题字太细了，换成粗一点的黑体", group: String? = nil) -> NoteEntry {
        NoteEntry(number: number, color: orange, category: "change", whereText: "区域 画面左上（横 12%–52%、纵 8%–18%）", body: body, group: group)
    }

    /// A page with one note whose picture is a stored snapshot
    private func item(_ shot: String?, name: String = "hero.png 第1条", body: String = "标题字太细了，换成粗一点的黑体") -> HandoffImages.Page {
        HandoffImages.Page(picture: nil, snapshot: shot, title: "示例项目 / assets/hero.png", notes: [note(body: body)], name: name)
    }

    /// The PNG bytes of a solid-color picture
    private func pictureBytes(_ dir: String, _ name: String, _ w: Int, _ h: Int, _ color: MarkColor) throws -> Data {
        try Data(contentsOf: URL(fileURLWithPath: shot(dir, name, w, h, color)))
    }

    /// The height of a page's notes area: with the title and without it, so that an empty title is seen to take no header line
    private func notesHeight(_ page: HandoffImages.Page, pictureHeight: Int, extra: String? = nil) throws -> Int {
        let titled = try HandoffImages.render(page, extra: extra).image.height
        var untitled = page
        untitled.title = ""
        let bare = try HandoffImages.render(untitled, extra: extra).image.height
        XCTAssertGreaterThan(titled, bare, "an empty title still takes a header line")
        return bare - pictureHeight
    }

    /// The bytes of a picture, top row first
    private func rgba(_ image: CGImage) -> [UInt8] {
        var bytes = [UInt8](repeating: 0, count: image.width * image.height * 4)
        bytes.withUnsafeMutableBytes { buffer in
            let context = CGContext(
                data: buffer.baseAddress, width: image.width, height: image.height, bitsPerComponent: 8, bytesPerRow: image.width * 4,
                space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
            context.draw(image, in: CGRect(x: 0, y: 0, width: image.width, height: image.height))
        }
        return bytes
    }

    private func pixel(_ bytes: [UInt8], width: Int, _ x: Int, _ y: Int) -> [UInt8] {
        Array(bytes[(y * width + x) * 4..<(y * width + x) * 4 + 3])
    }

    /// The same color, give or take rounding
    private func near(_ a: [UInt8], _ b: [UInt8]) -> Bool {
        zip(a, b).allSatisfy { abs(Int($0) - Int($1)) <= 2 }
    }

    /// The size in pixels of a PNG
    private func pixelSize(of png: Data) -> (width: Int, height: Int)? {
        guard let rep = NSBitmapImageRep(data: png) else { return nil }
        return (rep.pixelsWide, rep.pixelsHigh)
    }

    // MARK: The image

    func testANoteWithAScreenshotIsTitleThenTheScreenshotUnscaledThenTheNotesAreaTopToBottom() throws {
        let dir = makeTempDir()
        let green: [UInt8] = [0x20, 0xc0, 0x60]
        let drawn = try HandoffImages.render(item(shot(dir, "a.png", 1200, 600, MarkColor(r: 0x20, g: 0xc0, b: 0x60))), extra: nil)
        // The screenshot is wider than the minimum width: the image is as wide as the screenshot, which is not scaled
        let w = drawn.image.width
        let h = drawn.image.height
        XCTAssertEqual(w, 1200)
        XCTAssertGreaterThan(h, 600 + 40, "the title and the notes area were not added")
        let px = rgba(drawn.image)
        // In the middle column the screenshot is one run of exactly 600 rows, with the title above and the notes area below
        let rows = (0..<h).filter { near(pixel(px, width: w, 600, $0), green) }
        XCTAssertEqual(rows.count, 600)
        let first = try XCTUnwrap(rows.first)
        let last = try XCTUnwrap(rows.last)
        XCTAssertEqual(last - first, 599, "one run")
        XCTAssertGreaterThan(first, 20)
        XCTAssertLessThan(last, h - 40)
        // The top strip is the title's background
        XCTAssertEqual(pixel(px, width: w, 2, 2), [0x14, 0x14, 0x16])
        // The PNG is the same picture
        let size = try XCTUnwrap(pixelSize(of: drawn.png))
        XCTAssertEqual([size.width, size.height], [w, h])
        XCTAssertGreaterThan(drawn.png.count, 1000)
    }

    func testAScreenshotNarrowerThanTheMinimumIsCenteredOnAnImageOfTheMinimumWidth() throws {
        let dir = makeTempDir()
        let drawn = try HandoffImages.render(item(shot(dir, "a.png", 400, 300, MarkColor(r: 0x20, g: 0xc0, b: 0x60))), extra: nil)
        XCTAssertEqual(drawn.image.width, HandoffImages.minWidth)
        let px = rgba(drawn.image)
        let w = drawn.image.width
        let row = (0..<drawn.image.height).first { near(pixel(px, width: w, 360, $0), [0x20, 0xc0, 0x60]) }
        let y = try XCTUnwrap(row) + 10
        // 400 wide in the middle of 720: 160 on each side
        XCTAssertTrue(near(pixel(px, width: w, 160, y), [0x20, 0xc0, 0x60]))
        XCTAssertTrue(near(pixel(px, width: w, 559, y), [0x20, 0xc0, 0x60]))
        XCTAssertFalse(near(pixel(px, width: w, 158, y), [0x20, 0xc0, 0x60]))
        XCTAssertFalse(near(pixel(px, width: w, 561, y), [0x20, 0xc0, 0x60]))
    }

    func testWithoutAScreenshotThereIsOnlyATitleAndNotesAreaAtLeast720Wide() throws {
        let drawn = try HandoffImages.render(item(nil), extra: nil)
        XCTAssertEqual(drawn.image.width, 720)
        XCTAssertTrue((60...400).contains(drawn.image.height), "height \(drawn.image.height)")
    }

    func testAnUnreadableOrMissingScreenshotIsTreatedAsNoneWithoutThrowing() throws {
        let dir = makeTempDir()
        writeText("不是图片", to: dir + "/bad.png")
        XCTAssertEqual(try HandoffImages.render(item(dir + "/bad.png"), extra: nil).image.width, 720)
        XCTAssertEqual(try HandoffImages.render(item(dir + "/not-there.png"), extra: nil).image.width, 720)
        // A folder where a file was expected
        XCTAssertEqual(try HandoffImages.render(item(dir), extra: nil).image.width, 720)
    }

    func testAWideScreenshotScalesTheTextUpAndALongNoteIsNotTruncated() throws {
        let dir = makeTempDir()
        let wide = shot(dir, "wide.png", 1600, 900, MarkColor(hex: 0x808080))
        let short = try HandoffImages.render(item(wide), extra: nil).image.height - 900
        let longBody = String(repeating: "这里的字要换成粗黑体，颜色再深一点。", count: 20)
        let long = try HandoffImages.render(item(wide, body: longBody), extra: nil).image.height - 900
        XCTAssertGreaterThan(long, short + 60, "the notes area of the long note (\(long)) is not taller than the short one (\(short)): no line wrapping")
        let narrow = try HandoffImages.render(item(shot(dir, "narrow.png", 800, 450, MarkColor(hex: 0x808080))), extra: nil).image.height - 450
        XCTAssertGreaterThan(short, narrow, "the notes area of the wide image (\(short)) is not taller than the narrow one (\(narrow)): the text was not scaled up")
    }

    func testTheExtraInstructionsAreAParagraphAtTheEndOfTheNotesArea() throws {
        let without = try HandoffImages.render(item(nil), extra: nil).image.height
        XCTAssertGreaterThan(try HandoffImages.render(item(nil), extra: "改完重新导出一版").image.height, without)
        // Only white space: nothing is added
        XCTAssertEqual(try HandoffImages.render(item(nil), extra: " \n ").image.height, without)
    }

    func testThePngSaysOnePixelIsOnePoint() throws {
        let drawn = try HandoffImages.render(item(nil), extra: nil)
        let rep = try XCTUnwrap(NSBitmapImageRep(data: drawn.png))
        XCTAssertEqual(rep.size, NSSize(width: rep.pixelsWide, height: rep.pixelsHigh))
    }

    // MARK: Pages of several notes

    func testAPictureFromThePageIsUsedAsIsAndWinsOverTheSnapshot() throws {
        let dir = makeTempDir()
        let blue: [UInt8] = [0x20, 0x60, 0xc0]
        let picture = try pictureBytes(dir, "frame.png", 1000, 500, MarkColor(r: 0x20, g: 0x60, b: 0xc0))
        var page = HandoffImages.Page(
            picture: picture, snapshot: shot(dir, "old.png", 1400, 700, MarkColor(hex: 0x808080)), title: "示例项目 / assets/hero.png",
            notes: [note(1), note(2)], name: "hero.png")
        let drawn = try HandoffImages.render(page, extra: nil)
        XCTAssertEqual(drawn.image.width, 1000)
        let y = try drawn.image.height - notesHeight(page, pictureHeight: 500) - 250
        XCTAssertTrue(near(pixel(rgba(drawn.image), width: drawn.image.width, 500, y), blue), "the middle of the picture is the page's picture")
        // Bytes that are not an image fall back to the snapshot
        page.picture = Data([1, 2, 3])
        XCTAssertEqual(try HandoffImages.render(page, extra: nil).image.width, 1400)
    }

    func testSeveralNotesShareOneNotesAreaAndGoIntoTwoColumnsWhenTallerThanThePicture() throws {
        let dir = makeTempDir()
        let notes = (1...8).map { note($0) }
        func page(_ height: Int, _ notes: [NoteEntry]) throws -> HandoffImages.Page {
            HandoffImages.Page(
                picture: try pictureBytes(dir, "p\(height).png", 1600, height, MarkColor(hex: 0x808080)), snapshot: nil, title: "示例项目 / a.png",
                notes: notes, name: "a.png")
        }
        // The picture is taller than the notes: one column
        let one = try notesHeight(page(3000, notes), pictureHeight: 3000)
        let two = try notesHeight(page(300, notes), pictureHeight: 300)
        let single = try notesHeight(page(3000, Array(notes.prefix(1))), pictureHeight: 3000)
        XCTAssertGreaterThan(one, single * 4, "eight notes (\(one)) are not much taller than one (\(single))")
        XCTAssertLessThan(Double(two), Double(one) * 0.7, "notes beside a short picture (\(two)) are as tall as in one column (\(one)): not split into two columns")
    }

    func testNotesOfSeveralItemsGetTheItemsNameAsAHeadingWhereItChanges() {
        let entries = [note(1, group: "assets/a.png"), note(2, group: "assets/a.png"), note(1, group: "assets/b.png")]
        let grouped = NotesBlock.build(entries: entries, overall: nil, title: nil, extra: nil, imageWidth: 1200, s: 1)
        let texts = grouped.texts()
        XCTAssertEqual(texts.filter { $0.hasPrefix("assets/") }, ["assets/a.png", "assets/b.png"])
        XCTAssertEqual(texts.firstIndex(of: "assets/a.png"), 0)
        // After the two notes of a.png (a head line and a body each)
        XCTAssertEqual(texts.firstIndex(of: "assets/b.png"), 5)
        let plain = NotesBlock.build(
            entries: entries.map { var e = $0; e.group = nil; return e }, overall: nil, title: nil, extra: nil, imageWidth: 1200, s: 1)
        XCTAssertGreaterThan(grouped.height, plain.height)
        // In two columns, a group that continues in the right column is named again at its top
        let many = (1...8).map { note($0, group: "assets/a.png") }
        let split = NotesBlock.build(entries: many, overall: nil, title: nil, extra: nil, imageWidth: 1200, s: 1, imageHeight: 100)
        XCTAssertTrue(split.twoColumns)
        XCTAssertEqual(split.texts().filter { $0 == "assets/a.png" }.count, 2)
    }

    func testTheClosingParagraphIsWrittenOnTheLastImageOnly() throws {
        let dir = makeTempDir()
        let page = item(shot(dir, "a.png", 800, 400, MarkColor(hex: 0x808080)))
        let extra = "改完重新导出一版"
        let prepared = try HandoffImages.prepare([page, page], extra: extra, folder: dir + "/handoff")
        guard case .files(let files) = prepared.payload else { return XCTFail("two images are files") }
        let heights = try files.map { try XCTUnwrap(pixelSize(of: Data(contentsOf: URL(fileURLWithPath: $0)))).height }
        XCTAssertEqual(heights[0], try HandoffImages.render(page, extra: nil).image.height)
        XCTAssertEqual(heights[1], try HandoffImages.render(page, extra: extra).image.height)
        XCTAssertGreaterThan(heights[1], heights[0])
    }

    func testStashedPicturesAreKeptForOneBatchAndDroppedAfterTheCopy() {
        let stash = HandoffStash()
        let a = stash.stash(batch: "one", png: Data([1]))
        let b = stash.stash(batch: "one", png: Data([2]))
        XCTAssertNotEqual(a, b)
        XCTAssertEqual(stash.picture(a), Data([1]))
        XCTAssertEqual(stash.picture(b), Data([2]))
        // A new batch drops the pictures of the one before
        let c = stash.stash(batch: "two", png: Data([3]))
        XCTAssertNil(stash.picture(a))
        XCTAssertEqual(stash.picture(c), Data([3]))
        // Done with a batch that is no longer kept: the current one stays
        stash.drop(batches: ["one"])
        XCTAssertEqual(stash.picture(c), Data([3]))
        stash.drop(batches: ["one", "two"])
        XCTAssertNil(stash.picture(c))
        XCTAssertNil(stash.picture("unknown"))
        XCTAssertEqual(HandoffStash.batch(of: "lq3x-ab12/7"), "lq3x-ab12")
        XCTAssertEqual(HandoffStash.batch(of: "a/b/3"), "a/b")
        XCTAssertEqual(HandoffStash.batch(of: "plain"), "plain")
    }

    func testALongTitleIsCutAtACharacterWithAnEllipsisAndAShortOneIsLeftAlone() {
        let long = String(repeating: "很长的路径", count: 40)
        let line = HandoffImages.titleLine(long, size: 13, maxWidth: 300)
        XCTAssertTrue(line.string.hasSuffix("…"))
        XCTAssertLessThanOrEqual(line.size().width, 300)
        let kept = String(line.string.dropLast())
        XCTAssertTrue(long.hasPrefix(kept))
        // As much as fits: one character more would not
        let oneMore = NSAttributedString(string: String(long.prefix(kept.count + 1)) + "…", attributes: [.font: OverlayStyle.font(13)])
        XCTAssertGreaterThan(oneMore.size().width, 300)
        XCTAssertEqual(HandoffImages.titleLine("Project / assets/hero.png", size: 13, maxWidth: 300).string, "Project / assets/hero.png")
        // A line break in a name never makes a second line
        XCTAssertEqual(HandoffImages.titleLine("a\nb", size: 13, maxWidth: 300).string, "a b")
    }

    // MARK: Names

    func testTheFileNameDropsUnusableCharactersAndTruncatesWhenTooLong() {
        XCTAssertEqual(HandoffImages.fileName(1, "a/b:c*?"), "01 a_b_c__.png")
        XCTAssertEqual(HandoffImages.fileName(12, String(repeating: "长", count: 200)).count, 83 + 4)
        XCTAssertEqual(HandoffImages.fileName(2, "结尾的点..."), "02 结尾的点.png")
        XCTAssertEqual(HandoffImages.fileName(3, "  a\tb  "), "03 a_b.png")
        XCTAssertEqual(HandoffImages.fileName(4, "x\"y<z>|\\"), "04 x_y_z___.png")
    }

    func testAFileNameNeverGetsLongerThanTheFileSystemAllows() {
        // 80 characters of 4 bytes would be 320
        let name = HandoffImages.fileName(1, String(repeating: "😀", count: 100))
        XCTAssertLessThanOrEqual(name.utf8.count, 255)
        XCTAssertTrue(name.hasPrefix("01 😀"))
        XCTAssertTrue(name.hasSuffix("😀.png"))
    }

    // MARK: The clipboard

    func testOneNoteGoesOnTheClipboardAsAnImageAndNothingElse() throws {
        let dir = makeTempDir()
        let folder = dir + "/handoff"
        let clipboard = RecordingClipboard()

        let count = try HandoffImages.copy(
            [item(shot(dir, "a.png", 800, 400, MarkColor(hex: 0x808080)))], extra: "改完重新导出一版", clipboard: clipboard, folder: folder)

        XCTAssertEqual(count, 1)
        XCTAssertEqual(clipboard.images.count, 1)
        XCTAssertEqual(clipboard.files.count, 0)
        // PNG, and the same picture as TIFF for the apps that read only that; no text can be put through this clipboard at all
        let png = try XCTUnwrap(clipboard.images.first?.png)
        XCTAssertEqual(Array(png.prefix(4)), [0x89, 0x50, 0x4E, 0x47])
        let tiff = try XCTUnwrap(clipboard.images.first?.tiff)
        let rep = try XCTUnwrap(NSBitmapImageRep(data: tiff))
        let size = try XCTUnwrap(pixelSize(of: png))
        XCTAssertEqual([rep.pixelsWide, rep.pixelsHigh], [size.width, size.height])
        XCTAssertFalse(FileManager.default.fileExists(atPath: folder), "one image is not saved anywhere")
    }

    func testSeveralNotesAreSavedAsFilesNumberedInOrderAndPutOnTheClipboardAsFiles() throws {
        let dir = makeTempDir()
        let folder = dir + "/handoff"
        let clipboard = RecordingClipboard()
        let picture = shot(dir, "a.png", 800, 400, MarkColor(hex: 0x808080))

        let count = try HandoffImages.copy(
            [item(picture, name: "hero.png 第1条"), item(nil, name: "整个文件夹 第1条"), item(picture, name: "clip.mp4 第3条")], extra: nil,
            clipboard: clipboard, folder: folder)

        XCTAssertEqual(count, 3)
        XCTAssertEqual(clipboard.images.count, 0)
        let files = try XCTUnwrap(clipboard.files.first)
        XCTAssertEqual(clipboard.files.count, 1)
        XCTAssertEqual(files.map { ($0 as NSString).lastPathComponent }, ["01 hero.png 第1条.png", "02 整个文件夹 第1条.png", "03 clip.mp4 第3条.png"])
        for file in files {
            XCTAssertTrue(file.hasPrefix(folder + "/"))
            XCTAssertGreaterThan(try Data(contentsOf: URL(fileURLWithPath: file)).count, 1000)
        }
        // All in one folder of their own, with no temp file left
        let copies = names(in: folder)
        XCTAssertEqual(copies.count, 1)
        XCTAssertEqual(names(in: folder + "/" + copies[0]).count, 3)
        XCTAssertEqual(tempFiles(in: folder + "/" + copies[0]), [])
    }

    func testTwoCopiesAtTheSameMomentGetFoldersOfTheirOwn() throws {
        let dir = makeTempDir()
        let folder = dir + "/handoff"
        let now = Date()
        let items = [item(nil, name: "a"), item(nil, name: "b")]

        let first = try HandoffImages.prepare(items, extra: nil, folder: folder, now: now)
        let second = try HandoffImages.prepare(items, extra: nil, folder: folder, now: now)

        guard case .files(let one) = first.payload, case .files(let two) = second.payload else { return XCTFail("several images are files") }
        XCTAssertEqual(first.count, 2)
        XCTAssertNotEqual((one[0] as NSString).deletingLastPathComponent, (two[0] as NSString).deletingLastPathComponent)
        XCTAssertTrue(FileManager.default.fileExists(atPath: one[0]))
        XCTAssertTrue(FileManager.default.fileExists(atPath: two[0]))
    }

    func testFoldersOfCopiesOlderThanSevenDaysAreRemovedBeforeSeveralImagesAreSaved() throws {
        let folder = makeTempDir() + "/handoff"
        let now = Date()
        for (name, age) in [("old", 8.0), ("recent", 6.0)] {
            writeText("x", to: folder + "/" + name + "/01 a.png")
            try FileManager.default.setAttributes([.creationDate: now.addingTimeInterval(-age * 24 * 3600)], ofItemAtPath: folder + "/" + name)
        }
        writeText("x", to: folder + "/loose.txt")

        _ = try HandoffImages.prepare([item(nil, name: "a"), item(nil, name: "b")], extra: nil, folder: folder, now: now)

        let left = names(in: folder)
        XCTAssertFalse(left.contains("old"))
        XCTAssertTrue(left.contains("recent"))
        XCTAssertTrue(left.contains("loose.txt"), "only folders are cleaned")
        XCTAssertEqual(left.count, 3, "the recent one, the loose file and the new copy")
    }

    func testNothingToCopyIsAnError() {
        XCTAssertThrowsError(try HandoffImages.copy([], extra: nil, clipboard: RecordingClipboard(), folder: makeTempDir())) { error in
            guard case HandoffImages.Failure.nothingToCopy = error else { return XCTFail("\(error)") }
        }
    }

    func testTheDefaultFolderIsNextToTheSettingsFile() {
        XCTAssertEqual(AppPaths.handoffDir, AppPaths.localDir + "/handoff")
    }

    // MARK: The method

    /// A notes folder a scan has handed out
    private func newHome() -> (home: String, homes: NotesHomes) {
        let home = makeTempDir()
        let homes = NotesHomes()
        homes.insert(home)
        return (home, homes)
    }

    /// One note of a page as the page sends it
    private func noteFields(_ number: Int = 1) -> [String: Any] {
        ["number": number, "category": "change", "where": "区域 左上", "body": "改大一点", "color": "#ff6a3d"]
    }

    /// One entry of `pages` as the page sends it
    private func entry(
        _ home: String, snapshot: String? = nil, image: String? = nil, name: String = "a.png 第1条", notes: [Any]? = nil
    ) -> [String: Any] {
        [
            "title": "项目 / a.png", "image": image ?? NSNull(), "home": home, "snapshot": snapshot ?? NSNull(), "notes": notes ?? [noteFields()],
            "name": name,
        ]
    }

    private func copyReply(_ params: Any?, _ homes: NotesHomes, stash: HandoffStash = HandoffStash(), _ clipboard: HandoffClipboard, folder: String)
        throws -> [String: Any]
    {
        try copyImagesReply(params, homes: homes, stash: stash, clipboard: clipboard, folder: folder)
    }

    /// The parameters after the trip through JSON: numbers are NSNumber, null is NSNull
    private func fromPage(_ params: [String: Any]) throws -> Any {
        try JSONSerialization.jsonObject(with: JSONSerialization.data(withJSONObject: params))
    }

    private func code(of error: Error) -> String? {
        (error as? BridgeError)?.code
    }

    func testTheSnapshotComesFromTheNotesFolderAndTheReplyCountsTheImages() throws {
        let (home, homes) = newHome()
        _ = shot(home + "/.sniptoss/snapshots", "s1.png", 1000, 500, MarkColor(hex: 0x808080))
        let clipboard = RecordingClipboard()
        let params = try fromPage(["pages": [entry(home, snapshot: ".sniptoss/snapshots/s1.png")], "extra": "请用中文回答"])

        let reply = try copyReply(params, homes, clipboard, folder: makeTempDir() + "/handoff")

        XCTAssertTrue(JSONSerialization.isValidJSONObject(reply))
        XCTAssertEqual(reply["count"] as? Int, 1)
        let png = try XCTUnwrap(clipboard.images.first?.png)
        XCTAssertEqual(try XCTUnwrap(pixelSize(of: png)).width, 1000, "drawn on the snapshot, not text only")
    }

    func testASnapshotOutsideTheNotesFolderOfAnUnknownFolderOrNotThereIsLeftOutAndTheNoteIsDrawnAsText() throws {
        let (home, homes) = newHome()
        // A picture the page must not be able to pull in: next to .sniptoss, not in it
        _ = shot(home, "outside.png", 1000, 500, MarkColor(hex: 0x808080))
        // A picture inside the .sniptoss of a folder no scan handed out
        let stranger = makeTempDir()
        _ = shot(stranger + "/.sniptoss/snapshots", "s1.png", 1000, 500, MarkColor(hex: 0x808080))
        let clipboard = RecordingClipboard()
        let folder = makeTempDir() + "/handoff"

        for note in [
            entry(home, snapshot: ".sniptoss/../outside.png"), entry(home, snapshot: "outside.png"), entry(home, snapshot: "/etc/hosts"),
            entry(stranger, snapshot: ".sniptoss/snapshots/s1.png"), entry(home, snapshot: ".sniptoss/snapshots/not-there.png"),
        ] {
            let reply = try copyReply(["pages": [note]], homes, clipboard, folder: folder)
            XCTAssertEqual(reply["count"] as? Int, 1)
        }

        XCTAssertEqual(clipboard.images.count, 5)
        for image in clipboard.images { XCTAssertEqual(try XCTUnwrap(pixelSize(of: image.png)).width, 720) }
    }

    func testSeveralPagesAreSavedUnderTheFolderAndTheReplyCountsThem() throws {
        let (home, homes) = newHome()
        let clipboard = RecordingClipboard()
        let folder = makeTempDir() + "/handoff"
        let params = try fromPage(["pages": [entry(home, name: "a 1"), entry(home, name: "a 2"), entry(home, name: "a 3")], "extra": ""])

        let reply = try copyReply(params, homes, clipboard, folder: folder)

        XCTAssertEqual(reply["count"] as? Int, 3)
        XCTAssertEqual(clipboard.files.first?.count, 3)
        XCTAssertTrue(clipboard.files.first?.allSatisfy { $0.hasPrefix(folder + "/") } ?? false)
    }

    func testAColorThatIsNotRRGGBBFallsBackToTheDefaultOrangeAndTheExtraIsOptional() throws {
        let (home, homes) = newHome()
        var odd = noteFields()
        odd["color"] = "orange"
        let clipboard = RecordingClipboard()
        // No "extra" key at all
        let reply = try copyReply(["pages": [entry(home, notes: [odd])]], homes, clipboard, folder: makeTempDir() + "/handoff")
        XCTAssertEqual(reply["count"] as? Int, 1)
        let plain = HandoffImages.Page(
            picture: nil, snapshot: nil, title: "项目 / a.png",
            notes: [NoteEntry(number: 1, color: orange, category: "change", whereText: "区域 左上", body: "改大一点")], name: "a.png 第1条")
        XCTAssertEqual(clipboard.images.first?.png, try HandoffImages.render(plain, extra: nil).png, "drawn as with the default orange")
    }

    func testAStashedPictureIsDrawnOnItsPageAndTheStashIsEmptiedAfterTheCopyWorkedOrNot() throws {
        let (home, homes) = newHome()
        _ = shot(home + "/.sniptoss/snapshots", "s1.png", 1400, 700, MarkColor(hex: 0x808080))
        let stash = HandoffStash()
        let clipboard = RecordingClipboard()
        let folder = makeTempDir() + "/handoff"
        let picture = try pictureBytes(makeTempDir(), "frame.png", 1000, 500, MarkColor(hex: 0x2060c0))
        func stashed() throws -> String {
            let reply = try stashImageReply(fromPage(["batch": "b1", "data": picture.base64EncodedString()]), stash: stash)
            XCTAssertTrue(JSONSerialization.isValidJSONObject(reply))
            return try XCTUnwrap(reply["id"] as? String)
        }

        let id = try stashed()
        let page = entry(home, snapshot: ".sniptoss/snapshots/s1.png", image: id, notes: [noteFields(1), noteFields(2)])
        let reply = try copyReply(fromPage(["pages": [page], "extra": ""]), homes, stash: stash, clipboard, folder: folder)
        XCTAssertEqual(reply["count"] as? Int, 1)
        XCTAssertEqual(try XCTUnwrap(pixelSize(of: XCTUnwrap(clipboard.images.first?.png))).width, 1000, "drawn on the stashed picture, not the snapshot")
        XCTAssertNil(stash.picture(id), "let go after the copy")

        // An id that is no longer stashed: the page falls back to its snapshot
        _ = try copyReply(["pages": [page]], homes, stash: stash, clipboard, folder: folder)
        XCTAssertEqual(try XCTUnwrap(pixelSize(of: XCTUnwrap(clipboard.images.last?.png))).width, 1400)

        // A copy that fails lets go of the pictures too
        let again = try stashed()
        clipboard.fails = true
        XCTAssertThrowsError(try copyReply(["pages": [entry(home, image: again)]], homes, stash: stash, clipboard, folder: folder))
        XCTAssertNil(stash.picture(again))
    }

    func testACopyFinishingAfterTheNextOneStashedLeavesThoseNewerPicturesAlone() throws {
        // Two copies in a row: the second has stashed its pictures before the first one is done
        let (home, homes) = newHome()
        let stash = HandoffStash()
        let clipboard = RecordingClipboard()
        let folder = makeTempDir() + "/handoff"
        let picture = try pictureBytes(makeTempDir(), "frame.png", 1000, 500, MarkColor(hex: 0x2060c0))
        let first = stash.stash(batch: "first", png: picture)
        let second = stash.stash(batch: "second", png: picture)

        _ = try copyReply(["pages": [entry(home, image: first)]], homes, stash: stash, clipboard, folder: folder)
        XCTAssertEqual(stash.picture(second), picture, "the second copy still has its picture")

        _ = try copyReply(["pages": [entry(home, image: second)]], homes, stash: stash, clipboard, folder: folder)
        XCTAssertEqual(try XCTUnwrap(pixelSize(of: XCTUnwrap(clipboard.images.last?.png))).width, 1000, "drawn on its picture")
        XCTAssertNil(stash.picture(second))
    }

    func testTheGroupOfANoteComesThroughTheBridge() throws {
        // A heading above the notes of each item: the image grows by the heading's height
        let (home, homes) = newHome()
        let clipboard = RecordingClipboard()
        let folder = makeTempDir() + "/handoff"
        var grouped = noteFields(1)
        grouped["group"] = "assets/a.png"
        _ = try copyReply(try fromPage(["pages": [entry(home, notes: [noteFields(1)])]]), homes, clipboard, folder: folder)
        _ = try copyReply(try fromPage(["pages": [entry(home, notes: [grouped])]]), homes, clipboard, folder: folder)
        let heights = try clipboard.images.map { try XCTUnwrap(pixelSize(of: $0.png)).height }
        XCTAssertEqual(heights.count, 2)
        XCTAssertGreaterThan(heights[1], heights[0])
        // The same page drawn directly with that group: the same picture
        let direct = HandoffImages.Page(
            picture: nil, snapshot: nil, title: "项目 / a.png",
            notes: [NoteEntry(number: 1, color: orange, category: "change", whereText: "区域 左上", body: "改大一点", group: "assets/a.png")],
            name: "a.png 第1条")
        XCTAssertEqual(clipboard.images.last?.png, try HandoffImages.render(direct, extra: nil).png)
    }

    func testStashImageRefusesMissingOrInvalidData() {
        let stash = HandoffStash()
        let broken: [Any?] = [nil, ["batch": "b"], ["data": "AAAA"], ["batch": "b", "data": "not base64!"], ["batch": 1, "data": "AAAA"]]
        for params in broken {
            XCTAssertThrowsError(try stashImageReply(params, stash: stash), "\(String(describing: params))") { error in
                XCTAssertNotNil(error as? BridgeError)
            }
        }
    }

    func testIncompleteParametersAreRefusedAndNothingIsPutOnTheClipboard() throws {
        let (home, homes) = newHome()
        let clipboard = RecordingClipboard()
        let folder = makeTempDir() + "/handoff"
        var noBody = noteFields()
        noBody["body"] = nil
        var noNumber = noteFields()
        noNumber["number"] = nil
        var noNotes = entry(home)
        noNotes["notes"] = nil
        var noTitle = entry(home)
        noTitle["title"] = nil
        var noName = entry(home)
        noName["name"] = nil
        let broken: [Any?] = [
            nil, [String: Any](), ["items": [entry(home)]], ["pages": "x"], ["pages": [entry(home, notes: [noBody])]],
            ["pages": [entry(home, notes: [noNumber])]], ["pages": [entry(home, notes: ["x"])]], ["pages": [noNotes]], ["pages": [noTitle]],
            ["pages": [noName]], ["pages": ["x"]], ["pages": [Any]()],
        ]
        for params in broken {
            XCTAssertThrowsError(try copyReply(params, homes, clipboard, folder: folder), "\(String(describing: params))") { error in
                XCTAssertNotNil(error as? BridgeError)
                XCTAssertNil(code(of: error))
            }
        }
        XCTAssertEqual(clipboard.images.count + clipboard.files.count, 0)
        XCTAssertFalse(FileManager.default.fileExists(atPath: folder))
    }

    func testAClipboardThatStaysHeldIsReportedWithItsOwnCode() throws {
        let (home, homes) = newHome()
        let clipboard = RecordingClipboard()
        clipboard.fails = true
        let folder = makeTempDir() + "/handoff"
        for pages in [[entry(home)], [entry(home), entry(home, name: "b")]] {
            XCTAssertThrowsError(try copyReply(["pages": pages], homes, clipboard, folder: folder)) { error in
                XCTAssertEqual(code(of: error), "clipboardBusy")
            }
        }
    }

    func testAFolderThatCannotBeWrittenIsReportedAsADiskError() throws {
        let (home, homes) = newHome()
        // The folder for the files is a file
        let blocked = makeTempDir() + "/not-a-folder"
        writeText("x", to: blocked)
        let clipboard = RecordingClipboard()
        XCTAssertThrowsError(try copyReply(["pages": [entry(home), entry(home, name: "b")]], homes, clipboard, folder: blocked)) { error in
            XCTAssertEqual(code(of: error), "notFound")
        }
        XCTAssertEqual(clipboard.files.count, 0)
    }
}
