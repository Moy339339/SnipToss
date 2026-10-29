import AppKit
import WebKit

/// The paths of the files of the last drop onto the window. WKWebView gives the page a dropped `File` without a path, so the shell reads
/// the paths from the drag pasteboard itself and keeps them for the `addDropped` call the page makes right after the drop.
/// They are good for a few seconds and are handed out once, so they cannot be taken by a later call that has no drop behind it.
/// Thread-safe: stored on the main thread, taken on the bridge's queue
final class DroppedPaths {
    /// How long the paths of a drop wait for the page to ask for them, in seconds
    static let lifetime: TimeInterval = 10

    private let clock: () -> TimeInterval
    private let lock = NSLock()
    private var paths: [String] = []
    private var storedAt: TimeInterval = 0

    /// - Parameter clock: seconds on a clock that only moves forward; tests move it by hand
    init(clock: @escaping () -> TimeInterval = { ProcessInfo.processInfo.systemUptime }) {
        self.clock = clock
    }

    /// Keeps the paths of a drop, in place of those of an earlier one. A drop without files (an image dragged out of a web page) stores
    /// an empty list, so the files of an earlier drop cannot be taken for it
    func store(_ new: [String]) {
        lock.lock()
        paths = new
        storedAt = clock()
        lock.unlock()
    }

    /// The paths of the last drop if it was not longer ago than `lifetime`, and forgets them either way
    func take() -> [String] {
        lock.lock()
        defer { lock.unlock() }
        let fresh = clock() - storedAt < DroppedPaths.lifetime
        let taken = fresh ? paths : []
        paths = []
        return taken
    }
}

/// The web view of the main window. It does what any WKWebView does with a drop and also records the paths of the dropped files
/// (`DroppedPaths`), which the page cannot get itself
final class DropWebView: WKWebView {
    private let dropped: DroppedPaths

    init(frame: NSRect, configuration: WKWebViewConfiguration, dropped: DroppedPaths) {
        self.dropped = dropped
        super.init(frame: frame, configuration: configuration)
    }

    required init?(coder: NSCoder) {
        fatalError("DropWebView is created in code")
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        // Recorded before the page is handed the drop, so its `addDropped` call cannot get ahead of the paths
        dropped.store(SystemClipboard(pasteboard: sender.draggingPasteboard).filePaths())
        return super.performDragOperation(sender)
    }
}

/// The reply of `addDropped` for the paths of the last drop. With none, nothing is added and the answer is empty: that is a drop with no
/// file behind it (an image dragged out of a web page), and the page explains it in its own words when it gets an empty answer
func addDroppedReply(paths: [String], add: ([String]) -> Library.AddResult) -> [String: Any] {
    if paths.isEmpty { return addReply(Library.AddResult(added: [], focus: nil, skipped: [], relocated: [])) }
    return addReply(add(paths))
}

/// `addDropped`: the page sends the dropped `File` objects with the call, but they carry no path on the Mac (BridgeShim.swift), so
/// the paths come from the native drop that has just happened
func installDropMethods(into bridge: BridgeHost, settings: Settings, dropped: DroppedPaths) {
    bridge.register("addDropped") { _ in
        addDroppedReply(paths: dropped.take(), add: { Library.add(settings, paths: $0) })
    }
}
