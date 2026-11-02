import Foundation

/// Things opened from outside (the file manager's Open With, `open -a`, a drop on the Dock icon, the command line) while the page is not
/// listening yet: the location, what was not added with the reasons, and the entries recognized as moved. The page loaded this time takes
/// them with its first read of the library, and from then on listens for `libraryChanged`. Later reads do not take them: a page that is
/// about to reload may still read the library once, and that read would otherwise take away what was queued for the new page.
/// Thread-safe: results arrive on a background queue, the library is read on the bridge's
final class PendingOpens {
    private let lock = NSLock()
    private var focus: String?
    private var skipped: [String] = []
    private var relocated: [Library.Relocation] = []
    private var listening = false

    /// The page loaded this time has read the library: its `libraryChanged` listener is attached
    var isListening: Bool {
        lock.lock()
        defer { lock.unlock() }
        return listening
    }

    /// Queues the result unless the page is listening, and says whether it did. When it did not, the caller pushes `libraryChanged` itself.
    /// Decided under the lock, so a page that starts listening at the same moment gets the result one way or the other
    func stashUnlessListening(_ result: Library.AddResult) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if listening { return false }
        focus = result.focus ?? focus
        skipped.append(contentsOf: result.skipped)
        relocated.append(contentsOf: result.relocated)
        return true
    }

    /// The page starts loading (the first load, or a reload): the new page is not listening yet
    func navigating() {
        lock.lock()
        listening = false
        lock.unlock()
    }

    /// What the page gets with its first read of the library after it loads; nothing on the reads after that
    func take() -> (focus: String?, skipped: [String], relocated: [Library.Relocation]) {
        lock.lock()
        defer { lock.unlock() }
        if listening { return (focus: nil, skipped: [], relocated: []) }
        listening = true
        let taken = (focus: focus, skipped: skipped, relocated: relocated)
        focus = nil
        skipped = []
        relocated = []
        return taken
    }
}

/// Adds what is opened from outside to the library and tells the page. The Mac counterpart of `OpenFromOutside` in MainWindow.Opens.cs;
/// there is no second process to hand over from, since the system sends a second open of the same app to the running one.
/// Adding runs on a serial background queue (a path on a network volume can take long to check), in the order things were opened
final class OutsideOpens {
    typealias Emit = (String, [String: Any]) -> Void

    private let pending: PendingOpens
    private let add: ([String]) -> Library.AddResult
    private let emit: Emit
    private let show: () -> Void
    private let queue = DispatchQueue(label: "snip.opens", qos: .userInitiated)

    /// - Parameter add: adds the paths to the library (`Library.add`); runs on the background queue
    /// - Parameter emit: sends an event to the page (`BridgeHost.emit`)
    /// - Parameter show: brings the window to the front, showing it if it is hidden; called on the thread that calls `open`
    init(pending: PendingOpens, add: @escaping ([String]) -> Library.AddResult, emit: @escaping Emit, show: @escaping () -> Void) {
        self.pending = pending
        self.add = add
        self.emit = emit
        self.show = show
    }

    /// Any thread. The window comes forward first, since checking the paths may take a while. Opening nothing only brings it forward
    func open(_ paths: [String]) {
        show()
        if paths.isEmpty { return }
        queue.async { [self] in handle(paths) }
    }

    /// Adds the paths and delivers the result. Runs on the background queue
    func handle(_ paths: [String]) {
        deliver(add(paths))
    }

    /// While the page is not listening the result waits for its first read of the library; afterwards it is pushed
    func deliver(_ result: Library.AddResult) {
        if pending.stashUnlessListening(result) { return }
        emit("libraryChanged", OutsideOpens.event(for: result))
    }

    /// Waits until everything opened so far has been handled. For tests
    func flush() {
        queue.sync {}
    }

    /// The payload of `libraryChanged` (host.ts): the page re-reads the library, locates `focus` and explains `skipped` and `relocated`
    static func event(for result: Library.AddResult) -> [String: Any] {
        [
            "focus": jsonOrNull(result.focus),
            "skipped": result.skipped,
            "relocated": result.relocated.map { ["from": $0.from, "to": $0.to] },
        ]
    }
}

/// The paths on the command line (`SnipToss <path>...`)
enum LaunchArguments {
    /// The arguments after the program's own name, without the options the system adds: those start with a dash (`-psn_...`), and the
    /// user-defaults overrides (`-NSDocumentRevisionsDebugMode YES`, `-AppleLanguages (de)`) take the next argument as their value
    static func paths(from arguments: [String]) -> [String] {
        var paths: [String] = []
        var index = 1
        while index < arguments.count {
            let argument = arguments[index]
            index += 1
            if argument.hasPrefix("-") {
                if (argument.hasPrefix("-NS") || argument.hasPrefix("-Apple")) && index < arguments.count { index += 1 }
                continue
            }
            if !argument.isEmpty { paths.append(argument) }
        }
        return paths
    }
}
