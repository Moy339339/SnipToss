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

/// The menu bar item: the Mac counterpart of the Windows tray icon. Main thread only.
/// Its menu: Capture Screen (disabled until screen capture is implemented), Open, Settings…, Quit
final class StatusItemController: NSObject {
    private let appName: String
    private let onShowWindow: () -> Void
    private let onOpenSettings: () -> Void
    private let onQuit: () -> Void
    private var item: NSStatusItem?

    init(
        appName: String = "SnipToss", showWindow: @escaping () -> Void, openSettings: @escaping () -> Void, quit: @escaping () -> Void
    ) {
        self.appName = appName
        self.onShowWindow = showWindow
        self.onOpenSettings = openSettings
        self.onQuit = quit
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

    /// The language changed: the menu says its words again
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

    private func makeMenu() -> NSMenu {
        // The product's name in the language in use (the Chinese name in the Chinese UI)
        let name = ShellText.t("brand.name")
        let menu = NSMenu(title: name)
        // Items are enabled or not as set here, not by whether they have an action
        menu.autoenablesItems = false
        // Screen capture comes with the next stage of the Mac shell
        let capture = NSMenuItem(title: ShellText.t("shell.tray.capture"), action: nil, keyEquivalent: "")
        capture.isEnabled = false
        menu.addItem(capture)
        menu.addItem(menuEntry(ShellText.t("shell.tray.open", ["app": name]), #selector(openClicked(_:))))
        menu.addItem(menuEntry(ShellText.t("shell.menu.settings"), #selector(settingsClicked(_:))))
        menu.addItem(.separator())
        menu.addItem(menuEntry(ShellText.t("shell.menu.quit", ["app": name]), #selector(quitClicked(_:))))
        return menu
    }

    private func menuEntry(_ title: String, _ action: Selector) -> NSMenuItem {
        let menuItem = NSMenuItem(title: title, action: action, keyEquivalent: "")
        menuItem.target = self
        return menuItem
    }

    @objc private func openClicked(_ sender: Any?) { onShowWindow() }

    @objc private func settingsClicked(_ sender: Any?) { onOpenSettings() }

    @objc private func quitClicked(_ sender: Any?) { onQuit() }
}
