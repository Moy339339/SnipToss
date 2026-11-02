import AppKit
import Carbon.HIToolbox
import Foundation

/// The capture shortcut as the page writes it (docs/host-api.md, "The capture shortcut"): the parts joined by `+`, in any order. On the Mac
/// `Control` is the real Control key (⌃), `Ctrl` the Command key (⌘), `Alt` Option (⌥) and `Shift` Shift (⇧); the key is a letter, a digit,
/// `F1`…`F20`, `Space`, `Left` / `Right` / `Up` / `Down`, `Home`, `End`, `PageUp`, `PageDown` or `NumPad0`…`NumPad9`
struct HotKeySpec: Equatable {
    /// The virtual key code of the key (the key's place on the keyboard, not the character it types)
    let keyCode: UInt32
    /// Carbon modifier flags (cmdKey, optionKey, shiftKey, controlKey)
    let modifiers: UInt32
    /// A key that types or moves the caret (letters, digits, Space, arrows, Home / End, page keys, the keypad)
    let typesText: Bool
    let key: String

    static let command: UInt32 = 0x100
    static let shift: UInt32 = 0x200
    static let option: UInt32 = 0x800
    static let control: UInt32 = 0x1000

    /// nil if the text is not a shortcut this shell can register
    static func parse(_ text: String) -> HotKeySpec? {
        var modifiers: UInt32 = 0
        var key: String?
        for part in text.split(separator: "+", omittingEmptySubsequences: false).map({ $0.trimmingCharacters(in: .whitespaces) }) {
            switch part.lowercased() {
            case "control": modifiers |= control
            case "ctrl": modifiers |= command
            case "alt": modifiers |= option
            case "shift": modifiers |= shift
            case "": return nil
            default:
                if key != nil { return nil }
                key = part
            }
        }
        guard let key, let (code, typesText) = keyCode(of: key) else { return nil }
        return HotKeySpec(keyCode: code, modifiers: modifiers, typesText: typesText, key: key.count == 1 ? key.uppercased() : key)
    }

    /// Why a shortcut cannot be a global one, or nil: it needs Command or Control, because a global shortcut with only Option or Shift would
    /// take a character away from every program (Option+A types å). Keys that type nothing (F keys) may go with Option or Shift alone, as on
    /// Windows. The page refuses the same combinations when recording
    var problem: String? {
        if modifiers == 0 { return "no modifier" }
        let enough = modifiers & (HotKeySpec.command | HotKeySpec.control) != 0
        return !enough && typesText ? "needs Command or Control" : nil
    }

    /// The Mac's way to write it: ⌃⌥⇧⌘ and then the key
    var symbols: String {
        var out = ""
        if modifiers & HotKeySpec.control != 0 { out += "⌃" }
        if modifiers & HotKeySpec.option != 0 { out += "⌥" }
        if modifiers & HotKeySpec.shift != 0 { out += "⇧" }
        if modifiers & HotKeySpec.command != 0 { out += "⌘" }
        return out + key
    }

    /// The text of a shortcut for a message: symbols when it can be read, the text as it is when not
    static func pretty(_ text: String) -> String {
        parse(text)?.symbols ?? text
    }

    // MARK: Keys

