import Foundation

/// One entry in the library on the left: a file or folder the user added. A class on purpose: lists of entries are compared and
/// edited by identity (an entry that is absorbed, moved or pinned is the same object throughout one change)
final class LibraryEntry {
    var path: String
    /// Pinned: sorted first, kept when the library is cleared
    var pinned: Bool

    init(path: String, pinned: Bool = false) {
        self.path = path
        self.pinned = pinned
    }
}

/// The main window's position. Left and Top are NaN until a position was recorded (written as the string "NaN", as the Windows file does)
struct WindowPlacement {
    var left = Double.nan
    var top = Double.nan
    var width = 1360.0
    var height = 860.0
    var maximized = false
}

/// Screen capture settings. Defaults and key names are the Windows shell's; the Mac shell may change a default when it implements capture
struct CaptureSettings {
    var hotkey = "Ctrl+Alt+A"
    var hotkeyCustom = false
    var keepInTray = true
    var trayHintShown = false
    var selectHintDone = false
    var hideWindow = true
    var notesInImage = true
    var folder: String?
    /// Start at login. Mac-only key: the Windows shell asks the registry instead. It is only recorded for now; registering the login item
    /// comes with the packaged app
    var autostart = false
}

/// A settings file that parses as JSON but does not have the expected shape (a wrong type for a key)
struct SettingsFormatError: Error, CustomStringConvertible {
    let detail: String
    var description: String { detail }
}

/// Everything the settings file holds. A value type: `Settings.update` hands one to the change closure to edit
struct SettingsValues {
    /// The library on the left (files and folders the user added). Pinned ones come first
    var library: [LibraryEntry] = []
    /// Folders expanded in the list (absolute paths)
    var expanded: [String] = []
    /// Projects collapsed in the list (project folder = absolute path of the notes folder).
    /// Projects are expanded by default, so the collapsed ones are recorded
    var collapsed: [String] = []
    /// The item selected last time (absolute path); the next open continues from it
    var selected: String?
    var placement = WindowPlacement()
    var topmost = false
    /// The UI's preferences (the settings panel); the structure is defined by packages/web/src/prefs.ts and kept here as is, never interpreted
    var prefs: [String: Any]?
    var capture = CaptureSettings()
    /// When the last automatic update check succeeded (UTC)
    var updatesCheckedAt: Date?
    /// How many one-time migrations this file has been through. A newly created file is already at the latest; a file with no such key counts as 0
    var migrations = 0

    /// A copy that shares no entries with this one (entries are edited in place)
    func cloned() -> SettingsValues {
        var copy = self
        copy.library = library.map { LibraryEntry(path: $0.path, pinned: $0.pinned) }
        return copy
    }
}

// MARK: - Preferences the shell reads itself

/// A few items the shell needs itself; when the UI has never saved them, defaults are used (the same as DEFAULT_PREFS in prefs.ts).
/// A wrong type (a hand-edited file) also falls back to the default
extension SettingsValues {
    private static func text(_ value: Any?) -> String? {
        value as? String
    }

    /// Whether each kind of item is listed by default (same as DEFAULT_PREFS.kinds in prefs.ts): PDF / PPT can't be annotated yet
    private static let defaultKinds: [String: Bool] = ["image": true, "video": true, "pdf": false, "slides": false]

    /// Interface language: a language code, or "system" (follow the system, the default); nil when never chosen
    var language: String? { SettingsValues.text(prefs?["language"]) }

    /// Settings > Advanced > More formats (off by default, only true turns it on)
    var moreFormats: Bool { jsonBool(prefs?["moreFormats"]) ?? false }

    /// Automatic update check (on by default; only false turns it off)
    var updateCheck: Bool { jsonBool(prefs?["updateCheck"]) ?? true }

    /// Text attached every time something is handed to AI (Settings > Copying)
    var promptExtra: String {
        SettingsValues.text(prefs?["promptExtra"])?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    }

    /// The color of note marks (Settings > Annotations). Only #rrggbb is accepted, like the UI
    var markColor: String {
        if let color = SettingsValues.text(prefs?["markColor"]), SettingsValues.isHexColor(color) { return color }
        return "#ff6a3d"
    }

