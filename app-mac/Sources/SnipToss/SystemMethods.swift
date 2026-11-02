import AppKit
import Foundation
import UniformTypeIdentifiers

// The bridge methods that reach out of the app (docs/host-api.md, "Settings, window, miscellaneous"): `reveal` (show in Finder),
// `openExternal` (open an address in the browser) and `exportDiagnostics` (Help > Export Diagnostics Package…).
// What each one does is a plain function that gets the system's side as arguments, so the tests run it without opening anything

// MARK: - reveal

/// What Finder is asked to do for `reveal`
enum RevealAction: Equatable {
    /// A file, or an app: its folder opens with it selected. An app is never opened this way, only shown
    case select(String)
    /// A folder: it opens
    case open(String)
}

/// Where `reveal` may go (docs/host-api.md, hard rule 2): the library, the notes folders a scan handed out, the screenshot folder, the
/// settings file, the log folder and the program. The first three change while the app runs, so they are asked each time
struct RevealTargets {
    var library: () -> [String]
    var homes: () -> [String]
    /// The folder Settings > Screen Capture names, otherwise the default one
    var captureFolder: () -> String
    var settingsFile: String
    var logDir: String
    /// The program on the Mac is the app bundle: `@app` shows it in its folder
    var appBundle: String

    static func current(settings: Settings, homes: NotesHomes) -> RevealTargets {
        RevealTargets(
            library: { settings.library.map { $0.path } }, homes: { homes.all }, captureFolder: { capturesFolder(of: settings.capture) },
            settingsFile: settings.storePath, logDir: Log.directory?.path ?? AppPaths.logDir, appBundle: Bundle.main.bundlePath)
    }

    static func capturesFolder(of capture: CaptureSettings) -> String {
        if let folder = capture.folder?.trimmingCharacters(in: .whitespacesAndNewlines), !folder.isEmpty { return folder }
        return AppPaths.capturesDir
    }
}

enum Reveal {
    /// The path a call asks for, once it is allowed: `@settings`, `@app` and `@logs` stand for the settings file, the app bundle and the log
    /// folder; any other path must be one of the targets or inside one. Refused otherwise (the `denied` class). What comes back is
    /// normalized (`..` resolved), because that is the path the check looked at: Finder must not be handed a spelling that could end up
    /// somewhere else through a link
    static func resolve(_ raw: String, targets: RevealTargets) throws -> String {
        let path: String
        switch raw {
        case "@settings": path = targets.settingsFile
        case "@app": path = targets.appBundle
        case "@logs": path = targets.logDir
        default: path = raw
        }
        let roots = targets.library() + targets.homes() + [targets.captureFolder(), targets.settingsFile, targets.logDir, targets.appBundle]
        guard PathPolicy.isUnder(path, roots: roots) else {
            throw BridgeError("Path is not in the material list or a notes folder: \(path)", code: "denied")
        }
        return (try? Library.norm(path)) ?? path
    }

    /// File or folder, and does it exist. Runs on the bridge's background queue: a path on a network volume that stopped answering is
    /// asked about through `Volumes` (a short wait, then "not found") rather than with a call that waits for the system timeout
    static func action(for path: String) throws -> RevealAction {
        Volumes.wait([path])
        guard Volumes.known(path) == true else { throw notFound(path) }
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory) else { throw notFound(path) }
        return isDirectory.boolValue && !isApp(path) ? .open(path) : .select(path)
    }

    /// An app bundle is a folder, but it is shown, not opened
    static func isApp(_ path: String) -> Bool {
        Library.extensionOf(path).lowercased() == ".app"
    }

    private static func notFound(_ path: String) -> BridgeError {
        BridgeError(ShellText.t("shell.notFound", ["path": path]), code: "notFound")
    }
}

/// `reveal { path }`
func revealReply(_ params: Any?, targets: RevealTargets, show: (RevealAction) -> Void) throws -> Any? {
    guard let raw = (params as? [String: Any])?["path"] as? String else { throw BridgeError("Missing argument: path") }
    let path = try Reveal.resolve(raw, targets: targets)
    let action = try Reveal.action(for: path)
    show(action)
    return nil
}

