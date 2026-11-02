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

    private func item(_ shot: String?, name: String = "hero.png 第1条", body: String = "标题字太细了，换成粗一点的黑体") -> HandoffImages.Item {
        HandoffImages.Item(
            snapshot: shot, title: "示例项目 / assets/hero.png", number: 1, category: "change", whereText: "区域 画面左上（横 12%–52%、纵 8%–18%）",
            body: body, color: orange, name: name)
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

    /// One entry of `items` as the page sends it
    private func entry(_ home: String, snapshot: String? = nil, name: String = "a.png 第1条") -> [String: Any] {
        var fields: [String: Any] = [
            "home": home, "title": "项目 / a.png", "number": 1, "category": "change", "where": "区域 左上", "body": "改大一点", "color": "#ff6a3d",
            "name": name,
        ]
        if let snapshot { fields["snapshot"] = snapshot } else { fields["snapshot"] = NSNull() }
        return fields
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
        let params = try fromPage(["items": [entry(home, snapshot: ".sniptoss/snapshots/s1.png")], "extra": "请用中文回答"])

        let reply = try copyImagesReply(params, homes: homes, clipboard: clipboard, folder: makeTempDir() + "/handoff")

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
            let reply = try copyImagesReply(["items": [note]], homes: homes, clipboard: clipboard, folder: folder)
            XCTAssertEqual(reply["count"] as? Int, 1)
        }

        XCTAssertEqual(clipboard.images.count, 5)
        for image in clipboard.images { XCTAssertEqual(try XCTUnwrap(pixelSize(of: image.png)).width, 720) }
    }

    func testSeveralNotesAreSavedUnderTheFolderAndTheReplyCountsThem() throws {
        let (home, homes) = newHome()
        let clipboard = RecordingClipboard()
        let folder = makeTempDir() + "/handoff"
        let params = try fromPage(["items": [entry(home, name: "a 1"), entry(home, name: "a 2"), entry(home, name: "a 3")], "extra": ""])

        let reply = try copyImagesReply(params, homes: homes, clipboard: clipboard, folder: folder)

        XCTAssertEqual(reply["count"] as? Int, 3)
        XCTAssertEqual(clipboard.files.first?.count, 3)
        XCTAssertTrue(clipboard.files.first?.allSatisfy { $0.hasPrefix(folder + "/") } ?? false)
    }

    func testAColorThatIsNotRRGGBBFallsBackToTheDefaultOrangeAndTheExtraIsOptional() throws {
        let (home, homes) = newHome()
        var odd = entry(home)
        odd["color"] = "orange"
        let clipboard = RecordingClipboard()
        // No "extra" key at all
        let reply = try copyImagesReply(["items": [odd]], homes: homes, clipboard: clipboard, folder: makeTempDir() + "/handoff")
        XCTAssertEqual(reply["count"] as? Int, 1)
        let plain = HandoffImages.Item(
            snapshot: nil, title: "项目 / a.png", number: 1, category: "change", whereText: "区域 左上", body: "改大一点", color: orange, name: "a.png 第1条")
        XCTAssertEqual(clipboard.images.first?.png, try HandoffImages.render(plain, extra: nil).png, "drawn as with the default orange")
    }

    func testIncompleteParametersAreRefusedAndNothingIsPutOnTheClipboard() throws {
        let (home, homes) = newHome()
        let clipboard = RecordingClipboard()
        let folder = makeTempDir() + "/handoff"
        var noBody = entry(home)
        noBody["body"] = nil
        var noNumber = entry(home)
        noNumber["number"] = nil
        let broken: [Any?] = [
            nil, [String: Any](), ["items": "x"], ["items": [noBody]], ["items": [noNumber]], ["items": ["x"]], ["items": [Any]()],
        ]
        for params in broken {
            XCTAssertThrowsError(try copyImagesReply(params, homes: homes, clipboard: clipboard, folder: folder), "\(String(describing: params))") { error in
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
        for items in [[entry(home)], [entry(home), entry(home, name: "b")]] {
            XCTAssertThrowsError(try copyImagesReply(["items": items], homes: homes, clipboard: clipboard, folder: folder)) { error in
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
        XCTAssertThrowsError(try copyImagesReply(["items": [entry(home), entry(home, name: "b")]], homes: homes, clipboard: clipboard, folder: blocked)) { error in
            XCTAssertEqual(code(of: error), "notFound")
        }
        XCTAssertEqual(clipboard.files.count, 0)
    }
}
