import AppKit
import Foundation

// The menu bar the page asks for (docs/host-api.md, "Menus"): the page sends what its menus say (`setMenus`), the shell draws them as an
// NSMenu at the top of the screen, and a chosen item goes back as the event `menuCommand { id, version }`. This file has the model, the rules
// for keys and for what a chosen item does (plain functions, tested without a window) and the controller that keeps the NSMenu in step.

// MARK: The model

/// A shortcut as the page writes it: `cmd` is the Command key (the "Ctrl" of the page's key names)
struct NativeShortcut: Equatable {
    let key: String
    let cmd: Bool
    let alt: Bool
    let shift: Bool
}

/// One choice of a row of choices (mark color)
struct NativeSwatch: Equatable {
    let id: String
    let label: String
    let color: String
    let key: String?
    let checked: Bool
}

/// Undo and redo are the two items whose meaning depends on where the caret is (see `MenuPolicy`)
enum NativeRole: String {
    case undo
    case redo
}

struct NativeItem: Equatable {
    let id: String
    let label: String
    /// The hover explanation
    let title: String?
    let disabled: Bool
    let checked: Bool
    let shortcut: NativeShortcut?
    /// Text the item shows on its right that is not one shortcut ("3 checked"): added to the title
    let hintText: String?
    let role: NativeRole?
    /// A row of choices: the item opens them as a submenu and does nothing itself
    let swatches: [NativeSwatch]?
}

enum NativeEntry: Equatable {
    case separator
    case item(NativeItem)
}

struct NativeMenu: Equatable {
    let label: String
    let entries: [NativeEntry]
}

/// What `setMenus` carries
struct MenusMessage: Equatable {
    /// Counts up with every model that differs from the one before; `menuCommand` brings it back
    let version: Int
    /// A dialog is open: everything the page gave the menu bar is greyed out
    let modal: Bool
    let menus: [NativeMenu]
}

extension MenusMessage {
    /// Reads the decoded JSON of a `setMenus` call. Anything that is not the shape of the contract is refused as a whole, so a half-read
    /// menu bar never reaches the screen
    static func parse(_ params: Any?) throws -> MenusMessage {
        guard let p = params as? [String: Any], let version = p["version"] as? Int, let menus = p["menus"] as? [Any] else {
            throw BridgeError("setMenus: version and menus are required")
        }
        let modal = p["modal"] as? Bool ?? false
        return MenusMessage(version: version, modal: modal, menus: try menus.map(parseMenu))
    }

    private static func parseMenu(_ any: Any) throws -> NativeMenu {
        guard let d = any as? [String: Any], let label = d["label"] as? String, let items = d["items"] as? [Any] else {
            throw BridgeError("setMenus: a menu needs a label and items")
        }
        return NativeMenu(label: label, entries: try items.map(parseEntry))
    }

    private static func parseEntry(_ any: Any) throws -> NativeEntry {
        if let text = any as? String {
            guard text == "-" else { throw BridgeError("setMenus: unknown entry \(text)") }
            return .separator
        }
        guard let d = any as? [String: Any], let id = d["id"] as? String, let label = d["label"] as? String else {
            throw BridgeError("setMenus: an item needs an id and a label")
        }
        let swatches = try (d["swatches"] as? [Any])?.map(parseSwatch)
        return .item(
            NativeItem(
                id: id, label: label, title: d["title"] as? String, disabled: d["disabled"] as? Bool ?? false,
                checked: d["checked"] as? Bool ?? false, shortcut: parseShortcut(d["shortcut"]), hintText: d["hintText"] as? String,
                role: (d["role"] as? String).flatMap(NativeRole.init(rawValue:)), swatches: swatches))
    }

    private static func parseShortcut(_ any: Any?) -> NativeShortcut? {
        guard let d = any as? [String: Any], let key = d["key"] as? String, !key.isEmpty else { return nil }
        return NativeShortcut(key: key, cmd: d["cmd"] as? Bool ?? false, alt: d["alt"] as? Bool ?? false, shift: d["shift"] as? Bool ?? false)
    }

