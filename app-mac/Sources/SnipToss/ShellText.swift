import Foundation

/// The shell's own user-facing text, by the same keys as i18n/locales: the message of the current language (ShellLocale), formatted by the
/// same package the UI uses. Without the resources (a run from a source checkout that did not build them) the English below is used
enum ShellText {
    static func t(_ key: String, _ args: [String: String] = [:]) -> String {
        if let text = ShellLocale.text(key, args) { return text }
        func arg(_ name: String) -> String { args[name] ?? "" }
        switch key {
        case "brand.name": return "SnipToss"
        case "shell.capture.noAccessTitle": return "\(arg("app")) needs permission to record the screen"
        case "shell.capture.noAccessBody":
            return "To capture the screen, allow \(arg("app")) in System Settings → Privacy & Security, then quit \(arg("app")) and open it again."
                + " If \(arg("app")) isn't in the list, click + to add it."
        case "shell.capture.openSettings": return "Open System Settings"
        case "shell.capture.notNow": return "Not Now"
        case "shell.hotkey.invalid": return "Unrecognized shortcut: \(arg("keys"))"
        case "shell.hotkey.taken": return "\(arg("keys")) is already used by another app. Choose a different shortcut"
        case "shell.menu.about": return "About \(arg("app"))"
        case "shell.menu.settings": return "Settings…"
        case "shell.menu.hide": return "Hide \(arg("app"))"
        case "shell.menu.hideOthers": return "Hide Others"
        case "shell.menu.showAll": return "Show All"
        case "shell.menu.quit": return "Quit \(arg("app"))"
        case "shell.menu.cut": return "Cut"
        case "shell.menu.copy": return "Copy"
        case "shell.menu.paste": return "Paste"
        case "shell.menu.selectAll": return "Select All"
        case "shell.dialog.addFiles": return "Add Files"
        case "shell.dialog.addFolder": return "Add Folder"
        case "shell.notFound": return "File or folder not found: \(arg("path"))"
        case "shell.add.invalid": return "Invalid path: \(arg("path"))"
        case "shell.add.dataDir": return "This is part of the note data (inside \(arg("dir"))) and can't be added: \(arg("path"))"
        case "shell.add.type": return "Unsupported file type (\(arg("ext"))): \(arg("name"))"
        case "shell.error.notInList": return "This item isn't in the library"
        case "shell.tray.capture": return "Capture Screen"
        case "shell.tray.open": return "Open \(arg("app"))"
        case "shell.tray.needsAccess": return "Allow screen recording in System Settings first"
        case "shell.settings.restored": return "The settings file was missing, so it was restored from a backup."
        case "shell.settings.fromBackup": return "\(settingsProblem(arg("reason"))), so the last backup was restored."
        case "shell.settings.defaults":
            return "\(settingsProblem(arg("reason"))), so the default settings are in use. Add your items again."
        default: return key
        }
    }

    /// The same for messages with numbers: strings and integers go to the formatter as they are (plurals need the integers). There is no
    /// built-in English for these; without the resources the key is returned
    static func t(_ key: String, values: [String: Any]) -> String {
        ShellLocale.text(key, values) ?? key
    }

    /// The `reason` select of the settings messages: "busy" = the file could not be read, anything else = it was damaged
    private static func settingsProblem(_ reason: String) -> String {
        reason == "busy"
            ? "The settings file couldn't be read (another app may be using it)"
            : "The settings file was damaged (it was renamed and kept in the same folder)"
    }
}
