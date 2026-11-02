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
/// Its menu: Capture Screen (with the capture shortcut on its right, and under it a note while the screen may not be recorded or the
/// shortcut couldn't be enabled; all read each time the menu opens), Open, Settings…, Quit. While a new version is known (UpdateCenter)
/// the icon has a dot, the hover text names the version, and Download and Skip This Version come first, as on the Windows tray icon
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
    /// Whether the capture shortcut couldn't be registered (Capture Screen from this menu still works)
    private let hotkeyFailed: () -> Bool
    private let onDownload: () -> Void
    private let onSkip: () -> Void
    private var item: NSStatusItem?
    /// The new version shown (nil: none)
    private(set) var update: Updates.Release?

    init(
        appName: String = "SnipToss", showWindow: @escaping () -> Void, openSettings: @escaping () -> Void, quit: @escaping () -> Void,
        capture: @escaping () -> Void = {}, shortcut: @escaping () -> HotKeySpec? = { nil }, needsAccess: @escaping () -> Bool = { false },
        hotkeyFailed: @escaping () -> Bool = { false }, download: @escaping () -> Void = {}, skip: @escaping () -> Void = {}
    ) {
        self.appName = appName
        self.onShowWindow = showWindow
        self.onOpenSettings = openSettings
        self.onQuit = quit
        self.onCapture = capture
        self.shortcut = shortcut
        self.needsAccess = needsAccess
        self.hotkeyFailed = hotkeyFailed
        self.onDownload = download
        self.onSkip = skip
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
        item.map(dress)
    }

    /// A new version to show, or nil when there is none any more: the dot, the hover text and the two menu items
    func showUpdate(_ release: Updates.Release?) {
        update = release
        refreshLanguage()
    }

    /// The icon (with the dot while there is a new version) and the hover text
    private func dress(_ statusItem: NSStatusItem) {
        guard let button = statusItem.button else { return }
        let symbol = NSImage(systemSymbolName: "camera.viewfinder", accessibilityDescription: appName)
        symbol?.isTemplate = true
        button.image = update == nil ? symbol : symbol.map(StatusIcon.withDot)
        // Without the symbol the item would be an empty gap
        if symbol == nil { button.title = appName }
        let tip = update.map { ShellText.t("shell.tray.updateTip", ["version": Updates.label($0.version)]) }
        button.toolTip = tip.map { "\(appName)\n\($0)" } ?? appName
    }

    private func makeItem() -> NSStatusItem {
        let created = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        // A template image takes the color of the menu bar (light, dark, highlighted)
        dress(created)
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
        if let update {
            menu.addItem(menuEntry(ShellText.t("shell.tray.updateDownload", ["version": Updates.label(update.version)]), #selector(downloadClicked(_:))))
            menu.addItem(menuEntry(ShellText.t("shell.tray.updateSkip"), #selector(skipClicked(_:))))
            menu.addItem(.separator())
        }
        let capture = menuEntry(ShellText.t("shell.tray.capture"), #selector(captureClicked(_:)))
        showShortcut(on: capture)
        showNote(on: capture)
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

    /// The note under Capture Screen (a subtitle from macOS 14.4 on, after the title before that): while the screen may not be recorded,
    /// or else while the capture shortcut couldn't be enabled. The permission comes first: without it no capture works, shortcut or not
    private func showNote(on item: NSMenuItem) {
        let title = ShellText.t("shell.tray.capture")
        let note = needsAccess() ? ShellText.t("shell.tray.needsAccess") : hotkeyFailed() ? ShellText.t("shell.tray.hotkeyFailed") : nil
        if #available(macOS 14.4, *) {
            item.title = title
            item.subtitle = note
        } else {
            item.title = note.map { CaptureMenuText.titleWithNote(title, $0, language: ShellLocale.current) } ?? title
        }
    }

    /// The shortcut may have changed in the settings since the menu was made (and with it whether it works), and the permission in System
    /// Settings
    func menuNeedsUpdate(_ menu: NSMenu) {
        if let capture = menu.items.first(where: { $0.action == #selector(captureClicked(_:)) }) {
            showShortcut(on: capture)
            showNote(on: capture)
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

    @objc private func downloadClicked(_ sender: Any?) { onDownload() }

    @objc private func skipClicked(_ sender: Any?) { onSkip() }
}

enum StatusIcon {
    /// The icon with a dot in its bottom-right corner, cut free of the symbol by a thin gap. Still a template image: the dot takes the menu
    /// bar's color like the symbol, so it reads on light and dark menu bars and when highlighted
    static func withDot(_ base: NSImage) -> NSImage {
        let size = base.size
        let image = NSImage(size: size, flipped: false) { rect in
            base.draw(in: rect)
            let d = max(5, size.width * 0.42)
            let dot = NSRect(x: rect.maxX - d, y: rect.minY, width: d, height: d)
            NSGraphicsContext.current?.compositingOperation = .clear
            NSBezierPath(ovalIn: dot.insetBy(dx: -1.5, dy: -1.5)).fill()
            NSGraphicsContext.current?.compositingOperation = .sourceOver
            NSColor.black.setFill()
            NSBezierPath(ovalIn: dot).fill()
            return true
        }
        image.isTemplate = true
        return image
    }
}
