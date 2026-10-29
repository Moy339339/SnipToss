import AppKit
import Foundation
import UniformTypeIdentifiers

/// What was opened from outside before the UI read the library: the path to locate, what was not added (with reasons), and entries
/// recognized as moved. The `library` reply carries it once (`PendingOpens.take`); the default is an empty queue
typealias PendingOpensProvider = () -> (focus: String?, skipped: [String], relocated: [Library.Relocation])

/// The bridge methods for settings and the library (docs/host-api.md, "Library" and "Settings, window, miscellaneous").
/// `addDropped` is in DropWebView.swift and `pasteClipboard` in ClipboardMethods.swift; both reply with `addReply`. The item being viewed
/// (`librarySelect`) is what ChangeWatch.swift checks every second. `scan`, `missing`, `sha256` and `fileUrl` are in ScanMethods.swift
func installLibraryMethods(
    into bridge: BridgeHost, settings: Settings,
    pending: @escaping PendingOpensProvider = { (focus: nil, skipped: [], relocated: []) }
) {
    let environment = ProcessInfo.processInfo.environment
    let startupNotice = OnceFlag()

    // ---------- Preferences ----------

    // null means "nothing stored yet": the UI fills in its own defaults
    bridge.register("getPrefs") { _ in
        settings.prefs
    }

    // Only the items that differ from the defaults (storedPrefs in prefs.ts) arrive; they are stored as they are. When the write does not
    // reach the disk this fails, and the UI says so (app.prefs.saveFailed); Settings has logged the reason
    bridge.register("setPrefs") { params in
        guard let p = params as? [String: Any], let prefs = p["prefs"] else { throw BridgeError("Missing argument: prefs") }
        if !settings.update({ $0.prefs = prefs as? [String: Any] }) {
            throw BridgeError("Settings not written: \(settings.storePath)")
        }
        return nil
    }

    // ---------- Library ----------

    bridge.register("library") { _ in
        libraryState(settings: settings, pending: pending())
    }

    bridge.register("libraryAdd") { params in
        addReply(Library.add(settings, paths: stringList(params, "paths")))
    }

    bridge.register("libraryRemove") { params in
        let isRemoved = Library.contains(stringList(params, "paths"))
        return Library.remove(settings, where: { isRemoved($0.path) })
    }

    bridge.register("libraryRelocate") { params in
        let from = try requiredString(params, "from")
        let to = try requiredString(params, "to")
        let moved: Library.Relocation
        do {
            moved = try Library.relocate(settings, from: from, to: to)
        } catch let error as LibraryError {
            throw bridgeError(error)
        }
        // No page reload is needed on the Mac: media is served through one URL scheme, not one virtual host per drive
        return ["to": moved.to, "reloading": false] as [String: Any]
    }

    bridge.register("libraryPin") { params in
        guard let p = params as? [String: Any], let pinned = jsonBool(p["pinned"]) else { throw BridgeError("Missing argument: pinned") }
        do {
            try Library.pin(settings, paths: stringList(params, "paths"), pinned: pinned)
        } catch let error as LibraryError {
            throw bridgeError(error)
        }
        return nil
    }

    bridge.register("libraryExpanded") { params in
        let paths = stringList(params, "paths")
        settings.update { $0.expanded = paths }
        return nil
    }

    bridge.register("libraryCollapsed") { params in
        let paths = stringList(params, "paths")
        settings.update { $0.collapsed = paths }
        return nil
    }

    bridge.register("librarySelect") { params in
        guard let p = params as? [String: Any], let value = p["path"] else { throw BridgeError("Missing argument: path") }
        let path = value as? String
        settings.update { $0.selected = path }
        return nil
    }

    // ---------- Dialogs ----------

    bridge.register("pickFiles") { _ in
        let urls = onMain { () -> [URL] in
            let panel = NSOpenPanel()
            panel.message = ShellText.t("shell.dialog.addFiles")
            panel.canChooseFiles = true
            panel.canChooseDirectories = false
            panel.allowsMultipleSelection = true
            let types = MaterialKinds.extensions.compactMap { UTType(filenameExtension: String($0.dropFirst())) }
            if !types.isEmpty { panel.allowedContentTypes = types }
            return panel.runModal() == .OK ? panel.urls : []
        }
        return urls.map { $0.path }
    }

    // The UI passes its own title when asking where screenshots are stored (Settings > Screen Capture)
    bridge.register("pickFolder") { params in
        var message = ShellText.t("shell.dialog.addFolder")
        if let title = (params as? [String: Any])?["title"] as? String, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            message = title
        }
        let chosen = onMain { () -> String? in
            let panel = NSOpenPanel()
            panel.message = message
            panel.canChooseFiles = false
            panel.canChooseDirectories = true
            panel.canCreateDirectories = true
            panel.allowsMultipleSelection = false
            return panel.runModal() == .OK ? panel.url?.path : nil
        }
        if let path = chosen { return path }
        return nil
    }

    // ---------- About this app ----------

    bridge.register("appInfo") { _ in
        let version = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
        // The notice is handed out once: not repeated when the page reloads
        let notice = startupNotice.take() ? settings.startupNotice : nil
        return [
            // The UI marks the version in red when it differs from the one it was built with (root package.json)
            "version": version ?? environment["SNIPTOSS_VERSION"] ?? "0.0.0",
            "built": environment["SNIPTOSS_BUILT"] ?? "",
            "startupNotice": jsonOrNull(notice),
            "renamedFromPizhu": false,
            "logDir": AppPaths.logDir,
            "pastedDir": AppPaths.pastedDir,
            "portable": false,
            "systemLanguage": Foundation.Locale.preferredLanguages.first ?? "en-US",
            "dotnet": "",
            "webview2": "",
            "os": osDescription(),
            "exe": Bundle.main.executablePath ?? "",
            "settingsPath": AppPaths.settingsFile,
            "userName": NSUserName(),
            "platform": "mac",
        ] as [String: Any]
    }
}

