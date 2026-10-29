import AppKit

/// The menu bar the app has before the page's own menus are drawn natively: the app menu, a standard Edit menu and a Window menu.
/// The app menu stays for good; the other two stand in until the page has sent its menus (NativeMenus.swift), which then take their place.
/// The Edit menu is not decoration. Copy, paste, select all, undo and redo inside a text field reach WebKit as actions sent down the
/// responder chain by the standard items of the main menu (`copy:`, `paste:`, ...); without those items the keys do nothing in a text box
/// (the same trap Electron apps fall into when they leave the Edit menu out)
enum MainMenu {
    /// - Parameter edit: false leaves the Edit menu out, to find out what a text box does without it (the smoke run for the key experiment)
    static func build(openSettings: Selector, openAbout: Selector, edit: Bool = true) -> NSMenu {
        let bar = NSMenu()
        bar.addItem(submenu(appMenu(openSettings: openSettings, openAbout: openAbout)))
        if edit { bar.addItem(submenu(editMenu())) }
        let window = windowMenu()
        bar.addItem(submenu(window))
        NSApp.windowsMenu = window
        return bar
    }

    private static func submenu(_ menu: NSMenu) -> NSMenuItem {
        let item = NSMenuItem()
        item.submenu = menu
        return item
    }

    private static func item(
        _ title: String, _ action: Selector?, _ key: String = "", _ modifiers: NSEvent.ModifierFlags = [.command], target: AnyObject? = nil
    ) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.keyEquivalentModifierMask = modifiers
        item.target = target
        return item
    }

    /// About and Settings… open the page's own settings (the About section, as Help → About does on Windows)
    private static func appMenu(openSettings: Selector, openAbout: Selector) -> NSMenu {
        let name = "SnipToss"
        let menu = NSMenu(title: name)
        menu.addItem(item("About \(name)", openAbout, ""))
        menu.addItem(.separator())
        menu.addItem(item("Settings…", openSettings, ","))
        menu.addItem(.separator())
        menu.addItem(item("Hide \(name)", #selector(NSApplication.hide(_:)), "h"))
        menu.addItem(item("Hide Others", #selector(NSApplication.hideOtherApplications(_:)), "h", [.command, .option]))
        menu.addItem(item("Show All", #selector(NSApplication.unhideAllApplications(_:))))
        menu.addItem(.separator())
        menu.addItem(item("Quit \(name)", #selector(NSApplication.terminate(_:)), "q"))
        return menu
    }

    private static func editMenu() -> NSMenu {
        let menu = NSMenu(title: "Edit")
        // Sent to the first responder (target nil): the text box that has the focus, not the app
        menu.addItem(item("Undo", Selector(("undo:")), "z"))
        menu.addItem(item("Redo", Selector(("redo:")), "z", [.command, .shift]))
        standardEditItems().forEach { menu.addItem($0) }
        return menu
    }

    /// A separator, then Cut, Copy, Paste and Select All, sent to the first responder (target nil): the text box that has the caret.
    /// The page's Edit menu has Undo and Redo of its own; these four are what it lacks
    static func standardEditItems() -> [NSMenuItem] {
        [
            .separator(),
            item("Cut", #selector(NSText.cut(_:)), "x"),
            item("Copy", #selector(NSText.copy(_:)), "c"),
            item("Paste", #selector(NSText.paste(_:)), "v"),
            item("Select All", #selector(NSText.selectAll(_:)), "a"),
        ]
    }

    private static func windowMenu() -> NSMenu {
        let menu = NSMenu(title: "Window")
        menu.addItem(item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m"))
        menu.addItem(item("Zoom", #selector(NSWindow.performZoom(_:))))
        menu.addItem(.separator())
        menu.addItem(item("Bring All to Front", #selector(NSApplication.arrangeInFront(_:))))
        return menu
    }
}
