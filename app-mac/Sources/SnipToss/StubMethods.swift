import AppKit
import Foundation

/// Placeholder answers for the calls the UI makes while it starts, enough for it to draw the welcome screen with an empty library.
/// Replaced one method at a time by the real implementations (docs/host-api.md); a method that is not registered answers "not implemented"
func installStubMethods(into bridge: BridgeHost) {
    let environment = ProcessInfo.processInfo.environment

    // null means "nothing stored yet": the UI fills in its own defaults
    bridge.register("getPrefs") { _ in nil }
    bridge.register("setPrefs") { _ in nil }

    bridge.register("appInfo") { _ in
        let language = Locale.preferredLanguages.first ?? "en-US"
        return [
            // The UI marks the version in red when it differs from the one it was built with (root package.json)
            "version": environment["SNIPTOSS_VERSION"] ?? "1.0.0",
            "built": environment["SNIPTOSS_BUILT"] ?? "",
            "startupNotice": NSNull(),
            "renamedFromPizhu": false,
            "systemLanguage": language,
            "logDir": "", "dotnet": "", "webview2": "", "exe": "", "settingsPath": "",
            "os": "macOS \(ProcessInfo.processInfo.operatingSystemVersionString)",
            "userName": NSUserName(),
        ] as [String: Any]
    }

    bridge.register("library") { _ in
        ["entries": [Any](), "expanded": [Any](), "collapsed": [Any](), "selected": NSNull(), "focus": NSNull()] as [String: Any]
    }

    // The UI reads every field of a window state; a missing object makes the whole workspace fail to render
    let windowState: BridgeMethod = { _ in ["maximized": false, "fullscreen": false, "topmost": false] as [String: Any] }
    bridge.register("windowState", windowState)
    bridge.register("window", windowState)

    bridge.register("captureSettings") { _ in
        [
            "hotkey": "", "hotkeyError": NSNull(), "hotkeyTypes": "", "hotkeyMoved": NSNull(), "keepInTray": false, "hideWindow": false,
            "notesInImage": true, "folder": "", "defaultFolder": "", "autostart": false,
        ] as [String: Any]
    }

    bridge.register("ready") { _ in nil }

    bridge.register("log") { [weak bridge] params in
        guard let p = params as? [String: Any], let message = p["message"] as? String else { return nil }
        let level = p["level"] as? String ?? "info"
        bridge?.pageLogs.append("\(level): \(message)")
        if level == "info" { Log.info("page: \(message)") } else { Log.error("page \(level): \(message)") }
        return nil
    }
}
