import AppKit

/// What closing the last window does, by the "keep running in the menu bar" setting (Settings > Screen Capture, `keepInTray`).
/// On: closing hides the window and the app keeps running, with the menu bar item and the Dock icon as the ways back in.
/// Off: closing the last window quits
enum TrayPolicy {
    static func quitsWhenLastWindowCloses(keepInTray: Bool) -> Bool {
        !keepInTray
    }

    /// The menu bar item exists exactly when the app can be running without a window
    static func showsStatusItem(keepInTray: Bool) -> Bool {
        keepInTray
    }
}

/// Capture Screen while the screen may not be recorded, on systems without menu item subtitles (before macOS 14.4): the note goes after
/// the title in brackets, full-width ones in Chinese and Japanese
enum CaptureMenuText {
    static func titleWithNote(_ title: String, _ note: String, language: String) -> String {
        ["zh-CN", "zh-TW", "ja"].contains(language) ? "\(title)（\(note)）" : "\(title) (\(note))"
    }
}

/// The menu bar item: the Mac counterpart of the Windows tray icon. Main thread only.
/// Its menu: Capture Screen (with the capture shortcut on its right, and under it a note while the screen may not be recorded; both read
/// each time the menu opens), Open, Settings…, Quit
final class StatusItemController: NSObject, NSMenuDelegate {
    private let appName: String
    private let onShowWindow: () -> Void
    private let onOpenSettings: () -> Void
    private let onQuit: () -> Void
    private let onCapture: () -> Void
    /// The capture shortcut in use, drawn on the right of Capture Screen
    private let shortcut: () -> HotKeySpec?
    /// Whether the system does not let the app record the screen yet. Capture Screen stays enabled: choosing it leads to the permission
    private let needsAccess: () -> Bool
    private var item: NSStatusItem?

    init(
        appName: String = "SnipToss", showWindow: @escaping () -> Void, openSettings: @escaping () -> Void, quit: @escaping () -> Void,
        capture: @escaping () -> Void = {}, shortcut: @escaping () -> HotKeySpec? = { nil }, needsAccess: @escaping () -> Bool = { false }
    ) {
        self.appName = appName
        self.onShowWindow = showWindow
        self.onOpenSettings = openSettings
        self.onQuit = quit
        self.onCapture = capture
        self.shortcut = shortcut
        self.needsAccess = needsAccess
        super.init()
    }

    /// Adds the item to the menu bar or takes it away; does nothing when it is already so
    func setVisible(_ visible: Bool) {
        if visible {
            if item == nil { item = makeItem() }
        } else if let existing = item {
            NSStatusBar.system.removeStatusItem(existing)
            item = nil
        }
    }

    var isVisible: Bool { item != nil }

    /// The language changed: the menu is made again
    func refreshLanguage() {
        item?.menu = makeMenu()
    }

    private func makeItem() -> NSStatusItem {
        let created = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let button = created.button {
            // A template image takes the color of the menu bar (light, dark, highlighted)
            let image = NSImage(systemSymbolName: "camera.viewfinder", accessibilityDescription: appName)
            image?.isTemplate = true
            button.image = image
            // Without the symbol the item would be an empty gap
            if image == nil { button.title = appName }
            button.toolTip = appName
        }
        created.menu = makeMenu()
        return created
    }

    /// Not private for the tests, which read the menu without putting an item in the menu bar
    func makeMenu() -> NSMenu {
        // The product's name in the language in use (the Chinese name in the Chinese UI)
        let name = ShellText.t("brand.name")
        let menu = NSMenu(title: name)
        // Items are enabled or not as set here, not by whether they have an action
        menu.autoenablesItems = false
        menu.delegate = self
        let capture = menuEntry(ShellText.t("shell.tray.capture"), #selector(captureClicked(_:)))
        showShortcut(on: capture)
        showAccess(on: capture)
        menu.addItem(capture)
        menu.addItem(menuEntry(ShellText.t("shell.tray.open", ["app": name]), #selector(openClicked(_:))))
        menu.addItem(menuEntry(ShellText.t("shell.menu.settings"), #selector(settingsClicked(_:))))
        menu.addItem(.separator())
        menu.addItem(menuEntry(ShellText.t("shell.menu.quit", ["app": name]), #selector(quitClicked(_:))))
        return menu
    }

    /// The shortcut is only drawn: a status item's menu takes no keys while it is closed, and the shortcut itself is the global one
    private func showShortcut(on item: NSMenuItem) {
        let spec = shortcut()
        item.keyEquivalent = spec.flatMap(HotKeyDisplay.keyEquivalent) ?? ""
        item.keyEquivalentModifierMask = item.keyEquivalent.isEmpty ? [] : spec.map(HotKeyDisplay.mask) ?? []
    }

    /// The note under Capture Screen while the screen may not be recorded (a subtitle from macOS 14.4 on, after the title before that)
    private func showAccess(on item: NSMenuItem) {
        let title = ShellText.t("shell.tray.capture")
        let note = needsAccess() ? ShellText.t("shell.tray.needsAccess") : nil
        if #available(macOS 14.4, *) {
            item.title = title
            item.subtitle = note
        } else {
            item.title = note.map { CaptureMenuText.titleWithNote(title, $0, language: ShellLocale.current) } ?? title
        }
    }

    /// The shortcut may have changed in the settings since the menu was made, and the permission in System Settings
    func menuNeedsUpdate(_ menu: NSMenu) {
        if let capture = menu.items.first(where: { $0.action == #selector(captureClicked(_:)) }) {
            showShortcut(on: capture)
            showAccess(on: capture)
        }
    }

    private func menuEntry(_ title: String, _ action: Selector) -> NSMenuItem {
        let menuItem = NSMenuItem(title: title, action: action, keyEquivalent: "")
        menuItem.target = self
        return menuItem
    }

    @objc private func openClicked(_ sender: Any?) { onShowWindow() }

    @objc private func settingsClicked(_ sender: Any?) { onOpenSettings() }

    @objc private func quitClicked(_ sender: Any?) { onQuit() }

    @objc private func captureClicked(_ sender: Any?) { onCapture() }
}
