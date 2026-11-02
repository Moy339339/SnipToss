import AppKit
import XCTest

@testable import SnipToss

/// What a finished capture turns into: the composited picture and its notes area, the words for an AI, the saved file, and what goes on
/// the clipboard and into the notice. The same rules as the Windows shell's CaptureSession (tests/AppTests/CaptureTests.cs)
final class CaptureOutputTests: SnipTestCase {
    /// A screen of `width` × `height` points at scale 1 with the made-up pattern
    private func screen(_ width: Int, _ height: Int) -> FrozenScreen {
        FrozenScreen(
            displayID: 0, frame: CGRect(x: 0, y: 0, width: width, height: height), scale: 1,
            image: PatternScreenSource.image(width: width, height: height))
    }

    private func result(_ shot: FrozenScreen, sel: CGRect, marks: [Mark], overall: String = "", overallCategory: String = "change") -> CaptureResult {
        CaptureResult(
            screen: shot, selection: sel, marks: marks, overall: overall, overallCategory: overallCategory, pixelated: nil,
            full: CGRect(origin: .zero, size: shot.frame.size))
    }

    private func noted(_ kind: Tool, _ points: [CGPoint], note: String, number: Int, category: String = "change", color: MarkColor = ToolPrefs.colors[0]) -> Mark {
        let m = Mark(kind: kind, color: color, size: 2, points: points, note: note, category: category, number: number)
        return m
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

    // MARK: Names and sizes

    func testTheArchiveNameHasNoLanguageOrSpacesAndAFixedGregorianFormat() throws {
        let parts = DateComponents(year: 2026, month: 10, day: 22, hour: 14, minute: 3, second: 5)
        let at = try XCTUnwrap(Calendar(identifier: .gregorian).date(from: parts))
        XCTAssertEqual(CaptureOutput.fileName(at, 1), "capture-2026-10-22_14-03-05.png")
        XCTAssertEqual(CaptureOutput.fileName(at, 2), "capture-2026-10-22_14-03-05-2.png")
    }

    func testASmallSelectionWithNotesBelowIsEnlargedByAWholeFactorUpTo4() {
        XCTAssertEqual(CaptureOutput.zoom(60, 420), 4)
        XCTAssertEqual(CaptureOutput.zoom(140, 420), 3)
        XCTAssertEqual(CaptureOutput.zoom(300, 420), 1)
        XCTAssertEqual(CaptureOutput.zoom(1920, 420), 1)
        // However small, at most 4 times
        XCTAssertEqual(CaptureOutput.zoom(10, 840), 4)
    }

    func testEnlargingTurnsEachPixelIntoASharpBlock() throws {
        // 2 × 1: red on the left, blue on the right
        var pixels: [UInt8] = [255, 0, 0, 255, 0, 0, 255, 255]
        let provider = try XCTUnwrap(CGDataProvider(data: Data(bytes: &pixels, count: pixels.count) as CFData))
        let source = try XCTUnwrap(
            CGImage(
                width: 2, height: 1, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: 8, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue), provider: provider, decode: nil,
                shouldInterpolate: false, intent: .defaultIntent))
        let big = try XCTUnwrap(CaptureOutput.enlarge(source, 3))
        XCTAssertEqual([big.width, big.height], [6, 3])
        let px = rgba(big)
        for y in 0..<3 {
            // Column 3 is still red, column 4 is blue, with no blend between them
            XCTAssertEqual(Array(px[(y * 6 + 2) * 4..<(y * 6 + 2) * 4 + 3]), [255, 0, 0])
            XCTAssertEqual(Array(px[(y * 6 + 3) * 4..<(y * 6 + 3) * 4 + 3]), [0, 0, 255])
        }
    }

    /// Pixelate blocks are 12 points on screen, so 24 pixels at 2×: a fixed pixel size left text legible on a sharp screen
    func testPixelateBlocksAre12PointsAndThePartialOneAtTheEdgeUsesItsRealSize() throws {
        for (scale, block) in [(CGFloat(1), 12), (1.25, 15), (1.5, 18), (2, 24)] {
            let w = block * 5 / 2
            let h = block * 3 / 2
            let picture = PatternScreenSource.image(width: w, height: h)
            let px = rgba(try XCTUnwrap(MarkPainter.pixelate(picture, scale: scale)))
            func at(_ x: Int, _ y: Int) -> [UInt8] { Array(px[(y * w + x) * 4..<(y * w + x) * 4 + 3]) }
            // The first row: each run of one color is exactly one block wide, the last one what is left
            var runs = [1]
            for x in 1..<w {
                if at(x, 0) == at(x - 1, 0) { runs[runs.count - 1] += 1 } else { runs.append(1) }
            }
            XCTAssertEqual(runs, [block, block, w - 2 * block], "scale \(scale)")
        }
    }