    private static func isHexColor(_ text: String) -> Bool {
        let scalars = Array(text.unicodeScalars)
        guard scalars.count == 7, scalars[0] == "#" else { return false }
        let hex = CharacterSet(charactersIn: "0123456789abcdefABCDEF")
        return scalars.dropFirst().allSatisfy { hex.contains($0) }
    }

    /// Folder names a scan skips, **lower-cased**: look a name up with `name.lowercased()` (names match without regard to case)
    var skipDirs: Set<String> {
        if let list = prefs?["skipDirs"] as? [Any] {
            return Set(list.compactMap { SettingsValues.text($0) }.filter { !$0.isEmpty }.map { $0.lowercased() })
        }
        return Set(MaterialKinds.defaultSkipDirs.map { $0.lowercased() })
    }

    /// Which kinds of items a folder scan lists. A kind the settings do not mention (added later, or missing from an old file) takes its default,
    /// the same as the UI's settings merge. Includes `MaterialKinds.moreKind` when More formats is on
    var enabledKinds: Set<String> {
        let kinds = prefs?["kinds"] as? [String: Any]
        var names = Set(SettingsValues.defaultKinds.keys)
        if let kinds = kinds { names.formUnion(kinds.keys) }
        var on = Set<String>()
        for name in names {
            let chosen = jsonBool(kinds?[name])
            if chosen ?? (SettingsValues.defaultKinds[name] ?? false) { on.insert(name) }
        }
        on.remove(MaterialKinds.moreKind)
        if moreFormats { on.insert(MaterialKinds.moreKind) }
        return on
    }
}

// MARK: - JSON form (the Windows file's keys, names and order)

extension SettingsValues {
    /// The file text: UTF-8, 2-space indent, trailing newline. Keys are the Windows shell's (PascalCase) in its order.
    /// Not written: the read-only properties the Windows serializer happens to emit (SkipDirs, MarkColor, ...);
    /// they are derived from Prefs and nothing reads them
    func jsonDocument() -> String {
        var root = OrderedJSONObject()
        root.set(
            "Library",
            library.map { (entry: LibraryEntry) -> Any in
                var item = OrderedJSONObject()
                item.set("Path", entry.path)
                item.set("Pinned", entry.pinned)
                return item
            })
        root.set("Expanded", expanded)
        root.set("Collapsed", collapsed)
        root.set("Selected", jsonOrNull(selected))

        var place = OrderedJSONObject()
        place.set("Left", SettingsValues.jsonDouble(placement.left))
        place.set("Top", SettingsValues.jsonDouble(placement.top))
        place.set("Width", SettingsValues.jsonDouble(placement.width))
        place.set("Height", SettingsValues.jsonDouble(placement.height))
        place.set("Maximized", placement.maximized)
        root.set("Placement", place)

        root.set("Topmost", topmost)
        root.set("Prefs", jsonOrNull(prefs))

        var cap = OrderedJSONObject()
        cap.set("Hotkey", capture.hotkey)
        cap.set("HotkeyCustom", capture.hotkeyCustom)
        cap.set("KeepInTray", capture.keepInTray)
        cap.set("TrayHintShown", capture.trayHintShown)
        cap.set("SelectHintDone", capture.selectHintDone)
        cap.set("HideWindow", capture.hideWindow)
        cap.set("NotesInImage", capture.notesInImage)
        cap.set("Folder", jsonOrNull(capture.folder))
        cap.set("Autostart", capture.autostart)
        root.set("Capture", cap)

        root.set("UpdatesCheckedAt", jsonOrNull(updatesCheckedAt.map { SettingsValues.formatDate($0) }))
        root.set("Migrations", migrations)
        return JSONText.document(root)
    }

    /// NaN and infinity are not JSON numbers; the Windows file writes them as these strings
    private static func jsonDouble(_ value: Double) -> Any {
        if value.isNaN { return "NaN" }
        if value.isInfinite { return value > 0 ? "Infinity" : "-Infinity" }
        return value
    }

