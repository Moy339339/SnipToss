import AppKit

/// What a finished capture turns into: the picture (the selection in the screen's pixels, the marks and numbers, and with notes the notes
/// area below), the file it is kept in, and the words for an AI. The same rules as the Windows shell, so a capture reads the same on both
enum CaptureOutput {
    struct Output {
        let image: CGImage
        let png: Data
        let size: PixelSize
    }

    enum Failure: Error {
        case noPicture
    }

    /// - Parameters:
    ///   - notesInImage: Settings → Screen Capture → Include notes in the image
    ///   - promptExtra: Settings → Copying → Extra instructions, drawn last in the notes area
    static func compose(_ r: CaptureResult, notesInImage: Bool, promptExtra: String) throws -> Output {
        let scale = r.screen.scale
        let shot = r.screen.image
        let sel = r.selection
        let x = Int((sel.minX * scale).rounded(.toNearestOrEven))
        let y = Int((sel.minY * scale).rounded(.toNearestOrEven))
        let w = min(max(Int((sel.width * scale).rounded(.toNearestOrEven)), 1), max(1, shot.width - x))
        let h = min(max(Int((sel.height * scale).rounded(.toNearestOrEven)), 1), max(1, shot.height - y))
        let notes = r.marks.filter { $0.hasNote }
        let withPanel = notesInImage && (!notes.isEmpty || !r.overall.isEmpty)
        // A small selection with a notes area below: enlarged by a whole factor to nearly the notes area's width and centered
        let k = withPanel ? zoom(w, Int(ceil(CGFloat(NotesBlock.minWidth) * scale))) : 1
        let zw = w * k
        let zh = h * k
        let panel = withPanel ? notesPanel(r, notes: notes, imageWidth: zw, imageHeight: zh, s: scale, extra: promptExtra) : nil
        let width = max(zw, panel?.width ?? 0)
        let left = CGFloat((width - zw) / 2)
        let height = zh + (panel?.height ?? 0)

        guard
            let context = CGContext(
                data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0, space: CGColorSpace(name: CGColorSpace.sRGB)!,
                bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue),
            let part = shot.cropping(to: CGRect(x: x, y: y, width: w, height: h))
        else { throw Failure.noPicture }
        // The y axis points down from here on, as in the overlay
        context.translateBy(x: 0, y: CGFloat(height))
        context.scaleBy(x: 1, y: -1)
        context.setFillColor(NSColor(hex: 0x141416).cgColor)
        context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        let shown = CGRect(x: left, y: 0, width: CGFloat(zw), height: CGFloat(zh))
        MarkPainter.drawPicture(k == 1 ? part : (enlarge(part, k) ?? part), in: shown, context: context)

        // Marks are in the overlay's points: moved to the selection's corner and scaled to the picture's pixels (times the enlargement).
        // When the screenshot is enlarged, only the selection's part of the pixelated picture is taken and enlarged pixel by pixel:
        // stretching the whole one would smear the blocks into a gradient
        var pixelated = r.pixelated
        var pixelatedAt = r.full
        if k > 1, let whole = r.pixelated, let piece = whole.cropping(to: CGRect(x: x, y: y, width: w, height: h)), let big = enlarge(piece, k) {
            pixelated = big
            pixelatedAt = CGRect(x: CGFloat(x) / scale, y: CGFloat(y) / scale, width: CGFloat(w) / scale, height: CGFloat(h) / scale)
        }
        context.saveGState()
        context.clip(to: shown)
        let z = scale * CGFloat(k)
        context.concatenate(CGAffineTransform(a: z, b: 0, c: 0, d: z, tx: left - sel.minX * z, ty: -sel.minY * z))
        for m in r.marks { MarkPainter.draw(m, in: context, pixelated: pixelated, screen: pixelatedAt, keepInside: sel, zoom: CGFloat(k)) }
        context.restoreGState()
        if let panel {
            context.saveGState()
            context.translateBy(x: 0, y: CGFloat(zh))
            panel.draw(in: context, canvasWidth: width)
            context.restoreGState()
        }
        guard let image = context.makeImage(), let encoded = Self.png(image, scale: scale) else { throw Failure.noPicture }
        return Output(image: image, png: encoded, size: (width, height))
    }

    /// The picture as PNG, its resolution set from the screen's scale (a picture from a Retina screen is 144 dpi), so an app that pastes it
    /// lays it out at the size it had on screen
    static func png(_ image: CGImage, scale: CGFloat) -> Data? {
        let rep = NSBitmapImageRep(cgImage: image)
        rep.size = NSSize(width: CGFloat(image.width) / scale, height: CGFloat(image.height) / scale)
        return rep.representation(using: .png, properties: [:])
    }

    /// How many times to enlarge a selection `imageWidth` pixels wide to get close to the notes area's width: a whole factor, at most 4;
    /// one that is wide enough already is not enlarged
    static func zoom(_ imageWidth: Int, _ panelWidth: Int) -> Int {
        imageWidth <= 0 ? 1 : min(max(panelWidth / imageWidth, 1), 4)
    }

    /// Enlarged pixel by pixel by a factor of k: each pixel becomes a k × k block with sharp edges
    static func enlarge(_ image: CGImage, _ k: Int) -> CGImage? {
        let w = image.width * k
        let h = image.height * k
        let space = image.colorSpace.flatMap { $0.model == .rgb ? $0 : nil } ?? CGColorSpace(name: CGColorSpace.sRGB)!
        guard
            let context = CGContext(
                data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: 0, space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)
        else { return nil }
        context.interpolationQuality = .none
        context.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        return context.makeImage()
    }