    private static let letters: [Character: UInt32] = [
        "A": 0x00, "S": 0x01, "D": 0x02, "F": 0x03, "H": 0x04, "G": 0x05, "Z": 0x06, "X": 0x07, "C": 0x08, "V": 0x09, "B": 0x0B,
        "Q": 0x0C, "W": 0x0D, "E": 0x0E, "R": 0x0F, "Y": 0x10, "T": 0x11, "O": 0x1F, "U": 0x20, "I": 0x22, "P": 0x23, "L": 0x25,
        "J": 0x26, "K": 0x28, "N": 0x2D, "M": 0x2E,
    ]
    private static let digits: [Character: UInt32] = [
        "1": 0x12, "2": 0x13, "3": 0x14, "4": 0x15, "6": 0x16, "5": 0x17, "9": 0x19, "7": 0x1A, "8": 0x1C, "0": 0x1D,
    ]
    private static let keypad: [Character: UInt32] = [
        "0": 0x52, "1": 0x53, "2": 0x54, "3": 0x55, "4": 0x56, "5": 0x57, "6": 0x58, "7": 0x59, "8": 0x5B, "9": 0x5C,
    ]
    private static let functionKeys: [Int: UInt32] = [
        1: 0x7A, 2: 0x78, 3: 0x63, 4: 0x76, 5: 0x60, 6: 0x61, 7: 0x62, 8: 0x64, 9: 0x65, 10: 0x6D, 11: 0x67, 12: 0x6F, 13: 0x69, 14: 0x6B,
        15: 0x71, 16: 0x6A, 17: 0x40, 18: 0x4F, 19: 0x50, 20: 0x5A,
    ]
    private static let named: [String: UInt32] = [
        "space": 0x31, "left": 0x7B, "right": 0x7C, "down": 0x7D, "up": 0x7E, "home": 0x73, "end": 0x77, "pageup": 0x74, "pagedown": 0x79,
    ]

    private static func keyCode(of key: String) -> (UInt32, Bool)? {
        if key.count == 1, let c = key.uppercased().first {
            if let code = letters[c] ?? digits[c] { return (code, true) }
            return nil
        }
        let lower = key.lowercased()
        if lower.hasPrefix("numpad"), let c = lower.dropFirst(6).first, lower.count == 7, let code = keypad[c] { return (code, true) }
        if lower.hasPrefix("f"), let n = Int(lower.dropFirst()), let code = functionKeys[n] { return (code, false) }
        if let code = named[lower] { return (code, true) }
        return nil
    }
}

/// A shortcut as a menu draws it on the right of an item
enum HotKeyDisplay {
    static func mask(_ spec: HotKeySpec) -> NSEvent.ModifierFlags {
        var mask: NSEvent.ModifierFlags = []
        if spec.modifiers & HotKeySpec.control != 0 { mask.insert(.control) }
        if spec.modifiers & HotKeySpec.option != 0 { mask.insert(.option) }
        if spec.modifiers & HotKeySpec.shift != 0 { mask.insert(.shift) }
        if spec.modifiers & HotKeySpec.command != 0 { mask.insert(.command) }
        return mask
    }

    /// The key as a menu item's `keyEquivalent` (the shortcut's names are not the page's: `Left`, not `ArrowLeft`)
    static func keyEquivalent(_ spec: HotKeySpec) -> String? {
        let lower = spec.key.lowercased()
        let page: String
        switch lower {
        case "left", "right", "up", "down": page = "Arrow" + lower.prefix(1).uppercased() + String(lower.dropFirst())
        case "home": page = "Home"
        case "end": page = "End"
        case "pageup": page = "PageUp"
        case "pagedown": page = "PageDown"
        case "space": page = "Space"
        default: page = lower.hasPrefix("numpad") ? String(lower.dropFirst(6)) : spec.key.count == 1 ? lower : spec.key.uppercased()
        }
        return MenuKeys.keyEquivalent(page)
    }
}

/// What registers a shortcut with the system (Carbon here, a fake in the tests)
protocol HotKeyBackend: AnyObject {
    /// Called on the main thread when the registered shortcut is pressed
    var onPressed: (() -> Void)? { get set }
    /// Registers it; a handle for `unregister`, or the status the system refused it with
    func register(keyCode: UInt32, modifiers: UInt32) -> Result<UInt32, HotKeyFailure>
    func unregister(_ handle: UInt32)
}

struct HotKeyFailure: Error, Equatable {
    let status: Int32
}

/// What the capture settings need of the global shortcut (a fake in the tests)
protocol HotKeyControl: AnyObject {
    /// Why the shortcut could not be registered, as the page shows it; nil when it is fine
    var error: String? { get set }
    /// Registers the shortcut (nil or empty = none). Returns the message for the user when it cannot be, and then the previous one stays
    func set(_ text: String?) -> String?
    /// Takes the shortcut away while a new one is being recorded, and gives it back
    func pause()
    func resume()
}

