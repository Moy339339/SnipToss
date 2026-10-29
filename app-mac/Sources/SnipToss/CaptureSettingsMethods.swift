import Foundation

/// The bridge methods for Settings > Screen Capture: `captureSettings`, `setCaptureSettings` and `captureHotkeyPause` (docs/host-api.md,
/// "Settings, window, miscellaneous"). A shortcut the page sends is registered with the system first and stored only when that worked
/// (the previous one stays otherwise, and `hotkeyError` says why); `hotkeyError` also carries why the stored one could not be registered
/// at startup. `autostart` is kept, and no login item is registered for it yet.
/// `keepInTray` and `hideWindow` take effect: the first decides what closing the window does (StatusItem.swift), the second is read when
/// capture starts from the window.
/// Both replies also carry `screenAccess`, whether macOS lets the app record the screen, and `openScreenAccessSettings` leads the user to
/// where it is allowed: the system's own question the first time, System Settings afterwards (docs/host-api.md, "The screen recording
/// permission"; `ScreenAccessAsk.lead`).
/// - Parameter hotkey: what registers the shortcut (nil: nothing does, the shortcut is only kept)
/// - Parameter access: the screen recording permission (nil: not known, and `screenAccess` is left out)
/// - Parameter defaults: where it is kept that the system was asked
/// - Parameter onKeepInTrayChanged: told the new value after a call that carried `keepInTray`, so the menu bar item can follow. Called on
///   the bridge's background queue
func installCaptureSettingsMethods(
    into bridge: BridgeHost, settings: Settings, hotkey: HotKeyControl? = nil, access: ScreenAccess? = nil,
    defaults: UserDefaults = .standard, onKeepInTrayChanged: @escaping (Bool) -> Void = { _ in }
) {
    bridge.register("captureSettings") { _ in
        captureSettingsReply(settings.capture, hotkeyError: hotkey?.error, screenAccess: access?.allowed)
    }

    bridge.register("setCaptureSettings") { params in
        let patch = CaptureSettingsPatch(params)
        // The system's hot key calls are made on the main thread
        let reply = onMain { setCaptureSettingsReply(patch, settings: settings, hotkey: hotkey, screenAccess: access?.allowed) }
        if let keepInTray = patch.keepInTray { onKeepInTrayChanged(keepInTray) }
        return reply
    }

    bridge.register("openScreenAccessSettings") { _ in
        runOnMain {
            if let access { ScreenAccessAsk.lead(access, defaults: defaults) }
        }
        return nil
    }

    // While a new shortcut is being recorded the old one is taken away, so that pressing it is recorded and does not start a capture
    bridge.register("captureHotkeyPause") { params in
        let pause = (params as? [String: Any]).flatMap { jsonBool($0["pause"]) } ?? false
        onMain {
            if pause { hotkey?.pause() } else { hotkey?.resume() }
        }
        return nil
    }
}

/// The reply of both methods: the settings as the page shows them.
/// `defaultFolder` is where screenshots go when `folder` is empty; `screenAccess` is left out when it is nil
func captureSettingsReply(
    _ capture: CaptureSettings, defaultFolder: String = AppPaths.capturesDir, hotkeyError: String? = nil, screenAccess: Bool? = nil
) -> [String: Any] {
    var reply: [String: Any] = [
        "hotkey": capture.hotkey,
        "hotkeyError": hotkeyError ?? NSNull(),
        "hotkeyTypes": "",
        "hotkeyMoved": NSNull(),
        "keepInTray": capture.keepInTray,
        "hideWindow": capture.hideWindow,
        "notesInImage": capture.notesInImage,
        "folder": capture.folder ?? "",
        "defaultFolder": defaultFolder,
        "autostart": capture.autostart,
    ]
    if let screenAccess { reply["screenAccess"] = screenAccess }
    return reply
}

/// Stores what the patch carries and replies with the settings afterwards
func setCaptureSettingsReply(
    _ patch: CaptureSettingsPatch, settings: Settings, defaultFolder: String = AppPaths.capturesDir, hotkey: HotKeyControl? = nil,
    screenAccess: Bool? = nil
) -> [String: Any] {
    var patch = patch
    var failure: String?
    if let text = patch.hotkey, let hotkey {
        // Registered first, stored only when it worked: the shortcut that was set before stays when it did not
        failure = hotkey.set(text)
        if failure == nil { hotkey.error = nil } else { patch.hotkey = nil }
    }
    settings.update { values in patch.apply(to: &values.capture) }
    return captureSettingsReply(settings.capture, defaultFolder: defaultFolder, hotkeyError: failure ?? hotkey?.error, screenAccess: screenAccess)
}

/// The items of a `setCaptureSettings` call (host.ts, `Partial<CaptureSettings>`). An item that is missing or has the wrong type changes
/// nothing; text is trimmed, and a folder that is blank afterwards goes back to the default
struct CaptureSettingsPatch {
    var hotkey: String?
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