    // MARK: The notes area

    func testManyNotesSplitIntoTwoColumnsWhenWideEnoughAndANarrowPictureStaysInOne() {
        // One line across the whole width, two in half of it (fixed-width Chinese, so the line count does not depend on the font)
        let body = String(repeating: "标题的字号再大一点，颜色改成品牌蓝。", count: 4)
        let entries = (1...8).map { n in
            NoteEntry(number: n, color: ToolPrefs.colors[0], category: "change", whereText: "Region: top left (x \(n)%–\(n + 10)%), x=\(n) y=\(n) w=10 h=10 px", body: body)
        }
        let tall = NotesBlock.build(entries: entries, overall: nil, title: "Notes", extra: nil, imageWidth: 1200, s: 1)
        let two = NotesBlock.build(entries: entries, overall: nil, title: "Notes", extra: nil, imageWidth: 1200, s: 1, imageHeight: 300)
        XCTAssertFalse(tall.twoColumns)
        XCTAssertTrue(two.twoColumns)
        XCTAssertLessThan(Double(two.height), Double(tall.height) * 0.8)
        // The narrowest notes area: two columns would leave a few characters a line
        XCTAssertFalse(NotesBlock.build(entries: entries, overall: nil, title: "Notes", extra: nil, imageWidth: 420, s: 1, imageHeight: 100).twoColumns)
        // One note: no split
        XCTAssertFalse(NotesBlock.build(entries: Array(entries.prefix(1)), overall: nil, title: "Notes", extra: nil, imageWidth: 1200, s: 1, imageHeight: 10).twoColumns)
    }

    func testPositionPairsStayTogetherWhenTheyWrap() {
        let kept = NotesBlock.keepPairs("x=100 y 17%–40%")
        let joiner = String(KeepWords.wordJoiner)
        let noBreak = String(Character(Unicode.Scalar(0xA0)!))
        XCTAssertEqual(kept, "x\(joiner)=100 y\(noBreak)17%–\(joiner)40%")
        // Korean words keep their syllables together; Chinese is left as it is
        XCTAssertEqual(KeepWords.of("한글 단어"), "한\(joiner)글 단\(joiner)어")
        XCTAssertEqual(KeepWords.of("中文批注"), "中文批注")
    }

    func testComposeEnlargesAndCentersASmallSelectionAndTheNotesSpeakOfTheEnlargedPicture() throws {
        // A 200 × 100 screen with an 80 × 30 selection (as if only a button were framed) and three boxes with notes
        let shot = screen(200, 100)
        let sel = CGRect(x: 20, y: 30, width: 80, height: 30)
        let marks = (1...3).map { n in
            noted(.rect, [CGPoint(x: 25 + n * 10, y: 35), CGPoint(x: 35 + n * 10, y: 45)], note: "Button \(n): say Save draft", number: n)
        }
        let r = result(shot, sel: sel, marks: marks)
        let out = try CaptureOutput.compose(r, notesInImage: true, promptExtra: "")
        // 80 wide would need 5 times to reach 420; at most 4: 320 wide, in the middle of a 420-wide picture
        XCTAssertEqual(out.size.width, 420)
        XCTAssertGreaterThan(out.size.height, 30 * 4)
        XCTAssertEqual([out.image.width, out.image.height], [out.size.width, out.size.height])
        // The left margin is the dark background, the screenshot starts 50 in
        let px = rgba(out.image)
        func at(_ x: Int, _ y: Int) -> [UInt8] { Array(px[(y * out.size.width + x) * 4..<(y * out.size.width + x) * 4 + 3]) }
        XCTAssertEqual(at(10, 10), [0x14, 0x14, 0x16])
        let c = PatternScreenSource.color(x: 20, y: 30)
        XCTAssertEqual(at(51, 1), [c.red, c.green, c.blue], "the selection's first pixel, enlarged 4 times")
        // Not enlarged without the notes area: the selection's own size
        let plain = try CaptureOutput.compose(r, notesInImage: false, promptExtra: "")
        XCTAssertEqual([plain.size.width, plain.size.height], [80, 30])
        // The PNG says how large the picture was on screen
        let rep = try XCTUnwrap(NSBitmapImageRep(data: plain.png))
        XCTAssertEqual(rep.size, NSSize(width: 80, height: 30))
    }

