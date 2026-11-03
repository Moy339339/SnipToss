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
            return "To capture the screen, turn on \(arg("app")) in System Settings → Privacy & Security → Screen & System Audio Recording"
                + " (Screen Recording on macOS 14), then quit \(arg("app")) and open it again. If \(arg("app")) isn't in the list, click + to add it."
        case "shell.capture.openSettings": return "Open System Settings"
        case "shell.capture.notNow": return "Not Now"
        case "shell.move.title": return "Move \(arg("app")) to the Applications folder"
        case "shell.move.why":
            return arg("where") == "diskImage"
                ? "\(arg("app")) was opened directly from the disk image, so it can't be opened once the disk image is ejected."
                : "\(arg("app")) was opened directly from Downloads or the disk image. When it's opened this way, macOS treats it as"
                    + " being in a new location every time, so the system's screen capture confirmation keeps coming up."
        case "shell.move.steps": return "After quitting, drag \(arg("app")) to the Applications folder and open it from there from now on."
        case "shell.move.quit": return "Quit and Open Applications"
        case "shell.move.notNow": return "Not Now"
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
        case "shell.dialog.exportDiagnostics": return "Export Diagnostics Package"
        case "shell.autostart.needsApproval":
            return "To open \(arg("app")) at login, turn it on in System Settings → General → Login Items."
        case "shell.autostart.failed": return "Couldn't change whether \(arg("app")) opens at login: \(arg("reason"))"
        case "shell.notFound": return "File or folder not found: \(arg("path"))"
        case "shell.add.invalid": return "Invalid path: \(arg("path"))"
        case "shell.add.dataDir": return "This is part of the note data (inside \(arg("dir"))) and can't be added: \(arg("path"))"
        case "shell.add.type": return "Unsupported file type (\(arg("ext"))): \(arg("name"))"
        case "shell.error.notInList": return "This item isn't in the library"
        case "shell.tray.capture": return "Capture Screen"
        case "shell.tray.open": return "Open \(arg("app"))"
        case "shell.tray.needsAccess": return "Allow screen recording in System Settings first"
        case "shell.tray.updateTip": return "A new version is available: \(arg("version"))"
        case "shell.tray.updateDownload": return "Download \(arg("version"))…"
        case "shell.tray.updateSkip": return "Skip This Version"
        case "shell.tray.hotkeyFailed": return "The capture shortcut couldn't be enabled"
        case "shell.tray.hotkeyFailedBody": return "\(arg("reason")). Click here to open Settings."
        case "app.toast.close": return "Close"
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
