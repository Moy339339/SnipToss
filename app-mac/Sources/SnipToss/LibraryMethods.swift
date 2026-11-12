import AppKit
import Foundation
import UniformTypeIdentifiers
import WebKit

/// What was opened from outside before the UI read the library: the path to locate, what was not added (with reasons), and entries
/// recognized as moved. The `library` reply carries it once (`PendingOpens.take`); the default is an empty queue
typealias PendingOpensProvider = () -> (focus: String?, skipped: [String], relocated: [Library.Relocation])

/// The bridge methods for settings and the library (docs/host-api.md, "Library" and "Settings, window, miscellaneous").
/// `addDropped` is in DropWebView.swift and `pasteClipboard` in ClipboardMethods.swift; both reply with `addReply`. The item being viewed
/// (`librarySelect`) is what ChangeWatch.swift checks every second. `scan`, `missing`, `sha256` and `fileUrl` are in ScanMethods.swift
/// - Parameter homes: the notes folders scans have handed out; `libraryRemove` tidies only those (`tidyLeaving`)
/// - Parameter tidy: removes empty notes folders (`HomeTidy`; the same one the notes methods use). nil: entries leaving the library are not
///   looked at
func installLibraryMethods(
    into bridge: BridgeHost, settings: Settings,
    pending: @escaping PendingOpensProvider = { (focus: nil, skipped: [], relocated: []) }, prefsChanged: @escaping () -> Void = {},
    homes: NotesHomes = NotesHomes(), tidy: HomeTidy? = nil
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
        // The shell's own words follow the UI's language (menus and the tray say them again)
        ShellLocale.use(pref: settings.current.language)
        // The shell reads a few items itself (the automatic update check)
        prefsChanged()
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
        let leaving = settings.library.map { $0.path }.filter(isRemoved)
        let removed = Library.remove(settings, where: { isRemoved($0.path) })
        // An item leaving the library shouldn't leave an empty .sniptoss behind where it lives. In the background: the item may be on a
        // disconnected network volume, where a look takes the system's timeout, and the page is not kept waiting for it
        if let tidy, !leaving.isEmpty {
            DispatchQueue.global(qos: .utility).async { _ = tidyLeaving(leaving, homes: homes, tidy: tidy) }
        }
        return removed
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
        let bundle = Bundle.main.infoDictionary
        // The whole version the UI was built with (SnipTossVersion: 1.0.0-beta.44 for a trial package, package-app.mjs); older packages
        // have only the x.y.z one
        let version = bundle?["SnipTossVersion"] as? String ?? bundle?["CFBundleShortVersionString"] as? String
        // The notice is handed out once: not repeated when the page reloads
        let notice = startupNotice.take() ? settings.startupNotice : nil
        var info: [String: Any] = [
            // The UI marks the version in red when it differs from the one it was built with (root package.json)
            "version": version ?? environment["SNIPTOSS_VERSION"] ?? "0.0.0",
            "built": environment["SNIPTOSS_BUILT"] ?? shellBuildTime(),
            "startupNotice": jsonOrNull(notice),
            "renamedFromPizhu": false,
            "logDir": AppPaths.logDir,
            "pastedDir": AppPaths.pastedDir,
            "portable": false,
            "systemLanguage": Foundation.Locale.preferredLanguages.first ?? "en-US",
            "dotnet": "",
            "webview2": "",
            "webkit": webKitVersion(),
            "os": osDescription(),
            "exe": Bundle.main.executablePath ?? "",
            "settingsPath": AppPaths.settingsFile,
            "userName": NSUserName(),
            "platform": "mac",
        ]
        // The build number of the package: the About page writes the version the Mac way, "1.0.0 (44)"
        if let build = bundle?["CFBundleVersion"] as? String { info["build"] = build }
        return info
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

/// When the program itself was built, as on Windows the time its file was last written: the executable's (signing rewrites it, so for a
/// package it is when the package was made), ISO 8601 in UTC. Kept in the contract (`appInfo.built`); the UI no longer shows it (the
/// About page gives one release date, from the UI's build). "" when the file can't be read
func shellBuildTime() -> String {
    guard let path = Bundle.main.executablePath,
        let written = (try? FileManager.default.attributesOfItem(atPath: path))?[.modificationDate] as? Date
    else { return "" }
    let format = ISO8601DateFormatter()
    format.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return format.string(from: written)
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

/// The version of the system's WebKit, which shows the UI (About page, diagnostic information): the full one ("21624.4.5.11.5"); the short
/// one ("21624") leaves out which update of it is installed. "" when the framework does not say
private func webKitVersion() -> String {
    let info = Bundle(for: WKWebView.self).infoDictionary
    return info?["CFBundleVersion"] as? String ?? info?["CFBundleShortVersionString"] as? String ?? ""
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

/// The notes folders of entries that left the library, tidied (`HomeTidy`) when a scan handed them out: a folder entry's is the notes folder
/// found at or above it (itself when there is none), a file's is an existing .sniptoss above it. Each notes folder once; a folder that holds
/// notes is not touched. Returns what was done, by notes folder
@discardableResult
func tidyLeaving(_ paths: [String], homes: NotesHomes, tidy: HomeTidy) -> [String: HomeTidy.Result] {
    let finder = HomeFinder()
    var done: [String: HomeTidy.Result] = [:]
    for path in paths {
        let home = Library.isDirectory(path) ? finder.folderHome(of: path, outer: path) : finder.existingHome(of: path)
        guard let home, homes.contains(home), done[home] == nil else { continue }
        done[home] = tidy.tidy(home: home)
    }
    return done
}