    func testTheNotesAreaAndTheWordsForAnAIAgreeEntryByEntry() throws {
        let shot = screen(400, 200)
        let sel = CGRect(x: 0, y: 0, width: 400, height: 200)
        let first = noted(.rect, [CGPoint(x: 20, y: 20), CGPoint(x: 120, y: 80)], note: "The title a bit larger", number: 1)
        let second = noted(.arrow, [CGPoint(x: 300, y: 150), CGPoint(x: 250, y: 100)], note: "Why are these two different colors?", number: 2, category: "question")
        let again = Mark(kind: .ellipse, color: ToolPrefs.colors[2], size: 2, points: [CGPoint(x: 200, y: 120), CGPoint(x: 260, y: 180)], lead: second)
        let words = Mark(kind: .text, color: MarkColor(hex: 0xffffff), size: 16, points: [CGPoint(x: 10, y: 170)], text: "Draft")
        let marks = [first, second, again, words]
        let r = result(shot, sel: sel, marks: marks, overall: "Brighter overall", overallCategory: "add")
        let notes = marks.filter { $0.hasNote }
        func plain(_ s: String) -> String {
            s.replacingOccurrences(of: String(KeepWords.wordJoiner), with: "").replacingOccurrences(of: String(Character(Unicode.Scalar(0xA0)!)), with: " ")
        }
        let drawn = CaptureOutput.notesPanel(r, notes: notes, imageWidth: 400, imageHeight: 200, s: 1, extra: "").texts().map(plain)
        let lines = CaptureOutput.handoffText(r, notes: notes, file: nil, size: (400, 200), promptExtra: "").components(separatedBy: "\n").map(plain)
        for m in notes {
            let label = Categories.label(m.category)
            let heads = drawn.filter { $0.hasPrefix(label + " · ") }
            let line = try XCTUnwrap(lines.first { $0.hasPrefix("\(m.number). ") })
            XCTAssertTrue(heads.contains { line.contains($0) }, "\(heads) in \(line)")
            XCTAssertTrue(drawn.contains(m.note))
            XCTAssertTrue(line.hasSuffix(m.note), line)
        }
        // The overall comment: the same category and words on both sides
        let overall = Categories.label("add")
        XCTAssertTrue(drawn.contains { $0.hasPrefix(overall + " · ") })
        XCTAssertTrue(drawn.contains("Brighter overall"))
        XCTAssertTrue(lines.contains { $0.contains(overall) && $0.hasSuffix("Brighter overall") })
        // A text mark without a note is on neither side
        XCTAssertFalse(drawn.contains { $0.contains("Draft") })
        XCTAssertFalse(lines.contains { $0.contains("Draft") })
    }

    func testTheWordsNameTheFileOnlyWhenItWasSavedAndEndWithTheExtraInstructions() {
        let shot = screen(400, 200)
        let r = result(shot, sel: CGRect(x: 0, y: 0, width: 400, height: 200), marks: [noted(.note, [CGPoint(x: 50, y: 50)], note: "Here", number: 1)])
        let notes = r.marks
        let saved = CaptureOutput.handoffText(r, notes: notes, file: "/tmp/capture-x.png", size: (400, 200), promptExtra: "Answer in English")
        XCTAssertTrue(saved.contains(ShellText.t("ai.capture.file", values: ["file": "/tmp/capture-x.png", "w": 400, "h": 200])))
        XCTAssertTrue(saved.hasSuffix("\n\nAnswer in English"))
        let unsaved = CaptureOutput.handoffText(r, notes: notes, file: nil, size: (400, 200), promptExtra: "")
        XCTAssertTrue(unsaved.hasSuffix(ShellText.t("ai.capture.image", values: ["w": 400, "h": 200])))
        XCTAssertFalse(unsaved.contains("/tmp/"))
    }

    // MARK: The file