// MARK: - Helpers

/// True the first time `take` is called, false afterwards
private final class OnceFlag {
    private let lock = NSLock()
    private var taken = false

    func take() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if taken { return false }
        taken = true
        return true
    }
}

/// "macOS 14.5.0 (arm64)": used in diagnostic information
private func osDescription() -> String {
    let v = ProcessInfo.processInfo.operatingSystemVersion
    #if arch(arm64)
        let architecture = "arm64"
    #elseif arch(x86_64)
        let architecture = "x64"
    #else
        let architecture = "unknown"
    #endif
    return "macOS \(v.majorVersion).\(v.minorVersion).\(v.patchVersion) (\(architecture))"
}

private func requiredString(_ params: Any?, _ name: String) throws -> String {
    guard let p = params as? [String: Any], let value = p[name] as? String else { throw BridgeError("Missing argument: \(name)") }
    return value
}

/// A list of non-empty strings; a missing key or anything that is not a list gives an empty list
private func stringList(_ params: Any?, _ name: String) -> [String] {
    guard let p = params as? [String: Any], let items = p[name] as? [Any] else { return [] }
    return items.compactMap { $0 as? String }.filter { !$0.isEmpty }
}

private func bridgeError(_ error: LibraryError) -> BridgeError {
    switch error {
    case .invalidPath(let path): return BridgeError(ShellText.t("shell.add.invalid", ["path": path]))
    case .notFound(let path): return BridgeError("Not found: \(path)", code: "notFound")
    case .insideDataDir(let path): return BridgeError("Inside \(DataDir.name): \(path)")
    case .notInLibrary(let path):
        if let path = path { return BridgeError("Not in the list: \(path)") }
        return BridgeError(ShellText.t("shell.error.notInList"))
    }
}

/// The reply of `libraryAdd`, `addDropped` and `pasteClipboard`. `pasted` is the file an image from the clipboard was saved as
func addReply(_ result: Library.AddResult, pasted: String? = nil) -> [String: Any] {
    [
        "added": result.added,
        "focus": jsonOrNull(result.focus),
        "skipped": result.skipped,
        "relocated": result.relocated.map { ["from": $0.from, "to": $0.to] },
        // No page reload is needed on the Mac (see libraryRelocate)
        "reloading": false,
        "pasted": jsonOrNull(pasted),
    ]
}

/// The reply of `library`. Whether each entry still exists is checked here, on the bridge's background queue; an entry on a volume that is
/// not mounted, or has not answered within a moment, is "missing" and marked `offline` (it was not deleted, and comes back with the volume).
/// An entry on such a volume is never asked about directly: that would wait for the system timeout
private func libraryState(settings: Settings, pending: (focus: String?, skipped: [String], relocated: [Library.Relocation])) -> [String: Any] {
    let values = settings.current
    Volumes.wait(values.library.map { $0.path })
    let entries: [[String: Any]] = values.library.map { entry in
        let there = Volumes.known(entry.path) == true
        var kind = "missing"
        if there {
            if Library.isDirectory(entry.path) {
                kind = "folder"
            } else if Library.isFile(entry.path) {
                kind = "file"
            }
        }
        return ["path": entry.path, "pinned": entry.pinned, "kind": kind, "offline": kind == "missing" && !there]
    }
    return [
        "entries": entries,
        "expanded": values.expanded,
        "collapsed": values.collapsed,
        "selected": jsonOrNull(values.selected),
        "focus": jsonOrNull(pending.focus),
        "skipped": pending.skipped,
        "relocated": pending.relocated.map { ["from": $0.from, "to": $0.to] },
    ]
}
