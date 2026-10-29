import AppKit
import Foundation

/// Placeholder answers for the calls the UI makes while it starts that have no real implementation yet (the window and screen capture).
/// Replaced one method at a time by the real implementations (docs/host-api.md); a method that is not registered answers "not implemented"
func installStubMethods(into bridge: BridgeHost) {
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
        bridge?.addPageLog("\(level): \(message)")
        if level == "info" { Log.info("page: \(message)") } else { Log.error("page \(level): \(message)") }
        return nil
    }
}