    func testSavingNumbersPicturesOfTheSameSecondAndCleansOnlyTheDefaultFolder() throws {
        let dir = makeTempDir()
        let now = Date()
        let old = dir + "/capture-2020-01-01_00-00-00.png"
        let mine = dir + "/notes.png"
        for path in [old, mine] {
            writeText("x", to: path)
            try FileManager.default.setAttributes([.modificationDate: now.addingTimeInterval(-31 * 24 * 3600)], ofItemAtPath: path)
        }
        // A folder the user chose is never cleaned
        let first = try CaptureOutput.save(Data([1]), folder: dir, cleanable: false, now: now)
        XCTAssertTrue(FileManager.default.fileExists(atPath: old))
        XCTAssertEqual((first as NSString).lastPathComponent, CaptureOutput.fileName(now, 1))
        // The default folder: this app's pictures older than 30 days go, anything else stays
        let second = try CaptureOutput.save(Data([2]), folder: dir, cleanable: true, now: now)
        XCTAssertFalse(FileManager.default.fileExists(atPath: old))
        XCTAssertTrue(FileManager.default.fileExists(atPath: mine))
        XCTAssertEqual((second as NSString).lastPathComponent, CaptureOutput.fileName(now, 2))
        XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: first)), Data([1]))
    }

    // MARK: Finishing

    private final class Harness {
        let clipboard = RecordingCaptureClipboard()
        let notices = RecordingCaptureNotices()
        var hints = 0
        lazy var session = CaptureSession(
            source: PatternScreenSource(screens: []), clipboard: clipboard, notices: notices, hintDone: { [unowned self] in self.hints += 1 })
    }

    private func finished(notesInImage: Bool = true, folder: String, selectHint: Bool = true, marks: [Mark]? = nil) -> (Harness, CaptureResult, CaptureOptions) {
        let h = Harness()
        let r = result(screen(300, 200), sel: CGRect(x: 10, y: 10, width: 200, height: 120), marks: marks ?? [noted(.note, [CGPoint(x: 50, y: 50)], note: "Here", number: 1)])
        let o = CaptureOptions(selectHint: selectHint, notesInImage: notesInImage, promptExtra: "", folder: folder)
        h.session.output(r, o)
        return (h, r, o)
    }

    func testFinishingPutsThePictureOnTheClipboardSavesItAndSaysSo() throws {
        let dir = makeTempDir()
        let (h, _, _) = finished(folder: dir)
        // Notes drawn into the picture: only the picture goes on the clipboard
        XCTAssertEqual(h.clipboard.puts, 1)
        XCTAssertNotNil(h.clipboard.png)
        XCTAssertNotNil(h.clipboard.tiff)
        XCTAssertNil(h.clipboard.text)
        let file = try XCTUnwrap(h.session.lastFile)
        XCTAssertTrue(file.hasPrefix(dir + "/capture-"))
        XCTAssertEqual(try Data(contentsOf: URL(fileURLWithPath: file)), h.clipboard.png)
        XCTAssertEqual(h.notices.shown.map { $0.kind }, ["toast"])
        XCTAssertEqual(h.notices.shown.first?.title, ShellText.t("capture.copied", values: ["what": "notes", "count": 1]))
        XCTAssertEqual(h.notices.shown.first?.detail, "")
        // The newcomer's instructions are not shown any more
        XCTAssertEqual(h.hints, 1)
        XCTAssertEqual(finished(folder: makeTempDir(), selectHint: false).0.hints, 0)
    }

    func testWithTheNotesLeftOutOfThePictureTheWordsGoOnTheClipboardToo() {
        let (h, _, _) = finished(notesInImage: false, folder: makeTempDir())
        XCTAssertTrue(h.clipboard.text?.contains("Here") ?? false)
        XCTAssertTrue(h.clipboard.text?.contains(h.session.lastFile ?? "?") ?? false)
        // The notice warns that pasting into an agent app would lose them
        XCTAssertEqual(h.notices.shown.first?.detail, ShellText.t("capture.how.notInImage"))
        // A picture without notes: just the picture, and the plain notice
        let (bare, _, _) = finished(notesInImage: false, folder: makeTempDir(), marks: [])
        XCTAssertNil(bare.clipboard.text)
        XCTAssertEqual(bare.notices.shown.first?.title, ShellText.t("capture.copied", values: ["what": "image", "count": 0]))
    }

    func testAPictureThatCannotBeSavedIsStillCopied() {
        // The folder is a file: saving fails
        let blocked = makeTempDir() + "/not-a-folder"
        writeText("x", to: blocked)
        let (h, _, _) = finished(folder: blocked)
        XCTAssertEqual(h.clipboard.puts, 1)
        XCTAssertNil(h.session.lastFile)
        XCTAssertEqual(h.notices.shown.map { $0.kind }, ["error"])
        XCTAssertEqual(h.notices.shown.first?.title, ShellText.t("capture.copiedNotSaved", values: ["what": "notes", "count": 1]))
        XCTAssertNotNil(h.notices.shown.first?.error)
        // Copied all the same: the newcomer's instructions are done
        XCTAssertEqual(h.hints, 1)
    }

    func testAClipboardThatRefusesSaysWhereThePictureWasSaved() {
        let h = Harness()
        h.clipboard.fails = true
        let dir = makeTempDir()
        let r = result(screen(300, 200), sel: CGRect(x: 0, y: 0, width: 100, height: 100), marks: [])
        h.session.output(r, CaptureOptions(selectHint: true, folder: dir))
        XCTAssertEqual(h.notices.shown.map { $0.kind }, ["error"])
        XCTAssertEqual(h.notices.shown.first?.title, ShellText.t("capture.error.clipboard"))
        XCTAssertEqual(h.notices.shown.first?.path, h.session.lastFile)
        XCTAssertNotNil(h.session.lastFile)
        // Not copied: the instructions stay for next time
        XCTAssertEqual(h.hints, 0)
    }
}
