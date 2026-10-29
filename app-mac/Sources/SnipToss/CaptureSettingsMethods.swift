import Foundation

/// The bridge methods for Settings > Screen Capture: `captureSettings` and `setCaptureSettings` (docs/host-api.md, "Settings, window,
/// miscellaneous"). The capture itself is not here yet, so nothing registers the global shortcut: it is kept as the page sent it and
/// `hotkeyError` is always null. `autostart` is kept too, and no login item is registered for it yet.
/// `keepInTray` and `hideWindow` take effect: the first decides what closing the window does (StatusItem.swift), the second is read when
/// capture starts from the window.
/// - Parameter onKeepInTrayChanged: told the new value after a call that carried `keepInTray`, so the menu bar item can follow. Called on
///   the bridge's background queue
func installCaptureSettingsMethods(
    into bridge: BridgeHost, settings: Settings, onKeepInTrayChanged: @escaping (Bool) -> Void = { _ in }
) {
    bridge.register("captureSettings") { _ in
        captureSettingsReply(settings.capture)
    }

    bridge.register("setCaptureSettings") { params in
        let patch = CaptureSettingsPatch(params)
        let reply = setCaptureSettingsReply(patch, settings: settings)
        if let keepInTray = patch.keepInTray { onKeepInTrayChanged(keepInTray) }
        return reply
    }
}

/// The reply of both methods: the settings as the page shows them.
/// `defaultFolder` is where screenshots go when `folder` is empty
func captureSettingsReply(_ capture: CaptureSettings, defaultFolder: String = AppPaths.capturesDir) -> [String: Any] {
    [
        "hotkey": capture.hotkey,
        // Nothing registers the shortcut with the system yet, so there is nothing that could have failed
        "hotkeyError": NSNull(),
        "hotkeyTypes": "",
        "hotkeyMoved": NSNull(),
        "keepInTray": capture.keepInTray,
        "hideWindow": capture.hideWindow,
        "notesInImage": capture.notesInImage,
        "folder": capture.folder ?? "",
        "defaultFolder": defaultFolder,
        "autostart": capture.autostart,
    ]
}

/// Stores what the patch carries and replies with the settings afterwards
func setCaptureSettingsReply(
    _ patch: CaptureSettingsPatch, settings: Settings, defaultFolder: String = AppPaths.capturesDir
) -> [String: Any] {
    settings.update { values in patch.apply(to: &values.capture) }
    return captureSettingsReply(settings.capture, defaultFolder: defaultFolder)
}

/// The items of a `setCaptureSettings` call (host.ts, `Partial<CaptureSettings>`). An item that is missing or has the wrong type changes
/// nothing; text is trimmed, and a folder that is blank afterwards goes back to the default
struct CaptureSettingsPatch {
    let hotkey: String?
    let keepInTray: Bool?
    let hideWindow: Bool?
    let notesInImage: Bool?
    let folder: String?
    let autostart: Bool?

    init(_ params: Any?) {
        let p = params as? [String: Any] ?? [:]
        hotkey = (p["hotkey"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        keepInTray = jsonBool(p["keepInTray"])
        hideWindow = jsonBool(p["hideWindow"])
        notesInImage = jsonBool(p["notesInImage"])
        folder = (p["folder"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)
        autostart = jsonBool(p["autostart"])
    }

    func apply(to capture: inout CaptureSettings) {
        if let hotkey {
            capture.hotkey = hotkey
            capture.hotkeyCustom = true
        }
        if let keepInTray { capture.keepInTray = keepInTray }
        if let hideWindow { capture.hideWindow = hideWindow }
        if let notesInImage { capture.notesInImage = notesInImage }
        if let folder { capture.folder = folder.isEmpty ? nil : folder }
        if let autostart { capture.autostart = autostart }
    }
}