    private static func parseSwatch(_ any: Any) throws -> NativeSwatch {
        guard let d = any as? [String: Any], let id = d["id"] as? String, let label = d["label"] as? String, let color = d["color"] as? String
        else { throw BridgeError("setMenus: a swatch needs an id, a label and a color") }
        return NativeSwatch(id: id, label: label, color: color, key: d["key"] as? String, checked: d["checked"] as? Bool ?? false)
    }
}

// MARK: Keys

/// Which shortcuts become the item's real key equivalent, and how the others are written
///
/// A real key equivalent is taken by the menu before a key reaches a text box, so one without Command can swallow a letter the user is
/// typing: the page's "N" (whole-image note) would eat every n typed into a note. Only shortcuts that cannot be typed are registered: those with
/// Command, and the function keys. The rest are drawn after the title, as the page's Windows menus draw them on the right. Whether plain
/// keys are safe to register is asked of the real thing by the key experiment of the smoke run (KeyExperiment.swift); this one function is
/// where the answer goes
enum MenuKeys {
    /// Command + these keys belong to the standard Edit items (Cut, Copy, Paste, Select All), which must win in a text box. The page's own
    /// items with the same keys ("Add from Clipboard" is ⌘V) are only drawn, and the page still handles those keys itself in front of the page
    private static let reserved: Set<String> = ["x", "c", "v", "a"]

    static func registers(_ s: NativeShortcut) -> Bool {
        guard keyEquivalent(s.key) != nil else { return false }
        if functionKeyNumber(s.key) != nil { return true }
        guard s.cmd else { return false }
        return !(s.cmd && !s.alt && !s.shift && reserved.contains(s.key))
    }

    /// The `keyEquivalent` string for a key name as the page writes it (a lower case letter or digit, a mark, ArrowUp, Enter, F5 ...)
    static func keyEquivalent(_ key: String) -> String? {
        switch key {
        case "ArrowUp": return functionKey(0xF700)
        case "ArrowDown": return functionKey(0xF701)
        case "ArrowLeft": return functionKey(0xF702)
        case "ArrowRight": return functionKey(0xF703)
        case "Delete": return functionKey(0xF728)
        case "Home": return functionKey(0xF729)
        case "End": return functionKey(0xF72B)
        case "PageUp": return functionKey(0xF72C)
        case "PageDown": return functionKey(0xF72D)
        case "Backspace": return "\u{8}"
        case "Enter": return "\r"
        case "Escape": return "\u{1B}"
        case "Space": return " "
        default: break
        }
        if let n = functionKeyNumber(key) { return functionKey(0xF703 + n) }
        return key.count == 1 ? key.lowercased() : nil
    }

    /// 1...35 for F1...F35, nil for anything else
    static func functionKeyNumber(_ key: String) -> Int? {
        guard key.count >= 2, key.first == "F", let n = Int(key.dropFirst()), (1...35).contains(n) else { return nil }
        return n
    }

    private static func functionKey(_ code: Int) -> String {
        guard let scalar = UnicodeScalar(UInt32(code)) else { return " " }
        return String(Character(scalar))
    }

    static func modifierMask(_ s: NativeShortcut) -> NSEvent.ModifierFlags {
        var mask: NSEvent.ModifierFlags = []
        if s.cmd { mask.insert(.command) }
        if s.alt { mask.insert(.option) }
        if s.shift { mask.insert(.shift) }
        return mask
    }

    /// The shortcut as the Mac writes it, modifiers in the order ⌥ ⇧ ⌘ and no space before the key ("⇧⌘A", "⌥⌘B", "N", "[")
    static func text(_ s: NativeShortcut) -> String {
        var out = ""
        if s.alt { out += "⌥" }
        if s.shift { out += "⇧" }
        if s.cmd { out += "⌘" }
        return out + glyph(s.key)
    }