    private static func formatDate(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    private static func parseDate(_ text: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: text) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: text)
    }

    /// Builds the values from a parsed file. A missing or null key takes its default; a key of the wrong type throws (the file is damaged)
    static func decode(_ root: [String: Any]) throws -> SettingsValues {
        var values = SettingsValues()
        if let items = try JSONField.array(root["Library"], "Library") {
            values.library = try items.map { (item: Any) throws -> LibraryEntry in
                guard let object = item as? [String: Any] else { throw SettingsFormatError(detail: "Library: an entry is not an object") }
                let path = try JSONField.string(object["Path"], "Library.Path") ?? ""
                let pinned = try JSONField.bool(object["Pinned"], "Library.Pinned") ?? false
                return LibraryEntry(path: path, pinned: pinned)
            }
        }
        values.expanded = try JSONField.strings(root["Expanded"], "Expanded") ?? []
        values.collapsed = try JSONField.strings(root["Collapsed"], "Collapsed") ?? []
        values.selected = try JSONField.string(root["Selected"], "Selected")
        if let place = try JSONField.object(root["Placement"], "Placement") {
            values.placement.left = try JSONField.double(place["Left"], "Placement.Left") ?? Double.nan
            values.placement.top = try JSONField.double(place["Top"], "Placement.Top") ?? Double.nan
            values.placement.width = try JSONField.double(place["Width"], "Placement.Width") ?? 1360
            values.placement.height = try JSONField.double(place["Height"], "Placement.Height") ?? 860
            values.placement.maximized = try JSONField.bool(place["Maximized"], "Placement.Maximized") ?? false
        }
        values.topmost = try JSONField.bool(root["Topmost"], "Topmost") ?? false
        values.prefs = try JSONField.object(root["Prefs"], "Prefs")
        if let cap = try JSONField.object(root["Capture"], "Capture") {
            let defaults = CaptureSettings()
            values.capture.hotkey = try JSONField.string(cap["Hotkey"], "Capture.Hotkey") ?? defaults.hotkey
            values.capture.hotkeyCustom = try JSONField.bool(cap["HotkeyCustom"], "Capture.HotkeyCustom") ?? defaults.hotkeyCustom
            values.capture.keepInTray = try JSONField.bool(cap["KeepInTray"], "Capture.KeepInTray") ?? defaults.keepInTray
            values.capture.trayHintShown = try JSONField.bool(cap["TrayHintShown"], "Capture.TrayHintShown") ?? defaults.trayHintShown
            values.capture.selectHintDone = try JSONField.bool(cap["SelectHintDone"], "Capture.SelectHintDone") ?? defaults.selectHintDone
            values.capture.hideWindow = try JSONField.bool(cap["HideWindow"], "Capture.HideWindow") ?? defaults.hideWindow
            values.capture.notesInImage = try JSONField.bool(cap["NotesInImage"], "Capture.NotesInImage") ?? defaults.notesInImage
            values.capture.folder = try JSONField.string(cap["Folder"], "Capture.Folder")
            values.capture.autostart = try JSONField.bool(cap["Autostart"], "Capture.Autostart") ?? defaults.autostart
        }
        if let text = root["UpdatesCheckedAt"] as? String { values.updatesCheckedAt = parseDate(text) }
        values.migrations = try JSONField.int(root["Migrations"], "Migrations") ?? 0
        return values
    }
}

/// Typed reads of parsed JSON. nil for a missing or null key; a value of the wrong type throws
private enum JSONField {
    private static func present(_ value: Any?) -> Any? {
        guard let value = value, !(value is NSNull) else { return nil }
        return value
    }

    static func string(_ value: Any?, _ name: String) throws -> String? {
        guard let value = present(value) else { return nil }
        guard let text = value as? String else { throw SettingsFormatError(detail: "\(name) must be a string") }
        return text
    }

    static func bool(_ value: Any?, _ name: String) throws -> Bool? {
        guard let value = present(value) else { return nil }
        guard let flag = jsonBool(value) else { throw SettingsFormatError(detail: "\(name) must be true or false") }
        return flag
    }

    /// A number, or one of the strings the Windows file uses for the values JSON has no number for
    static func double(_ value: Any?, _ name: String) throws -> Double? {
        guard let value = present(value) else { return nil }
        if let text = value as? String {
            switch text {
            case "NaN": return Double.nan
            case "Infinity": return Double.infinity
            case "-Infinity": return -Double.infinity
            default: throw SettingsFormatError(detail: "\(name) must be a number")
            }
        }
        if let number = value as? NSNumber, jsonBool(number) == nil { return number.doubleValue }
        throw SettingsFormatError(detail: "\(name) must be a number")
    }

