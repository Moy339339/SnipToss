import AppKit
import Foundation

/// The keys the capture overlay reacts to. They are told apart by the key's place on the keyboard (its virtual key code), not by the
/// character it types, so a keyboard layout or an input method does not change which key picks which tool
enum OverlayKey: Equatable {
    case a, b, c, m, n, o, r, t, w, z
    case period
    /// A digit on the main row, 1…6
    case digit(Int)
    /// A digit on the keypad, 1…6
    case keypad(Int)
    case left, right, up, down
    /// Return and the keypad's Enter
    case enter
    case escape

    /// 1…6 for the main row's digit keys, nil for any other key
    var mainRowDigit: Int? {
        if case .digit(let n) = self { return n }
        return nil
    }

    /// 1…6 for the keypad's digit keys, nil for any other key
    var keypadDigit: Int? {
        if case .keypad(let n) = self { return n }
        return nil
    }

    /// The key for a virtual key code (Carbon's kVK_ANSI_* values), or nil for a key the overlay does not use (⌘Q among them: it stays with
    /// the system)
    static func from(keyCode: UInt16) -> OverlayKey? {
        switch keyCode {
        case 0x00: return .a
        case 0x0B: return .b
        case 0x08: return .c
        case 0x2E: return .m
        case 0x2D: return .n
        case 0x1F: return .o
        case 0x0F: return .r
        case 0x11: return .t
        case 0x0D: return .w
        case 0x06: return .z
        case 0x2F: return .period
        // The main row's digits (the codes of 5 and 6 are not in order: 5 is 0x17 and 6 is 0x16)
        case 0x12: return .digit(1)
        case 0x13: return .digit(2)
        case 0x14: return .digit(3)
        case 0x15: return .digit(4)
        case 0x17: return .digit(5)
        case 0x16: return .digit(6)
        case 0x53: return .keypad(1)
        case 0x54: return .keypad(2)
        case 0x55: return .keypad(3)
        case 0x56: return .keypad(4)
        case 0x57: return .keypad(5)
        case 0x58: return .keypad(6)
        case 0x7B: return .left
        case 0x7C: return .right
        case 0x7E: return .up
        case 0x7D: return .down
        // Return, keypad Enter
        case 0x24, 0x4C: return .enter
        case 0x35: return .escape
        default: return nil
        }
    }
}

/// The modifier keys held with a key. On the Mac ⌘ plays the part Ctrl has in the Windows shortcuts; the real Control key (⌃) is not used
/// by the overlay and is only kept here so a caller can say it was down
struct OverlayModifiers: OptionSet {
    let rawValue: Int

    init(rawValue: Int) {
        self.rawValue = rawValue
    }

    static let command = OverlayModifiers(rawValue: 1)
    static let option = OverlayModifiers(rawValue: 2)
    static let shift = OverlayModifiers(rawValue: 4)
    static let control = OverlayModifiers(rawValue: 8)

    /// None of ⌘, ⌥ and ⇧ is down (⌃ does not count: the overlay does not use it)
    var isPlain: Bool {
        !contains(.command) && !contains(.option) && !contains(.shift)
    }
}

extension OverlayModifiers {
    /// From the flags of a key event
    init(_ flags: NSEvent.ModifierFlags) {
        var result: OverlayModifiers = []
        if flags.contains(.command) { result.insert(.command) }
        if flags.contains(.option) { result.insert(.option) }
        if flags.contains(.shift) { result.insert(.shift) }
        if flags.contains(.control) { result.insert(.control) }
        self = result
    }
}