    private static func glyph(_ key: String) -> String {
        switch key {
        case "ArrowUp": return "↑"
        case "ArrowDown": return "↓"
        case "ArrowLeft": return "←"
        case "ArrowRight": return "→"
        case "Enter": return "↩"
        case "Escape": return "⎋"
        case "Delete": return "⌦"
        case "Backspace": return "⌫"
        default: return key.count == 1 ? key.uppercased() : key
        }
    }
}

// MARK: What a chosen item does

enum MenuChoice: Equatable {
    /// Tell the page (`menuCommand`)
    case send
    /// Do nothing
    case ignore
    /// Hand it to the web view's own undo / redo (the text box that has the caret)
    case textUndo
    case textRedo
}

enum MenuPolicy {
    /// An item chosen with a key reaches the menu only after the page has seen that key and let it go (it is typing in a text box, or a
    /// dialog took the key): the page already declined it, so it must not run now, or every ⌘ key typed in a note would also run a command.
    /// Undo and redo are the exception: with the caret in a text box the key is meant for the text, which only the web view can undo.
    /// An item chosen with the mouse is always the page's to run (it looks at the focus itself for undo and redo)
    static func choice(byKey: Bool, role: NativeRole?) -> MenuChoice {
        guard byKey else { return .send }
        switch role {
        case .undo: return .textUndo
        case .redo: return .textRedo
        case nil: return .ignore
        }
    }
}

// MARK: Colors

enum SwatchImage {
    /// "#rrggbb", "#rgb" or "#rrggbbaa"; anything else is grey
    static func color(_ hex: String) -> NSColor {
        var digits = hex.hasPrefix("#") ? String(hex.dropFirst()) : hex
        if digits.count == 3 { digits = digits.map { "\($0)\($0)" }.joined() }
        guard digits.count == 6 || digits.count == 8, let value = UInt32(digits, radix: 16) else { return .gray }
        let hasAlpha = digits.count == 8
        let r = CGFloat((hasAlpha ? value >> 24 : value >> 16) & 0xFF) / 255
        let g = CGFloat((hasAlpha ? value >> 16 : value >> 8) & 0xFF) / 255
        let b = CGFloat((hasAlpha ? value >> 8 : value) & 0xFF) / 255
        let a = hasAlpha ? CGFloat(value & 0xFF) / 255 : 1
        return NSColor(srgbRed: r, green: g, blue: b, alpha: a)
    }

    /// A filled dot, drawn when the menu is drawn
    static func dot(_ hex: String, diameter: CGFloat = 12) -> NSImage {
        let fill = color(hex)
        let image = NSImage(size: NSSize(width: diameter, height: diameter), flipped: false) { rect in
            fill.setFill()
            NSBezierPath(ovalIn: rect.insetBy(dx: 0.5, dy: 0.5)).fill()
            return true
        }
        image.isTemplate = false
        return image
    }
}

// MARK: The menu bar

/// What an NSMenuItem remembers about the item of the model it was made from
final class MenuTag: NSObject {
    let id: String
    let version: Int
    let role: NativeRole?

    init(id: String, version: Int, role: NativeRole?) {
        self.id = id
        self.version = version
        self.role = role
    }
}

/// Keeps the NSMenu bar in step with the page's menus. Main thread only, except `install` and what it registers
///
/// The bar is `[app menu][the page's menus ...]`. The app menu is the shell's own (About, Settings…, Hide, Quit: MainMenu.swift); the menus before
/// the first `setMenus` (a standard Edit and a Window menu) stand in until the page has sent its own. The second of the page's menus is Edit
/// (File, Edit, View, Annotate, Playback, Window, Help): the standard Cut, Copy, Paste and Select All are added at its end, because without
/// them those keys do nothing in a text box
final class NativeMenus: NSObject {
    /// Position of the Edit menu among the page's menus
    static let editMenuIndex = 1

    /// What stands in the bar for one of the page's menus
    private final class Shown {
        let item: NSMenuItem
        var signature: [Signature] = []
        var items: [NSMenuItem?] = []

        init(item: NSMenuItem) { self.item = item }
    }

    /// The shape of a menu: when it is the same as before only the items change, nothing is rebuilt (a menu that is open keeps its place)
    private enum Signature: Equatable {
        case separator
        case item(swatches: Int)
    }

