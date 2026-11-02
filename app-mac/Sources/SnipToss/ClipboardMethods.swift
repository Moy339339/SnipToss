import AppKit
import Foundation

/// What is read from a pasteboard: the clipboard for `pasteClipboard`, the drag pasteboard for a drop. A protocol so tests can stand in a
/// clipboard of their own and never touch the system's
protocol ClipboardReading {
    /// The paths of the files and folders on it (copied in the file manager); empty when there are none
    func filePaths() -> [String]
    /// An image on it as PNG data (copied from a web page or a chat app, or a screenshot sent to the clipboard); nil when there is none
    func pngData() -> Data?
}

/// A real pasteboard. Safe to call from any thread: the pasteboard is read on the main thread
struct SystemClipboard: ClipboardReading {
    let pasteboard: NSPasteboard

    init(pasteboard: NSPasteboard = .general) {
        self.pasteboard = pasteboard
    }

    func filePaths() -> [String] {
        onMainThread { () -> [String] in
            let urls = pasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL] ?? []
            return ClipboardPaths.of(urls)
        }
    }

    func pngData() -> Data? {
        onMainThread { () -> Data? in
            // A PNG the source put there is used as it is (browsers and chat apps usually do, with transparency)
            if let png = pasteboard.data(forType: .png) { return png }
            if let tiff = pasteboard.data(forType: .tiff) { return PastedImages.png(fromImageData: tiff) }
            // Any other image the system can read from it
            guard NSImage.canInit(with: pasteboard), let image = NSImage(pasteboard: pasteboard), let tiff = image.tiffRepresentation else {
                return nil
            }
            return PastedImages.png(fromImageData: tiff)
        }
    }

    private func onMainThread<T>(_ work: () -> T) -> T {
        Thread.isMainThread ? work() : DispatchQueue.main.sync(execute: work)
    }
}

enum ClipboardPaths {
    /// The paths of the file URLs among these URLs (a link to a web page copied next to a file is not one). A file reference URL
    /// (`file:///.file/id=...`) becomes the path it stands for
    static func of(_ urls: [URL]) -> [String] {
        urls.filter { $0.isFileURL }.map { url in (url as NSURL).filePathURL?.path ?? url.path }
    }
}

enum PastedImages {
    /// The file name of an image pasted at `date`, without the extension: paste-yyyyMMdd-HHmmss
    static func stem(for date: Date, timeZone: TimeZone = .current) -> String {
        let formatter = DateFormatter()
        formatter.locale = Foundation.Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return "paste-" + formatter.string(from: date)
    }

    /// A path in `dir` that is not taken: stem.png, then stem-2.png, stem-3.png, ...
    static func freePath(in dir: String, stem: String) -> String {
        var path = dir + "/" + stem + ".png"
        var number = 2
        while FileManager.default.fileExists(atPath: path) {
            path = dir + "/" + stem + "-\(number).png"
            number += 1
        }
        return path
    }

    /// PNG data for image data in another format (TIFF is what the system puts on the pasteboard for a copied bitmap); nil if not an image
    static func png(fromImageData data: Data) -> Data? {
        NSBitmapImageRep(data: data)?.representation(using: .png, properties: [:])
    }

    /// Saves the image into `dir` (created if missing) under a new name and returns the path
    static func save(_ png: Data, in dir: String, now: Date, timeZone: TimeZone = .current) throws -> String {
        do {
            try AtomicFile.ensureDirectory(dir)
            let file = freePath(in: dir, stem: stem(for: now, timeZone: timeZone))
            try AtomicFile.write(file, png)
            return file
        } catch let error as FileOperationError {
            throw bridgeError(error)
        }
    }
}

/// `pasteClipboard`: files and folders copied in the file manager are handled like a drop. An image is saved as PNG in the pasted-images
/// folder, that folder is added to the library (it is one project, never cleaned up) and the image is located; `pasted` is that file.
/// Neither on the clipboard: `empty`, and the page says so
func pasteReply(
    settings: Settings, clipboard: ClipboardReading, pastedDir: String, now: Date = Date(), timeZone: TimeZone = .current
) throws -> [String: Any] {
    let files = clipboard.filePaths()
    if !files.isEmpty { return addReply(Library.add(settings, paths: files)) }
    guard let png = clipboard.pngData() else {
        var reply = addReply(Library.AddResult(added: [], focus: nil, skipped: [], relocated: []))
        reply["empty"] = true
        return reply
    }
    let file = try PastedImages.save(png, in: pastedDir, now: now, timeZone: timeZone)
    Log.info("Pasted an image: \(file)")
    let added = Library.add(settings, paths: [pastedDir])
    // The folder may be in the library already, which makes `added` empty and the focus the folder; the page should land on the image
    let result = Library.AddResult(added: added.added, focus: file, skipped: added.skipped, relocated: added.relocated)
    return addReply(result, pasted: file)
}

/// - Parameter clipboard: what is on the clipboard; the system's unless a test says otherwise
/// - Parameter pastedDir: where pasted images go (`appInfo.pastedDir`)
func installClipboardMethods(
    into bridge: BridgeHost, settings: Settings, clipboard: ClipboardReading = SystemClipboard(), pastedDir: String = AppPaths.pastedDir
) {
    bridge.register("pasteClipboard") { _ in
        try pasteReply(settings: settings, clipboard: clipboard, pastedDir: pastedDir)
    }
}
