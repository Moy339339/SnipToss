import AppKit
import Foundation

/// The overlay's keys that can be changed in Settings → Keyboard Shortcuts. The settings keep them in the page's prefs as keybindings:
/// command id → key names, only for the changed commands. The ids and default keys here are those of the command table in
/// packages/web/src/commands.ts (commands.test.ts compares the two, and the Windows shell's app/Capture/CaptureKeys.cs); key names are
/// written as the page writes them on the Mac: "R", "Ctrl+Z" (Ctrl is the Command key), "Control+R" (the real Control key), "Shift+1", "?".
/// The keys that cannot be changed (Esc, Return, delete, 1–8, the arrow keys, ⌘C, ⌘W, ⌘.) stay in `OverlayStateMachine.press`
struct CaptureKeys {
    /// The overlay's commands that can be changed, with their default keys
    static let defaults: [(id: String, keys: [String])] = [
        ("capture.rect", ["R"]),
        ("capture.ellipse", ["O"]),
        ("capture.arrow", ["A"]),
        ("capture.pen", ["B"]),
        ("capture.mosaic", ["M"]),
        ("capture.text", ["T"]),
        ("capture.point", ["C"]),
        ("capture.whole", ["N"]),
        ("capture.undo", ["Ctrl+Z"]),
    ]

    private let keys: [String: [String]]

    /// Every command with its default keys (nothing changed)
    static let standard = CaptureKeys.from(nil)

    /// The keys under the changed ones in the settings (prefs.keybindings); a command that is not listed, or not a list of names, keeps
    /// its defaults
    static func from(_ bindings: Any?) -> CaptureKeys {
        let changed = bindings as? [String: Any]
        var map: [String: [String]] = [:]
        for (id, standard) in defaults {
            if let list = changed?[id] as? [Any] {
                map[id] = list.compactMap { $0 as? String }
            } else {
                map[id] = standard
            }
        }
        return CaptureKeys(keys: map)
    }

    /// The command these key names run on the overlay, the first name that has one winning (names as `name(keyCode:mods:characters:)`
    /// gives them); nil when none
    func command(of names: [String]) -> String? {
        for name in names {
            for (id, _) in Self.defaults where keys[id]?.contains(name) == true { return id }
        }
        return nil
    }

    /// A command's first key the way the Mac writes it ("⌘Z", Space and Home in the language's words); "" when it has none
    func hint(_ id: String) -> String {
        guard let first = keys[id]?.first else { return "" }
        return Self.pretty(first)
    }

    /// A toolbar tooltip: the name with the command's key, written the way the language writes it ("Undo (⌘Z)"); the name alone when the
    /// command has no key
    func tip(_ name: String, _ id: String) -> String {
        let key = hint(id)
        return key.isEmpty ? name : ShellText.t("capture.tip.withKey", ["label": name, "key": key])
    }

    /// The parts of a key name: "Ctrl++" → Ctrl, + (splitting at every plus would lose the plus key)
    static func parts(_ name: String) -> [String] {
        if name == "+" { return ["+"] }
        var parts = name.components(separatedBy: "+")
        if name.hasSuffix("++") {
            parts.removeLast(2)
            parts.append("+")
        }
        return parts
    }

    private static let arrows = ["ArrowUp": "↑", "ArrowDown": "↓", "ArrowLeft": "←", "ArrowRight": "→", "Escape": "Esc"]
    /// The modifiers in the order the Mac writes them, with their symbols ("Ctrl" is the Command key, "Control" the Control key)
    private static let modifiers: [(name: String, symbol: String)] = [("Control", "⌃"), ("Alt", "⌥"), ("Shift", "⇧"), ("Ctrl", "⌘")]
    private static let symbols = ["Enter": "↩", "Esc": "⎋", "Delete": "⌦", "Backspace": "⌫"]

    /// A key name the way the Mac writes it, as the page does (keycaps in packages/web/src/hotkey.ts): the modifiers as symbols in the
    /// order ⌃ ⌥ ⇧ ⌘, then the key with no space; Return, Esc and the delete keys as symbols, arrows as arrows, Space, Home and End in
    /// the language's words (keycap.*)
    static func pretty(_ name: String) -> String {
        let parts = Self.parts(name).map { arrows[$0] ?? $0 }
        let mods = modifiers.filter { parts.contains($0.name) }.map { $0.symbol }.joined()
        let key = parts.filter { p in !modifiers.contains { $0.name == p } }.map { word($0) }.joined(separator: " ")
        return mods + key
    }

    private static func word(_ key: String) -> String {
        if let symbol = symbols[key] { return symbol }
        if key == "Space" || key == "Home" || key == "End" { return ShellText.t("keycap.\(key)") }
        return key
    }

    // MARK: A key press as the page names it

    /// Keys named by what they are rather than what they type (the web's KeyboardEvent.key for them)
    private static let named: [UInt16: String] = [
        0x31: "Space", 0x24: "Enter", 0x4C: "Enter", 0x35: "Escape", 0x30: "Tab", 0x33: "Backspace", 0x75: "Delete",
        0x73: "Home", 0x77: "End", 0x74: "PageUp", 0x79: "PageDown",
        0x7B: "ArrowLeft", 0x7C: "ArrowRight", 0x7E: "ArrowUp", 0x7D: "ArrowDown",
        0x7A: "F1", 0x78: "F2", 0x63: "F3", 0x76: "F4", 0x60: "F5", 0x61: "F6", 0x62: "F7", 0x64: "F8", 0x65: "F9", 0x6D: "F10",
        0x67: "F11", 0x6F: "F12", 0x69: "F13", 0x6B: "F14", 0x71: "F15", 0x6A: "F16", 0x40: "F17", 0x4F: "F18", 0x50: "F19", 0x5A: "F20",
    ]