// MARK: - openExternal

enum ExternalURL {
    /// The address, when it is http or https with a host; nil for anything else (a file, another program's scheme, a script, no host).
    /// Without this check the page could have the system start any program
    static func allowed(_ text: String) -> URL? {
        guard let url = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)), let scheme = url.scheme?.lowercased(),
            scheme == "http" || scheme == "https", let host = url.host, !host.isEmpty
        else { return nil }
        return url
    }
}

/// `openExternal { url }`
func openExternalReply(_ params: Any?, open: (URL) -> Bool) throws -> Any? {
    guard let text = (params as? [String: Any])?["url"] as? String else { throw BridgeError("Missing argument: url") }
    guard let url = ExternalURL.allowed(text) else {
        // The address can be long (a problem report carries the diagnostic info in it): only its start is repeated
        throw BridgeError("Only http and https addresses can be opened: \(text.prefix(100))")
    }
    guard open(url) else { throw BridgeError("The address could not be opened: \(url.host ?? "")") }
    return nil
}

// MARK: - exportDiagnostics

/// `exportDiagnostics { text }`: asks where to save (`choose` gets the default name and returns the path, nil when the user cancelled),
/// writes the package (DiagnosticsPackage.swift), shows it in Finder and returns its path; nil when cancelled
func exportDiagnosticsReply(
    _ params: Any?, settingsFile: String, logDir: String, now: Date = Date(), choose: (String) -> String?, show: (RevealAction) -> Void
) throws -> Any? {
    guard let text = (params as? [String: Any])?["text"] as? String else { throw BridgeError("Missing argument: text") }
    guard let target = choose(DiagnosticsPackage.defaultName(for: now)) else { return nil }
    do {
        try DiagnosticsPackage.write(to: target, diagnostics: text, settingsFile: settingsFile, logDir: logDir, now: now)
    } catch let error as FileOperationError {
        throw bridgeError(error)
    }
    show(.select(target))
    return target
}

// MARK: - The system's side

/// What the methods above do to the system. All three run on the main thread (the install function hops there)
struct SystemServices {
    var show: (RevealAction) -> Void
    var openURL: (URL) -> Bool
    /// The save dialog of the diagnostics package: gets the default file name, returns the chosen path (nil: cancelled)
    var chooseZip: (String) -> String?

    static let system = SystemServices(
        show: { action in
            switch action {
            case .select(let path):
                NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
            case .open(let path):
                // A folder opens in Finder. `open` would start the program a folder like a project package belongs to; this never does
                if !NSWorkspace.shared.selectFile(nil, inFileViewerRootedAtPath: path) {
                    NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path, isDirectory: true)])
                }
            }
        },
        openURL: { url in NSWorkspace.shared.open(url) },
        chooseZip: { name in
            let panel = NSSavePanel()
            panel.message = ShellText.t("shell.dialog.exportDiagnostics")
            panel.nameFieldStringValue = name
            panel.allowedContentTypes = [.zip]
            panel.canCreateDirectories = true
            return panel.runModal() == .OK ? panel.url?.path : nil
        })
}

/// `reveal`, `openExternal` and `exportDiagnostics`. The methods run on the bridge's background queue; the system's calls hop to the main
/// thread (the save dialog waits for the user, which the page allows: host.ts gives `exportDiagnostics` no time limit)
func installSystemMethods(into bridge: BridgeHost, settings: Settings, homes: NotesHomes, services: SystemServices = .system) {
    let targets = RevealTargets.current(settings: settings, homes: homes)
    let showInFinder: (RevealAction) -> Void = { action in runOnMain { services.show(action) } }

    bridge.register("reveal") { params in
        try revealReply(params, targets: targets, show: showInFinder)
    }

    bridge.register("openExternal") { params in
        try openExternalReply(params, open: { url in onMain { services.openURL(url) } })
    }

    bridge.register("exportDiagnostics") { params in
        try exportDiagnosticsReply(
            params, settingsFile: settings.storePath, logDir: targets.logDir, choose: { name in onMain { services.chooseZip(name) } },
            show: showInFinder)
    }
}