    private let bar: NSMenu
    private let emit: (String, [String: Any]) -> Void
    private let sendToResponder: (Selector) -> Void
    /// The menus that stood in the bar before the page's came
    private var standIns: [NSMenuItem]
    private var shown: [Shown] = []
    private(set) var version = 0
    private(set) var modal = false

    init(
        bar: NSMenu, emit: @escaping (String, [String: Any]) -> Void,
        sendToResponder: @escaping (Selector) -> Void = { _ = NSApp.sendAction($0, to: nil, from: nil) }
    ) {
        self.bar = bar
        self.emit = emit
        self.sendToResponder = sendToResponder
        self.standIns = Array(bar.items.dropFirst())
        super.init()
    }

    /// `setMenus` runs on a background queue; the menus are only touched on the main thread. Calls can overtake each other, so an older
    /// version never replaces a newer one
    func install(into bridge: BridgeHost) {
        bridge.register("setMenus") { [weak self] params in
            let message = try MenusMessage.parse(params)
            if let menus = self { onMain { menus.apply(message) } }
            return nil
        }
    }

    /// A page is loading: it counts its versions from the start again, and the menus on screen stay until it sends its own
    func pageReloading() {
        version = 0
    }

    func apply(_ message: MenusMessage) {
        guard message.version >= version else { return }
        version = message.version
        modal = message.modal
        for item in standIns where bar.items.contains(where: { $0 === item }) { bar.removeItem(item) }
        standIns = []
        for (index, menu) in message.menus.enumerated() {
            if index == shown.count {
                let item = NSMenuItem()
                let submenu = NSMenu(title: menu.label)
                // Enabled or not is what the page says, not whether an item has an action
                submenu.autoenablesItems = false
                item.submenu = submenu
                item.title = menu.label
                bar.insertItem(item, at: min(1 + shown.count, bar.items.count))
                shown.append(Shown(item: item))
            }
            update(shown[index], with: menu, standardEdit: index == Self.editMenuIndex)
        }
        while shown.count > message.menus.count { bar.removeItem(shown.removeLast().item) }
    }

    // MARK: One menu

    private func update(_ menu: Shown, with model: NativeMenu, standardEdit: Bool) {
        guard let submenu = menu.item.submenu else { return }
        if submenu.title != model.label || menu.item.title != model.label {
            submenu.title = model.label
            menu.item.title = model.label
        }
        let signature = model.entries.map { entry -> Signature in
            switch entry {
            case .separator: return .separator
            case .item(let item): return .item(swatches: item.swatches?.count ?? 0)
            }
        }
        if signature != menu.signature {
            submenu.removeAllItems()
            menu.items = model.entries.map { (entry) -> NSMenuItem? in
                switch entry {
                case .separator: return nil
                case .item(let item): return makeItem(item)
                }
            }
            for (index, entry) in model.entries.enumerated() {
                if case .separator = entry { submenu.addItem(.separator()) } else if let item = menu.items[index] { submenu.addItem(item) }
            }
            if standardEdit { MainMenu.standardEditItems().forEach { submenu.addItem($0) } }
            menu.signature = signature
        }
        for (index, entry) in model.entries.enumerated() {
            if case .item(let item) = entry, let menuItem = menu.items[index] { configure(menuItem, item) }
        }
    }

