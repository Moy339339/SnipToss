import Foundation

/// The bridge methods for Settings > Screen Capture: `captureSettings`, `setCaptureSettings` and `captureHotkeyPause` (docs/host-api.md,
/// "Settings, window, miscellaneous"). A shortcut the page sends is registered with the system first and stored only when that worked
/// (the previous one stays otherwise, and `hotkeyError` says why); `hotkeyError` also carries why the stored one could not be registered
/// at startup.
/// `autostart` is whether the app is registered as a login item with the system (`LoginItemControl`, LoginItem.swift): a switch in the
/// page registers or removes it, and the replies say what the system says now (the user can also switch it off in System Settings). When
/// the system refuses, or waits for the user to allow it, everything else in the call is still stored and the call fails with a message
/// the page shows, as the Windows shell's does when it cannot write the registry. The settings file keeps the last state the system
/// reported.
/// `keepInTray` and `hideWindow` take effect: the first decides what closing the window does (StatusItem.swift), the second is read when
/// capture starts from the window.
/// Both replies also carry `screenAccess`, whether macOS lets the app record the screen, and `openScreenAccessSettings` leads the user to
/// where it is allowed: the system's own question the first time, System Settings afterwards (docs/host-api.md, "The screen recording
/// permission"; `ScreenAccessAsk.lead`).
/// - Parameter hotkey: what registers the shortcut (nil: nothing does, the shortcut is only kept)
/// - Parameter access: the screen recording permission (nil: not known, and `screenAccess` is left out)
/// - Parameter loginItem: the login item (nil: none, `autostart` is only kept, as it was set)
/// - Parameter defaults: where it is kept that the system was asked
/// - Parameter onKeepInTrayChanged: told the new value after a call that carried `keepInTray`, so the menu bar item can follow. Called on
///   the bridge's background queue
func installCaptureSettingsMethods(
    into bridge: BridgeHost, settings: Settings, hotkey: HotKeyControl? = nil, access: ScreenAccess? = nil,
    loginItem: LoginItemControl? = nil, defaults: UserDefaults = .standard, onKeepInTrayChanged: @escaping (Bool) -> Void = { _ in }
) {
    bridge.register("captureSettings") { _ in
        captureSettingsReply(
            settings.capture, hotkeyError: hotkey?.error, screenAccess: access?.allowed, autostart: loginItem.map { $0.state == .on })
    }

    bridge.register("setCaptureSettings") { params in
        let patch = CaptureSettingsPatch(params)
        // The system's hot key calls are made on the main thread
        let outcome = onMain {
            applyCaptureSettings(patch, settings: settings, hotkey: hotkey, screenAccess: access?.allowed, loginItem: loginItem)
        }
        if let keepInTray = patch.keepInTray { onKeepInTrayChanged(keepInTray) }
        if let refusal = outcome.loginItemRefusal { throw refusal }
        return outcome.reply
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

/// The recent custom colors (docs/host-api.md): `recentColors` and `addRecentColor { color }`, shared by every color row of the page and by
/// the capture overlay. When the list changes (from the page or on the overlay) the page gets the `recentColors` event with the new list
func installRecentColorMethods(into bridge: BridgeHost, settings: Settings) {
    bridge.register("recentColors") { _ in settings.recentColors }
    bridge.register("addRecentColor") { params in try addRecentColorReply(params, settings: settings) }
    settings.onRecentColorsChanged = { [weak bridge] colors in bridge?.emit("recentColors", ["colors": colors]) }
}

/// `addRecentColor { color }`: the list after the change
func addRecentColorReply(_ params: Any?, settings: Settings) throws -> [String] {
    guard let color = (params as? [String: Any])?["color"] as? String else { throw BridgeError("addRecentColor needs { color }") }
    return try settings.addRecentColor(color)
}

/// The reply of both methods: the settings as the page shows them.
/// `defaultFolder` is where screenshots go when `folder` is empty; `screenAccess` is left out when it is nil;
/// `autostart` is what the system says about the login item, the stored value when it is nil
func captureSettingsReply(
    _ capture: CaptureSettings, defaultFolder: String = AppPaths.capturesDir, hotkeyError: String? = nil, screenAccess: Bool? = nil,
    autostart: Bool? = nil
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
        "autostart": autostart ?? capture.autostart,
    ]
    if let screenAccess { reply["screenAccess"] = screenAccess }
    return reply
}

/// What a `setCaptureSettings` call came to: the reply, and the refusal of the login item when the system would not do what was asked
/// (the call then fails with it, after everything else was stored)
struct CaptureSettingsOutcome {
    let reply: [String: Any]
    let loginItemRefusal: BridgeError?
}

/// Stores what the patch carries and replies with the settings afterwards
func setCaptureSettingsReply(
    _ patch: CaptureSettingsPatch, settings: Settings, defaultFolder: String = AppPaths.capturesDir, hotkey: HotKeyControl? = nil,
    screenAccess: Bool? = nil
) -> [String: Any] {
    applyCaptureSettings(patch, settings: settings, defaultFolder: defaultFolder, hotkey: hotkey, screenAccess: screenAccess).reply
}

/// The shortcut is registered first (stored only when that worked), then the login item is changed if the patch asks for it, then the
/// rest is stored. What is kept for `autostart`, and replied, is what the system says afterwards, whatever was asked: a switch the system
/// refused stays where it was. Without a login item (nil) `autostart` is stored as sent
func applyCaptureSettings(
    _ patch: CaptureSettingsPatch, settings: Settings, defaultFolder: String = AppPaths.capturesDir, hotkey: HotKeyControl? = nil,
    screenAccess: Bool? = nil, loginItem: LoginItemControl? = nil
) -> CaptureSettingsOutcome {
    var patch = patch
    var failure: String?
    if let text = patch.hotkey, let hotkey {
        // Registered first, stored only when it worked: the shortcut that was set before stays when it did not
        failure = hotkey.set(text)
        if failure == nil { hotkey.error = nil } else { patch.hotkey = nil }
    }
    var refusal: BridgeError?
    var autostart: Bool?
    if let loginItem {
        if let wanted = patch.autostart { refusal = LoginItemChange.apply(wanted, to: loginItem) }
        let enabled = loginItem.state == .on
        patch.autostart = enabled
        autostart = enabled
    }
    settings.update { values in patch.apply(to: &values.capture) }
    let reply = captureSettingsReply(
        settings.capture, defaultFolder: defaultFolder, hotkeyError: failure ?? hotkey?.error, screenAccess: screenAccess, autostart: autostart)
    return CaptureSettingsOutcome(reply: reply, loginItemRefusal: refusal)
}

/// The items of a `setCaptureSettings` call (host.ts, `Partial<CaptureSettings>`). An item that is missing or has the wrong type changes
/// nothing; text is trimmed, and a folder that is blank afterwards goes back to the default
struct CaptureSettingsPatch {
    var hotkey: String?
    let keepInTray: Bool?
    let hideWindow: Bool?
    let notesInImage: Bool?
    let folder: String?
    var autostart: Bool?

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
