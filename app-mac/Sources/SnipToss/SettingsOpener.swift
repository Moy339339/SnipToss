import Foundation

/// Opening a page of Settings from the shell (the app menu, the menu bar item, the notice that the capture shortcut couldn't be enabled):
/// the page is told with the `openSettings` event. A page that has not said `ready` yet would miss the event, so the section waits and is
/// sent once the page is ready (the Windows shell's pendingSettings); a page that reloads waits again. Safe from any thread
final class SettingsOpener {
    private let emit: (String, [String: Any]) -> Void
    private let lock = NSLock()
    private var ready = false
    private var waiting: String?

    init(emit: @escaping (String, [String: Any]) -> Void) {
        self.emit = emit
    }

    /// Opens a section of SettingsDialog (an unknown one opens General); only the last one asked for waits
    func open(_ section: String) {
        let now: Bool = lock.withLock {
            if !ready { waiting = section }
            return ready
        }
        if now { emit("openSettings", ["section": section]) }
    }

    /// The page has drawn its first screen
    func pageReady() {
        let section: String? = lock.withLock {
            ready = true
            defer { waiting = nil }
            return waiting
        }
        if let section { emit("openSettings", ["section": section]) }
    }

    /// A new page starts loading: events wait for it again
    func pageReloading() {
        lock.withLock { ready = false }
    }
}
