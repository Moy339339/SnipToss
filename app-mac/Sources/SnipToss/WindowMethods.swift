import AppKit
import Foundation

/// The window as the page sees it (docs/host-api.md, "Settings, window, miscellaneous"): its state, the actions of the Window menu, and
/// the two things the page's own title strip asks for, because `-webkit-app-region` does nothing in a WKWebView: dragging the window by
/// the strip (`windowDrag`) and the double click on it (`windowZoom`)
final class WindowController {
    private let window: NSWindow
    private let settings: Settings
    /// The last left mouse press in the window (main thread only). `performDrag` needs the press that starts the drag, and the page's call
    /// reaches us a moment after it
    private var lastPress: NSEvent?
    private var monitor: Any?

    init(window: NSWindow, settings: Settings) {
        self.window = window
        self.settings = settings
        monitor = NSEvent.addLocalMonitorForEvents(matching: .leftMouseDown) { [weak self] event in
            self?.lastPress = event
            return event
        }
        // Remembered from the last run
        if settings.current.topmost { window.level = .floating }
    }

    deinit {
        if let monitor { NSEvent.removeMonitor(monitor) }
    }

    func install(into bridge: BridgeHost) {
        bridge.register("windowState") { [self] _ in onMain { state() } }
        bridge.register("window") { [self] params in
            guard let p = params as? [String: Any], let action = p["action"] as? String else { throw BridgeError("Missing argument: action") }
            return try onMain { try perform(action) }
        }
        bridge.register("windowDrag") { [self] _ in
            onMain { drag() }
            return nil
        }
        bridge.register("windowZoom") { [self] _ in
            onMain { zoomOrMinimize() }
            return nil
        }
    }

    /// Main thread only
    func state() -> [String: Any] {
        ["maximized": window.isZoomed, "fullscreen": window.styleMask.contains(.fullScreen), "topmost": window.level == .floating]
    }

    /// Main thread only. Returns the state afterwards (a change to full screen finishes a moment later; the page asks again when the
    /// window's size changes)
    private func perform(_ action: String) throws -> [String: Any] {
        switch action {
        case "minimize": window.miniaturize(nil)
        case "maximize": window.zoom(nil)
        case "fullscreen": window.toggleFullScreen(nil)
        case "topmost":
            let on = window.level != .floating
            window.level = on ? .floating : .normal
            settings.update { $0.topmost = on }
        case "close": window.performClose(nil)
        case "quit": NSApp.terminate(nil)
        case "resetLayout":
            window.setContentSize(NSSize(width: 1280, height: 800))
            window.center()
        default: throw BridgeError("Unknown window action: \(action)")
        }
        return state()
    }

    /// Main thread only. Starts moving the window with the press that is still down. A press older than a second is not that press
    private func drag() {
        guard let press = lastPress, press.window === window, ProcessInfo.processInfo.systemUptime - press.timestamp < 1 else { return }
        window.performDrag(with: press)
    }

    /// Main thread only. What a double click on a title bar does is the user's choice in the system settings
    private func zoomOrMinimize() {
        switch UserDefaults.standard.string(forKey: "AppleActionOnDoubleClick") ?? "Maximize" {
        case "Minimize": window.miniaturize(nil)
        case "None": break
        default: window.zoom(nil)
        }
    }
}