    /// The main row's digit keys (the codes are not in order)
    private static let digits: [UInt16: String] = [
        0x1D: "0", 0x12: "1", 0x13: "2", 0x14: "3", 0x15: "4", 0x17: "5", 0x16: "6", 0x1A: "7", 0x1C: "8", 0x19: "9",
    ]

    /// The letter keys by their place on a US keyboard (Carbon's kVK_ANSI_* codes)
    private static let letters: [UInt16: String] = [
        0x00: "A", 0x0B: "B", 0x08: "C", 0x02: "D", 0x0E: "E", 0x03: "F", 0x05: "G", 0x04: "H", 0x22: "I", 0x26: "J", 0x28: "K",
        0x25: "L", 0x2E: "M", 0x2D: "N", 0x1F: "O", 0x23: "P", 0x0C: "Q", 0x0F: "R", 0x01: "S", 0x11: "T", 0x20: "U", 0x09: "V",
        0x0D: "W", 0x07: "X", 0x10: "Y", 0x06: "Z",
    ]

    /// A key press as the page names it on the Mac (keyName in packages/web/src/keys.ts), so a key recorded in Settings is the key the
    /// overlay sees: the Command key as Ctrl (or, without it, the Control key as Control), then Alt for Option, then Shift, then the key.
    /// Letters by the character typed on a Latin layout (French AZERTY's A key is A) and by their place on other layouts (a Russian
    /// layout's Ф key is A), always by their place with Option (Option changes what a key types); the main row's digits by their place
    /// ("Shift+1"), unless Command or Control is held without Option and Shift; a symbol by the character it types, Shift included in it
    /// ("?" rather than "Shift+/"); named keys by their web names (ArrowLeft, Escape, Backspace).
    /// characters: what the key types (`typed(_:)`); nil = not a key a shortcut can use
    static func name(keyCode: UInt16, mods: OverlayModifiers, characters: String?) -> String? {
        let command = mods.contains(.command), option = mods.contains(.option), shift = mods.contains(.shift)
        let control = mods.contains(.control)
        var key: String
        var byPosition = false
        if let n = named[keyCode] {
            key = n
        } else if let d = digits[keyCode], shift || option || !(command || control) {
            key = d
            byPosition = true
        } else if option, let l = letters[keyCode] {
            key = l
        } else if let c = characters, c.utf16.count == 1, let scalar = c.unicodeScalars.first, scalar.value >= 0x20, scalar.value != 0x7F,
            !(0xF700...0xF8FF).contains(scalar.value)
        {
            key = c
            // A letter of another script (я, ㅁ) is the Latin letter in its place, so shortcuts still work
            if isLetter(scalar) && !isLatin(scalar) { key = letters[keyCode] ?? c }
        } else if let l = letters[keyCode], characters?.isEmpty ?? true {
            // A key that typed nothing (an event made without characters): its place
            key = l
        } else {
            return nil
        }
        let printable = key.utf16.count == 1
        if printable { key = key.uppercased() }
        var parts: [String] = []
        if command {
            parts.append("Ctrl")
        } else if control {
            parts.append("Control")
        }
        if option { parts.append("Alt") }
        let latinCapital = key.unicodeScalars.contains { $0.value >= 0x41 && $0.value <= 0x5A }
        if shift && (byPosition || !printable || latinCapital) { parts.append("Shift") }
        parts.append(key)
        return parts.joined(separator: "+")
    }

    /// The names a key press can match, tried in order: its own name, and with only Shift held the name without Shift (Shift is about to
    /// make a square or a circle, so the key still picks its tool, unless Shift plus the key is a command of its own; as on Windows)
    static func names(of event: NSEvent) -> [String] {
        let mods = OverlayModifiers(event.modifierFlags)
        var names: [String] = []
        if let name = name(keyCode: event.keyCode, mods: mods, characters: typed(event)) { names.append(name) }
        if mods == [.shift], let plain = name(keyCode: event.keyCode, mods: [], characters: event.characters(byApplyingModifiers: [])) {
            names.append(plain)
        }
        return names
    }

    /// What a key typed, as WebKit takes it for the page's KeyboardEvent.key: the event's characters (Shift and Option applied: Option+/
    /// is ÷), but with Control held the characters without it (Control+Z types a control character)
    static func typed(_ event: NSEvent) -> String? {
        event.modifierFlags.contains(.control) ? event.charactersIgnoringModifiers : event.characters
    }

    /// \p{L}: a letter of any script
    private static func isLetter(_ s: Unicode.Scalar) -> Bool {
        switch s.properties.generalCategory {
        case .uppercaseLetter, .lowercaseLetter, .titlecaseLetter, .modifierLetter, .otherLetter: return true
        default: return false
        }
    }

    /// A letter of the Latin script (\p{Script=Latin} for the letters a keyboard types)
    private static func isLatin(_ s: Unicode.Scalar) -> Bool {
        switch s.value {
        case 0x41...0x5A, 0x61...0x7A, 0xAA, 0xBA, 0xC0...0xD6, 0xD8...0xF6, 0xF8...0x2AF, 0x1D00...0x1D25, 0x1D2C...0x1D5C,
            0x1D62...0x1D65, 0x1D6B...0x1D77, 0x1D79...0x1DBE, 0x1E00...0x1EFF, 0x2071, 0x207F, 0x2090...0x209C, 0x212A, 0x212B,
            0x2132, 0x214E, 0x2160...0x2188, 0x2C60...0x2C7F, 0xA722...0xA787, 0xA78B...0xA7FF, 0xAB30...0xAB5A, 0xAB5C...0xAB64,
            0xFB00...0xFB06, 0xFF21...0xFF3A, 0xFF41...0xFF5A:
            return true
        default:
            return false
        }
    }
}