/// The global capture shortcut: at most one registered, the previous one kept when a new one cannot be
final class GlobalHotKey: HotKeyControl {
    private let backend: HotKeyBackend
    private(set) var current: String?
    private var handle: UInt32?
    private var paused = false
    var error: String?

    /// - Parameter onPressed: called on the main thread
    init(backend: HotKeyBackend, onPressed: @escaping () -> Void) {
        self.backend = backend
        backend.onPressed = onPressed
    }

    func set(_ text: String?) -> String? {
        guard let text, !text.trimmingCharacters(in: .whitespaces).isEmpty else {
            clear()
            return nil
        }
        guard let spec = HotKeySpec.parse(text), spec.problem == nil else {
            return ShellText.t("shell.hotkey.invalid", ["keys": HotKeySpec.pretty(text)])
        }
        let old = current
        clear()
        switch backend.register(keyCode: spec.keyCode, modifiers: spec.modifiers) {
        case .success(let registered):
            handle = registered
            current = text
            paused = false
            return nil
        case .failure(let failure):
            Log.info("Capture shortcut \(spec.symbols) could not be registered (status \(failure.status))")
            // The one that worked before keeps working
            if let old, let oldSpec = HotKeySpec.parse(old), case .success(let registered) = backend.register(keyCode: oldSpec.keyCode, modifiers: oldSpec.modifiers) {
                handle = registered
                current = old
            }
            return ShellText.t("shell.hotkey.taken", ["keys": spec.symbols])
        }
    }

    func pause() {
        guard !paused else { return }
        paused = true
        if let handle { backend.unregister(handle) }
        handle = nil
    }

    func resume() {
        guard paused else { return }
        paused = false
        guard let current, let spec = HotKeySpec.parse(current) else { return }
        if case .success(let registered) = backend.register(keyCode: spec.keyCode, modifiers: spec.modifiers) { handle = registered }
    }

    private func clear() {
        if let handle { backend.unregister(handle) }
        handle = nil
        current = nil
        paused = false
    }
}

/// Carbon's `RegisterEventHotKey`: needs no permission, works while the app is in the background. Main thread only
final class CarbonHotKeyBackend: HotKeyBackend {
    var onPressed: (() -> Void)?
    private var handler: EventHandlerRef?
    private var references: [UInt32: EventHotKeyRef] = [:]
    private var nextHandle: UInt32 = 1
    private static let signature: OSType = 0x534E_5054  // 'SNPT'

    init() {
        var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
        let status = InstallEventHandler(
            GetApplicationEventTarget(),
            { _, event, userData in
                guard let event, let userData else { return OSStatus(eventNotHandledErr) }
                let backend = Unmanaged<CarbonHotKeyBackend>.fromOpaque(userData).takeUnretainedValue()
                var id = EventHotKeyID()
                let read = GetEventParameter(
                    event, EventParamName(kEventParamDirectObject), EventParamType(typeEventHotKeyID), nil, MemoryLayout<EventHotKeyID>.size,
                    nil, &id)
                guard read == noErr, id.signature == CarbonHotKeyBackend.signature else { return OSStatus(eventNotHandledErr) }
                DispatchQueue.main.async { backend.onPressed?() }
                return noErr
            }, 1, &spec, Unmanaged.passUnretained(self).toOpaque(), &handler)
        if status != noErr { Log.error("The hot key event handler could not be installed (status \(status))") }
    }

    deinit {
        for reference in references.values { UnregisterEventHotKey(reference) }
        if let handler { RemoveEventHandler(handler) }
    }

    func register(keyCode: UInt32, modifiers: UInt32) -> Result<UInt32, HotKeyFailure> {
        let handle = nextHandle
        nextHandle += 1
        var reference: EventHotKeyRef?
        let status = RegisterEventHotKey(
            keyCode, modifiers, EventHotKeyID(signature: Self.signature, id: handle), GetApplicationEventTarget(), 0, &reference)
        guard status == noErr, let reference else { return .failure(HotKeyFailure(status: status)) }
        references[handle] = reference
        return .success(handle)
    }

    func unregister(_ handle: UInt32) {
        if let reference = references.removeValue(forKey: handle) { UnregisterEventHotKey(reference) }
    }
}
