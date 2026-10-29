import Foundation

/// The shell's own user-facing text, by the same keys as i18n/locales (`shell.*`). English only for now: the locale files use ICU
/// MessageFormat (plural / select), which Foundation does not parse, and loading them is a separate piece of work.
/// Every caller already goes through `t`, so adding the real lookup later changes this one function
enum ShellText {
    static func t(_ key: String, _ args: [String: String] = [:]) -> String {
        func arg(_ name: String) -> String { args[name] ?? "" }
        switch key {
        case "shell.dialog.addFiles": return "Add Files"
        case "shell.dialog.addFolder": return "Add Folder"
        case "shell.notFound": return "File or folder not found: \(arg("path"))"
        case "shell.add.invalid": return "Invalid path: \(arg("path"))"
        case "shell.add.dataDir": return "This is part of the note data (inside \(arg("dir"))) and can't be added: \(arg("path"))"
        case "shell.add.type": return "Unsupported file type (\(arg("ext"))): \(arg("name"))"
        case "shell.error.notInList": return "This item isn't in the library"
        case "shell.tray.capture": return "Capture Screen"
        case "shell.tray.open": return "Open \(arg("app"))"
        case "shell.settings.restored": return "The settings file was missing, so it was restored from a backup."
        case "shell.settings.fromBackup": return "\(settingsProblem(arg("reason"))), so the last backup was restored."
        case "shell.settings.defaults":
            return "\(settingsProblem(arg("reason"))), so the default settings are in use. Add your items again."
        default: return key
        }
    }

    /// The `reason` select of the settings messages: "busy" = the file could not be read, anything else = it was damaged
    private static func settingsProblem(_ reason: String) -> String {
        reason == "busy"
            ? "The settings file couldn't be read (another app may be using it)"
            : "The settings file was damaged (it was renamed and kept in the same folder)"
    }
}