    static func int(_ value: Any?, _ name: String) throws -> Int? {
        guard let value = present(value) else { return nil }
        if let number = value as? NSNumber, jsonBool(number) == nil { return number.intValue }
        throw SettingsFormatError(detail: "\(name) must be a whole number")
    }

    static func object(_ value: Any?, _ name: String) throws -> [String: Any]? {
        guard let value = present(value) else { return nil }
        guard let object = value as? [String: Any] else { throw SettingsFormatError(detail: "\(name) must be an object") }
        return object
    }

    static func array(_ value: Any?, _ name: String) throws -> [Any]? {
        guard let value = present(value) else { return nil }
        guard let array = value as? [Any] else { throw SettingsFormatError(detail: "\(name) must be a list") }
        return array
    }

    /// A list of strings; null elements are dropped
    static func strings(_ value: Any?, _ name: String) throws -> [String]? {
        guard let items = try array(value, name) else { return nil }
        var result: [String] = []
        for item in items {
            if item is NSNull { continue }
            guard let text = item as? String else { throw SettingsFormatError(detail: "\(name) must be a list of strings") }
            result.append(text)
        }
        return result
    }
}

// MARK: - The settings store

/// The app's own settings: the library, window position, interface preferences, stored in a JSON file (see AppPaths).
/// Read/write rules, from the Windows shell (a failed read once counted as empty settings, and the next write of the library wiped everything):
/// a failed read never overwrites with empty settings; a corrupt file is renamed and kept first, then restored from .bak; every write keeps
/// the previous file as .bak.
/// Thread-safe: bridge methods run concurrently, and every change goes through `update`, one at a time
final class Settings {
    /// Migrations that exist. The Mac shell has no earlier version, so a file it creates starts here and `migrations` never lags behind
    static let latestMigration = 1

    static var location: String { AppPaths.settingsFile }

    /// The file these settings read from and write to (a temporary file in tests)
    let storePath: String

    private let lock = NSRecursiveLock()
    private var values: SettingsValues
    /// The last change did not reach the disk (file in use, no permission): the next change takes the in-memory copy as its base,
    /// otherwise that change would be overwritten by the old content on disk
    private var unsaved = false
    private let noticeKey: String?
    private let noticeReason: String

    private init(values: SettingsValues, storePath: String, noticeKey: String? = nil, noticeReason: String = "") {
        self.values = values
        self.storePath = storePath
        self.noticeKey = noticeKey
        self.noticeReason = noticeReason
    }

    /// A copy of everything, taken under the lock
    var current: SettingsValues {
        lock.lock()
        defer { lock.unlock() }
        return values
    }

    var library: [LibraryEntry] { current.library }
    var expanded: [String] { current.expanded }
    var collapsed: [String] { current.collapsed }
    var selected: String? { current.selected }
    var prefs: [String: Any]? { current.prefs }
    var capture: CaptureSettings { current.capture }
    var migrations: Int { current.migrations }
    var updatesCheckedAt: Date? { current.updatesCheckedAt }

    /// What to tell the user when something went wrong reading the settings at startup (file corrupt, restored from backup); nil if all is well
    var startupNotice: String? {
        guard let key = noticeKey else { return nil }
        return ShellText.t(key, ["reason": noticeReason])
    }

    static func load() -> Settings {
        load(from: location)
    }

    static func load(from path: String) -> Settings {
        let read = tryRead(path)
        if read.status == .ok, let values = read.values { return Settings(values: values, storePath: path) }
        if read.status == .missing {
            // First use. Or the main file is gone but the backup is still there (should not happen, but if it does use the backup)
            let backup = tryRead(path + ".bak")
            if backup.status == .ok, let values = backup.values {
                Log.info("Settings file is missing, restored from backup: \(path)")
                return Settings(values: values, storePath: path, noticeKey: "shell.settings.restored")
            }
            var fresh = SettingsValues()
            fresh.migrations = latestMigration // newly installed: nothing to migrate
            return Settings(values: fresh, storePath: path)
        }

        if read.status == .corrupt {
            let kept = quarantine(path)
            Log.error("Settings file is corrupt, the original was renamed and kept at: \(kept) (\(read.error ?? ""))")
        } else {
            Log.error("Settings file could not be read (maybe held by another program): \(path) (\(read.error ?? ""))")
        }
        // What the user sees says what happened and whether to do anything; the full path and the reason are in the log
        let reason = read.status == .corrupt ? "corrupt" : "busy"
        let backup = tryRead(path + ".bak")
        if backup.status == .ok, let values = backup.values {
            return Settings(values: values, storePath: path, noticeKey: "shell.settings.fromBackup", noticeReason: reason)
        }
        return Settings(values: SettingsValues(), storePath: path, noticeKey: "shell.settings.defaults", noticeReason: reason)
    }

