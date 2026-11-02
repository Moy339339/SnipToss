import AppKit
import ImageIO

/// The main app's "Copy as Images" (for people using web-based AI or chat apps: those can't read local paths, they need images).
/// One image per note: a header line "project / file" on top, the note's snapshot in the middle (the one in .sniptoss/snapshots, marks
/// already drawn), and below it a notes area in the same style as Screen Capture (`NotesBlock`). Items without a snapshot (folder comments,
/// snapshot not generated) have only the two text blocks. The same layout as the Windows shell's (app/HandoffImages.cs)
///
/// Clipboard: one image goes on as an image (PNG and TIFF), so pasting anywhere gives that image; several are saved as image files and put
/// on the clipboard as a list of files (as if several files were copied in Finder), so a browser can take several at once, and chat apps
/// accept files too. Neither carries text: when both image and text are present, each program picks one on its own (some web-based AI
/// pages pick the text and the image is lost; browsers simply drop the text when files are present)
enum HandoffImages {
    /// One note. `snapshot` is the full path of the snapshot (nil if none); `name` is the file name when saved as a file (no extension)
    struct Item {
        let snapshot: String?
        let title: String
        let number: Int
        let category: String
        let whereText: String
        let body: String
        let color: MarkColor
        let name: String
    }

    /// A drawn image: as pixels, and as the PNG that is put on the clipboard or saved
    struct Rendered {
        let image: CGImage
        let png: Data
    }

    /// What goes on the clipboard (for several images the files are already saved)
    enum Payload {
        case image(png: Data, tiff: Data?)
        case files([String])
    }

    enum Failure: Error {
        case nothingToCopy
        case cannotDraw
        /// The clipboard stays held by another program
        case clipboardBusy

        var asBridgeError: BridgeError {
            switch self {
            case .nothingToCopy: return BridgeError("Nothing to copy")
            case .cannotDraw: return BridgeError("The image could not be drawn")
            case .clipboardBusy: return BridgeError("The clipboard is in use by another program", code: "clipboardBusy")
            }
        }
    }

    /// The narrowest an image gets (a screenshot narrower than this is centered on it)
    static let minWidth = 720
    /// How long the folders of several-image copies are kept, so a copy pasted days later can still be found
    private static let keep: TimeInterval = 7 * 24 * 3600
    private static let background = NSColor(hex: 0x141416)
    private static let titleColor = NSColor(hex: 0xb4b4bc)

    /// Draws the images and puts them on the clipboard; returns how many.
    /// - Parameter folder: where several images are saved (the files in it are what goes on the clipboard); tests pass a temporary one
    static func copy(_ items: [Item], extra: String?, clipboard: HandoffClipboard, folder: String, now: Date = Date()) throws -> Int {
        let (payload, count) = try prepare(items, extra: extra, folder: folder, now: now)
        switch payload {
        case .image(let png, let tiff): try clipboard.putImage(png: png, tiff: tiff)
        case .files(let paths): try clipboard.putFiles(paths)
        }
        return count
    }

    /// What goes on the clipboard. Split out so tests can look at it without a clipboard
    static func prepare(_ items: [Item], extra: String?, folder: String, now: Date = Date()) throws -> (payload: Payload, count: Int) {
        if items.isEmpty { throw Failure.nothingToCopy }
        if items.count == 1 {
            let one = try render(items[0], extra: extra)
            let rep = NSBitmapImageRep(cgImage: one.image)
            // One pixel a point, as the PNG says: pasted, the image is laid out at its pixel size
            rep.size = NSSize(width: one.image.width, height: one.image.height)
            return (.image(png: one.png, tiff: rep.tiffRepresentation), 1)
        }
        cleanOld(folder, now: now)
        let dir = try freshFolder(in: folder, now: now)
        var paths: [String] = []
        do {
            // One image at a time, written at once: dozens of notes are never all in memory
            for (k, item) in items.enumerated() {
                let drawn = try render(item, extra: extra)
                let path = dir + "/" + fileName(k + 1, item.name)
                try AtomicFile.write(path, drawn.png)
                paths.append(path)
            }
        } catch {
            try? FileManager.default.removeItem(atPath: dir)
            throw error
        }
        return (.files(paths), items.count)
    }

