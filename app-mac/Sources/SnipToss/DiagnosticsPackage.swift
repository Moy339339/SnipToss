import Foundation

/// The diagnostics package (Help > Export Diagnostics Package…, docs/host-api.md `exportDiagnostics`): a zip to attach to a problem report.
/// The user chooses where it is saved and decides whether to send it; the app uploads nothing. Contents:
/// - `diagnostics.txt`: the diagnostic info the page sends, after `Scrub`
/// - `logs/`: the log files of the last 7 days, as they were written (every line went through `Scrub` when it was logged)
/// - `settings.json`: the settings file without what carries paths or the user's own text (`settingsWithoutPaths`)
/// Nothing else goes in: no computer name or full user name (the system version comes from the page's text, which takes it from
/// `appInfo`), no screenshots (the captures folder is never read).
/// The Windows shell's package has the same files (`DiagnosticsPackage.cs`)
enum DiagnosticsPackage {
    /// Log files older than this are left out
    static let logDays = 7

    /// SnipToss-diagnostics-yyyyMMdd-HHmmss.zip, in local time
    static func defaultName(for date: Date, timeZone: TimeZone = .current) -> String {
        let formatter = DateFormatter()
        formatter.locale = Foundation.Locale(identifier: "en_US_POSIX")
        formatter.timeZone = timeZone
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return "SnipToss-diagnostics-" + formatter.string(from: date) + ".zip"
    }

    /// Writes the package to `zipPath` (replacing a file there). Throws when it cannot be written; a log file that cannot be read is left out
    /// - Parameter home: what `Scrub` takes out of the texts (the user's home folder and name)
    static func write(
        to zipPath: String, diagnostics: String, settingsFile: String, logDir: String, now: Date = Date(),
        home: String = NSHomeDirectory(), user: String = NSUserName()
    ) throws {
        var zip = ZipWriter()
        try zip.add(name: "diagnostics.txt", text: Scrub.text(diagnostics, home: home, user: user), modified: now)
        for log in recentLogs(in: logDir, now: now) {
            try zip.add(name: "logs/" + log.name, data: log.data, modified: log.modified)
        }
        if let settings = settingsWithoutPaths(file: settingsFile, home: home, user: user) {
            try zip.add(name: "settings.json", text: settings, modified: now)
        }
        let archive = try zip.finish()
        try AtomicFile.write(zipPath, archive)
    }

    struct LogFile {
        let name: String
        let data: Data
        let modified: Date
    }

    /// The `.log` files of `dir` changed within the last `logDays` days, by name. Nothing is pruned from the folder (that is the log's business)
    static func recentLogs(in dir: String, now: Date) -> [LogFile] {
        guard let names = try? FileManager.default.contentsOfDirectory(atPath: dir) else { return [] }
        let cutoff = now.addingTimeInterval(-Double(logDays) * 24 * 60 * 60)
        var found: [LogFile] = []
        for name in names.sorted(by: { $0.lowercased() < $1.lowercased() }) where name.lowercased().hasSuffix(".log") {
            let path = dir + "/" + name
            guard let attributes = try? FileManager.default.attributesOfItem(atPath: path),
                (attributes[.type] as? FileAttributeType) == FileAttributeType.typeRegular,
                let modified = attributes[.modificationDate] as? Date, modified >= cutoff
            else { continue }
            guard let data = try? AtomicFile.readAllBytes(path) else {
                Log.info("Diagnostics package: a log file could not be read and was left out: \(name)")
                continue
            }
            found.append(LogFile(name: name, data: data, modified: modified))
        }
        return found
    }

    /// The settings file as text, for people to read, without what carries paths or the user's own words: the library, the expanded and
    /// collapsed folders become a count (`(3 entries)`), the selected item `(set)`, the screenshot folder `(custom)` when one is chosen, the
    /// author name and the text attached to every copy `(set)` when they are not empty, and the library's "new" marks (keyed by item path)
    /// a count. Run through `Scrub` after. Nil when the file cannot be read or is not a JSON object (then it is not included).
    /// Keys are sorted, as `JSONText` writes plain dictionaries
    static func settingsWithoutPaths(file: String, home: String = NSHomeDirectory(), user: String = NSUserName()) -> String? {
        guard let data = try? AtomicFile.readAllBytes(file),
            var root = (try? JSONSerialization.jsonObject(with: AtomicFile.stripBOM(data))) as? [String: Any]
        else {
            Log.info("Diagnostics package: could not read the settings file, leaving it out")
            return nil
        }
        for key in ["Library", "Expanded", "Collapsed"] {
            if let list = root[key] as? [Any] { root[key] = entries(list.count) }
        }
        if let selected = root["Selected"] as? String, !selected.isEmpty { root["Selected"] = "(set)" }
        if var prefs = root["Prefs"] as? [String: Any] {
            for key in ["author", "promptExtra"] {
                if let text = prefs[key] as? String, !text.isEmpty { prefs[key] = "(set)" }
            }
            if let fresh = prefs["fresh"] {
                var summary: [String: Any] = [:]
                if let parts = fresh as? [String: Any] {
                    for (key, value) in parts {
                        if let list = value as? [Any] {
                            summary[key] = entries(list.count)
                        } else if let map = value as? [String: Any] {
                            summary[key] = entries(map.count)
                        } else {
                            summary[key] = "(set)"
                        }
                    }
                    prefs["fresh"] = summary
                } else {
                    prefs["fresh"] = "(set)"
                }
            }
            root["Prefs"] = prefs
        }
        if var capture = root["Capture"] as? [String: Any], let folder = capture["Folder"] as? String, !folder.isEmpty {
            capture["Folder"] = "(custom)"
            root["Capture"] = capture
        }
        return Scrub.text(JSONText.document(root), home: home, user: user)
    }

    private static func entries(_ count: Int) -> String {
        "(\(count) entries)"
    }
}