    /// The notes area: the same wording as the words for the AI (category, position with pixel coordinates, original text), so a picture
    /// pasted without the words still says exactly where; the Extra instructions come last
    static func notesPanel(_ r: CaptureResult, notes: [Mark], imageWidth: Int, imageHeight: Int, s: CGFloat, extra: String) -> NotesBlock {
        NotesBlock.build(
            entries: noteEntries(r, notes: notes, size: (imageWidth, imageHeight)),
            overall: r.overall.isEmpty
                ? nil
                : NoteEntry(number: 0, color: ToolPrefs.colors[0], category: r.overallCategory, whereText: ShellText.t("capture.note.overall"), body: r.overall),
            title: notesTitle(numbered: !notes.isEmpty), extra: extra, imageWidth: imageWidth, s: s, imageHeight: imageHeight)
    }

    /// The notes one by one. The notes area and the words for the AI both come from here, so they cannot disagree. Positions are for the
    /// picture that is handed over (an enlarged one when the screenshot was enlarged)
    static func noteEntries(_ r: CaptureResult, notes: [Mark], size: PixelSize) -> [NoteEntry] {
        notes.map { m in
            NoteEntry(number: m.number, color: m.color, category: m.category, whereText: m.whereAll(r.marks, sel: r.selection, size: size), body: m.note)
        }
    }

    /// With only an overall comment the picture has no numbers, so the title must not say the numbers match
    static func notesTitle(numbered: Bool) -> String {
        ShellText.t(numbered ? "ai.capture.blockNumbered" : "ai.capture.blockOverall")
    }

    /// The words for an AI: the notes with their positions, the file, the Extra instructions. Numbers are written in a fixed format (a
    /// region's number format could make an AI misread coordinates)
    static func handoffText(_ r: CaptureResult, notes: [Mark], file: String?, size: PixelSize, promptExtra: String) -> String {
        var lines: [String] = []
        lines.append(ShellText.t(notes.isEmpty ? "ai.capture.introOverall" : "ai.capture.introNumbered"))
        // A note that marks several places applies to each of them (the same as the main app's Copy as Text)
        if r.marks.contains(where: { $0.lead != nil }) { lines.append(ShellText.t("ai.manyHint")) }
        for e in noteEntries(r, notes: notes, size: size) {
            lines.append(
                ShellText.t("ai.capture.line", values: ["n": e.number, "category": Categories.label(e.category), "where": e.whereText, "note": e.body]))
        }
        if !r.overall.isEmpty {
            lines.append(ShellText.t("ai.capture.overallLine", values: ["category": Categories.label(r.overallCategory), "note": r.overall]))
        }
        lines.append("")
        // Without a saved file no path is written: the AI would go looking for a file that does not exist
        if let file {
            lines.append(ShellText.t("ai.capture.file", values: ["file": file, "w": size.width, "h": size.height]))
        } else {
            lines.append(ShellText.t("ai.capture.image", values: ["w": size.width, "h": size.height]))
        }
        if !promptExtra.isEmpty {
            lines.append("")
            lines.append(promptExtra)
        }
        return lines.joined(separator: "\n").trimmedEnd
    }

    // MARK: The file

    /// "capture-2026-10-22_14-03-05.png", "-2" added for the second picture in the same second. No language and no spaces in the name (the
    /// path is handed to AI agents and command lines); the date always in the Gregorian calendar and a fixed format, whatever the region
    static func fileName(_ at: Date, _ n: Int) -> String {
        let format = DateFormatter()
        format.locale = Foundation.Locale(identifier: "en_US_POSIX")
        format.calendar = Calendar(identifier: .gregorian)
        format.timeZone = .current
        format.dateFormat = "yyyy-MM-dd_HH-mm-ss"
        return "capture-" + format.string(from: at) + (n > 1 ? "-\(n)" : "") + ".png"
    }

    /// Writes the picture into `folder` and returns its path. In the default folder (`cleanable`), pictures older than 30 days are removed
    /// first: an AI reads the file as soon as it is pasted. A folder the user chose is never cleaned
    static func save(_ png: Data, folder: String, cleanable: Bool, now: Date = Date()) throws -> String {
        try FileManager.default.createDirectory(atPath: folder, withIntermediateDirectories: true)
        if cleanable { cleanOld(folder, now: now) }
        var n = 1
        while true {
            let path = (folder as NSString).appendingPathComponent(fileName(now, n))
            do {
                try png.write(to: URL(fileURLWithPath: path), options: .withoutOverwriting)
                return path
            } catch let error as CocoaError where error.code == .fileWriteFileExists {
                n += 1
            }
        }
    }

    /// Removes this app's pictures older than 30 days from a folder; one that cannot be removed is left for next time
    static func cleanOld(_ folder: String, now: Date) {
        let limit = now.addingTimeInterval(-30 * 24 * 3600)
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: folder) else { return }
        for name in names where name.hasPrefix("capture-") && name.hasSuffix(".png") {
            let path = (folder as NSString).appendingPathComponent(name)
            guard let modified = (try? FileManager.default.attributesOfItem(atPath: path))?[.modificationDate] as? Date, modified < limit else { continue }
            try? FileManager.default.removeItem(atPath: path)
        }
    }
}