    /// One image: title, snapshot, notes area. Font sizes scale with the image width (1x up to 800 wide, at most 2.5x): AI shrinks large
    /// images, and small text becomes unreadable
    static func render(_ item: Item, extra: String?) throws -> Rendered {
        let shot = loadSnapshot(item.snapshot)
        var width = max(shot?.width ?? 0, minWidth)
        let s = min(max(CGFloat(width) / 800, 1), 2.5)
        let entry = NoteEntry(number: item.number, color: item.color, category: item.category, whereText: item.whereText, body: item.body)
        let notes = NotesBlock.build(entries: [entry], overall: nil, title: nil, extra: extra, imageWidth: width, s: s)
        width = max(width, notes.width)

        let pad = 14 * s
        let title = titleLine(item.title, size: 13 * s, maxWidth: max(40, CGFloat(width) - pad * 2))
        let headHeight = Int(ceil(title.size().height + pad * 2))
        let shotHeight = shot?.height ?? 0
        let height = headHeight + shotHeight + notes.height

        guard
            let context = CGContext(
                data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { throw Failure.cannotDraw }
        // The y axis points down from here on, as in a capture's picture
        context.translateBy(x: 0, y: CGFloat(height))
        context.scaleBy(x: 1, y: -1)
        context.setFillColor(background.cgColor)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        MarkPainter.withAppKit(context) { title.draw(at: CGPoint(x: pad, y: pad)) }
        // The snapshot by pixels (the resolution recorded in the file is not used), centered
        if let shot {
            MarkPainter.drawPicture(
                shot, in: CGRect(x: (width - shot.width) / 2, y: headHeight, width: shot.width, height: shot.height), context: context)
        }
        context.saveGState()
        context.translateBy(x: 0, y: CGFloat(headHeight + shotHeight))
        notes.draw(in: context, canvasWidth: width)
        context.restoreGState()
        guard let image = context.makeImage(), let png = CaptureOutput.png(image, scale: 1) else { throw Failure.cannotDraw }
        return Rendered(image: image, png: png)
    }

    /// The header line: one line, cut at a character with an ellipsis when it does not fit `maxWidth`
    static func titleLine(_ text: String, size: CGFloat, maxWidth: CGFloat) -> NSAttributedString {
        let attributes: [NSAttributedString.Key: Any] = [.font: OverlayStyle.font(size), .foregroundColor: titleColor]
        func made(_ s: String) -> NSAttributedString { NSAttributedString(string: s, attributes: attributes) }
        let flat = text.components(separatedBy: .newlines).joined(separator: " ")
        // An empty line still takes the height of a line
        if flat.isEmpty { return made(" ") }
        if made(flat).size().width <= maxWidth { return made(flat) }
        // The longest start that fits together with the ellipsis
        let chars = Array(flat)
        var low = 0
        var high = chars.count
        while low < high {
            let mid = (low + high + 1) / 2
            if made(String(chars[..<mid]).trimmedEnd + "…").size().width <= maxWidth { low = mid } else { high = mid - 1 }
        }
        return made(String(chars[..<low]).trimmedEnd + "…")
    }

    /// Reads the snapshot; absent or unreadable counts as none (this item is text only). The file is read whole, so an agent writing in
    /// .sniptoss at the same time cannot make the picture come out torn
    private static func loadSnapshot(_ path: String?) -> CGImage? {
        guard let path, FileManager.default.fileExists(atPath: path) else { return nil }
        do {
            let data = try AtomicFile.readAllBytes(path)
            guard let source = CGImageSourceCreateWithData(data as CFData, nil), CGImageSourceGetCount(source) > 0,
                let image = CGImageSourceCreateImageAtIndex(source, 0, nil), image.width > 0, image.height > 0
            else {
                Log.info("Copy as images: snapshot is not an image, text only: \(path)")
                return nil
            }
            return image
        } catch {
            Log.info("Copy as images: snapshot unreadable, text only: \(path) (\(error))")
            return nil
        }
    }

    // MARK: The files

    /// "01 hero.png note 3.png": that is the name the attachment shows on a web page, so both AI and people can tell which note it is.
    /// The characters Windows does not allow in a file name are replaced too (the names read the same on both systems), the name is
    /// cut to 80 characters, and to what a file name on a Mac can hold
    static func fileName(_ seq: Int, _ name: String) -> String {
        let underscore: Unicode.Scalar = "_"
        let bad = "<>:\"/\\|?*".unicodeScalars
        var replaced = String.UnicodeScalarView()
        for c in name.unicodeScalars { replaced.append(c.value < 32 || c.value == 127 || bad.contains(c) ? underscore : c) }
        var clean = String(replaced).trimmedBothEnds
        while clean.hasSuffix(".") { clean.removeLast() }
        if clean.count > 80 { clean = String(clean.prefix(80)) }
        // 255 bytes is the most a name can be; 240 leaves room for the number and ".png"
        while clean.utf8.count > 240 { clean.removeLast() }
        return String(format: "%02d", seq) + " " + clean + ".png"
    }

    /// A new folder for this copy inside `folder`, named by the time (and numbered if one by that name is there)
    private static func freshFolder(in folder: String, now: Date) throws -> String {
        let format = DateFormatter()
        format.locale = Foundation.Locale(identifier: "en_US_POSIX")
        format.calendar = Calendar(identifier: .gregorian)
        format.timeZone = .current
        format.dateFormat = "yyyyMMdd-HHmmss-SSS"
        let stem = folder + "/" + format.string(from: now)
        var path = stem
        var n = 2
        while FileManager.default.fileExists(atPath: path) {
            path = stem + "-\(n)"
            n += 1
        }
        try AtomicFile.ensureDirectory(path)
        return path
    }

    /// Removes the folders left by copies made more than 7 days ago; one that cannot be removed is left for next time
    static func cleanOld(_ folder: String, now: Date) {
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: folder) else { return }
        for name in names {
            let path = folder + "/" + name
            guard Library.isDirectory(path), let attributes = try? FileManager.default.attributesOfItem(atPath: path),
                let made = (attributes[.creationDate] as? Date) ?? (attributes[.modificationDate] as? Date), now.timeIntervalSince(made) > keep
            else { continue }
            try? FileManager.default.removeItem(atPath: path)
        }
    }
}