    /// Changes the settings: re-read from disk first, change, then write back. With two processes open at once, each changes only the item
    /// it touched, and neither overwrites the other's changes with a stale copy. If the disk copy can't be read (corrupt, held), the in-memory
    /// copy is the base: empty settings never overwrite. A change that throws is dropped: nothing is written and nothing changes.
    /// Returns whether this write reached the disk: when it didn't, memory is still up to date and it is written at the next change
    /// (the UI uses this to tell the user when changing settings)
    @discardableResult
    func update(_ change: (inout SettingsValues) throws -> Void) rethrows -> Bool {
        lock.lock()
        defer { lock.unlock() }
        let read = Settings.tryRead(storePath)
        var target: SettingsValues
        if read.status == .ok, let onDisk = read.values, !unsaved {
            target = onDisk
        } else if read.status == .ok {
            Log.info("The previous settings weren't saved; writing again with the in-memory copy as the base: \(storePath)")
            target = values.cloned()
        } else {
            if read.status == .corrupt {
                let kept = Settings.quarantine(storePath)
                Log.error(
                    "Settings file is corrupt, the original was renamed and kept at: \(kept); writing back the in-memory settings (\(read.error ?? ""))")
            } else if read.status == .unreadable {
                Log.info("Settings file could not be read, using the in-memory settings as the base: \(storePath) (\(read.error ?? ""))")
            }
            target = values.cloned()
        }
        try change(&target)
        unsaved = !save(target)
        values = target
        return !unsaved
    }

    private func save(_ target: SettingsValues) -> Bool {
        do {
            try AtomicFile.write(storePath, Data(target.jsonDocument().utf8), backup: storePath + ".bak")
            return true
        } catch {
            // Failing to write doesn't affect this session (memory is up to date); the next settings change tries again
            Log.error("Saving settings failed: \(storePath): \(error)")
            return false
        }
    }

    // MARK: Reading a file

    enum ReadStatus { case ok, missing, corrupt, unreadable }

    struct ReadResult {
        let status: ReadStatus
        let values: SettingsValues?
        let error: String?
    }

    static func tryRead(_ path: String) -> ReadResult {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory), !isDirectory.boolValue else {
            return ReadResult(status: .missing, values: nil, error: nil)
        }
        let data: Data
        do {
            data = try AtomicFile.readAllBytes(path)
        } catch let error as FileOperationError {
            if error.isMissing { return ReadResult(status: .missing, values: nil, error: nil) }
            return ReadResult(status: .unreadable, values: nil, error: error.description)
        } catch {
            return ReadResult(status: .unreadable, values: nil, error: "\(error)")
        }
        do {
            let object = try JSONSerialization.jsonObject(with: AtomicFile.stripBOM(data), options: [])
            guard let root = object as? [String: Any] else {
                return ReadResult(status: .corrupt, values: nil, error: "Content is not a JSON object")
            }
            return ReadResult(status: .ok, values: try SettingsValues.decode(root), error: nil)
        } catch {
            return ReadResult(status: .corrupt, values: nil, error: "\(error)")
        }
    }

    /// Renames a corrupt settings file and keeps it (settings.corrupt-TIMESTAMP.json), returning the kept path;
    /// returns the original path if renaming fails
    static func quarantine(_ path: String) -> String {
        let url = URL(fileURLWithPath: path)
        let stem = url.deletingPathExtension().lastPathComponent
        let ext = url.pathExtension
        let formatter = DateFormatter()
        formatter.locale = Foundation.Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss-SSS"
        let stamp = formatter.string(from: Date())
        let name = ext.isEmpty ? "\(stem).corrupt-\(stamp)" : "\(stem).corrupt-\(stamp).\(ext)"
        let kept = url.deletingLastPathComponent().path + "/" + name
        do {
            try FileManager.default.moveItem(atPath: path, toPath: kept)
            return kept
        } catch {
            Log.info("Could not rename the corrupt settings file: \(path) (\(error))")
            return path
        }
    }
}