    private func makeItem(_ item: NativeItem) -> NSMenuItem {
        let menuItem = NSMenuItem(title: item.label, action: nil, keyEquivalent: "")
        if let swatches = item.swatches {
            let choices = NSMenu(title: item.label)
            choices.autoenablesItems = false
            for _ in swatches { choices.addItem(NSMenuItem(title: "", action: #selector(chosen(_:)), keyEquivalent: "")) }
            choices.items.forEach { $0.target = self }
            menuItem.submenu = choices
        } else {
            menuItem.action = #selector(chosen(_:))
            menuItem.target = self
        }
        return menuItem
    }

    /// Whether an item can be chosen. Undo and redo are always on, whatever the page says and while a dialog is open: the page knows only
    /// about the notes, but the caret may be in a text box with something to undo, and a key equivalent that matches a greyed item is taken
    /// by the menu and goes no further, so ⌘Z would stop working in every text box whenever there is no note to undo
    static func isEnabled(_ item: NativeItem, modal: Bool) -> Bool {
        item.role != nil || (!item.disabled && !modal)
    }

    /// Puts what the model says on the item
    private func configure(_ menuItem: NSMenuItem, _ item: NativeItem) {
        menuItem.title = Self.title(of: item)
        menuItem.toolTip = item.title
        menuItem.state = item.checked ? .on : .off
        let enabled = Self.isEnabled(item, modal: modal)
        menuItem.isEnabled = enabled
        menuItem.representedObject = MenuTag(id: item.id, version: version, role: item.role)
        if let s = item.shortcut, MenuKeys.registers(s), let key = MenuKeys.keyEquivalent(s.key) {
            menuItem.keyEquivalent = key
            menuItem.keyEquivalentModifierMask = MenuKeys.modifierMask(s)
        } else {
            menuItem.keyEquivalent = ""
            menuItem.keyEquivalentModifierMask = []
        }
        guard let swatches = item.swatches, let choices = menuItem.submenu else { return }
        for (index, swatch) in swatches.enumerated() where index < choices.items.count {
            let choice = choices.items[index]
            choice.title = swatch.key.map { "\(swatch.label)  \($0)" } ?? swatch.label
            choice.image = SwatchImage.dot(swatch.color)
            choice.state = swatch.checked ? .on : .off
            // A row that is greyed out as a whole has no choice that can be picked
            choice.isEnabled = enabled
            choice.representedObject = MenuTag(id: swatch.id, version: version, role: nil)
        }
    }

    /// The label, then what the item shows besides it that the system cannot draw on the right: a shortcut that is not registered, or a
    /// text such as a count
    static func title(of item: NativeItem) -> String {
        var suffix: String?
        if let s = item.shortcut {
            if !MenuKeys.registers(s) { suffix = MenuKeys.text(s) }
        } else {
            suffix = item.hintText
        }
        return suffix.map { "\(item.label)  \($0)" } ?? item.label
    }

    // MARK: A chosen item

    @objc private func chosen(_ sender: NSMenuItem) {
        choose(sender, byKey: NSApp.currentEvent?.type == .keyDown)
    }

    func choose(_ sender: NSMenuItem, byKey: Bool) {
        guard let tag = sender.representedObject as? MenuTag else { return }
        switch MenuPolicy.choice(byKey: byKey, role: tag.role) {
        case .send: emit("menuCommand", ["id": tag.id, "version": tag.version])
        case .ignore: break
        case .textUndo: sendToResponder(Selector(("undo:")))
        case .textRedo: sendToResponder(Selector(("redo:")))
        }
    }
}

// MARK: Report (smoke run)

enum MenuReport {
    /// What the main menu looks like, for result.json: the titles, how many items carry a key equivalent, and whether the Edit menu has the
    /// four standard items (by their actions, not their titles, which are the page's words)
    static func describe(_ bar: NSMenu?) -> [String: Any] {
        guard let bar else { return ["mainMenu": false] }
        let tops = bar.items.compactMap { $0.submenu }
        let standard = ["cut:", "copy:", "paste:", "selectAll:"]
        var actions = Set<String>()
        var keyed = 0
        func walk(_ menu: NSMenu) {
            for item in menu.items {
                if let action = item.action { actions.insert(NSStringFromSelector(action)) }
                if !item.keyEquivalent.isEmpty { keyed += 1 }
                if let sub = item.submenu { walk(sub) }
            }
        }
        tops.forEach(walk)
        let titles: [String] = tops.map { $0.title }
        let counts: [Int] = tops.map { $0.items.count }
        let present: [String] = standard.filter { actions.contains($0) }
        return ["mainMenu": true, "titles": titles, "itemCounts": counts, "withKeyEquivalent": keyed, "standardEditItems": present]
    }
}