/// Where the images of Copy as Images go: the clipboard, or in the tests a recorder that never touches the user's clipboard
protocol HandoffClipboard {
    /// One image: PNG first, TIFF for apps that only read that. Throws `HandoffImages.Failure.clipboardBusy` when the system refuses
    func putImage(png: Data, tiff: Data?) throws
    /// Several images, as the files of Finder's copy. Same failure
    func putFiles(_ paths: [String]) throws
}

/// The system clipboard. Safe to call from any thread: the clipboard is written on the main thread
struct SystemHandoffClipboard: HandoffClipboard {
    func putImage(png: Data, tiff: Data?) throws {
        try onMainThread {
            do {
                try SystemCaptureClipboard().put(png: png, tiff: tiff, text: nil)
            } catch SystemCaptureClipboard.Failure.refused {
                throw HandoffImages.Failure.clipboardBusy
            }
        }
    }

    func putFiles(_ paths: [String]) throws {
        try onMainThread {
            func once() -> Bool {
                let board = NSPasteboard.general
                board.clearContents()
                return board.writeObjects(paths.map { NSURL(fileURLWithPath: $0) as NSPasteboardWriting })
            }
            if once() { return }
            // Another program may have the clipboard for a moment: one more try
            Thread.sleep(forTimeInterval: 0.1)
            if !once() { throw HandoffImages.Failure.clipboardBusy }
        }
    }

    private func onMainThread(_ work: () throws -> Void) throws {
        if Thread.isMainThread {
            try work()
        } else {
            try DispatchQueue.main.sync(execute: work)
        }
    }
}
