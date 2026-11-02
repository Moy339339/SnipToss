import Foundation

/// A JSON object whose keys keep the order they were added in (the settings file lists its keys in a fixed order)
struct OrderedJSONObject {
    private(set) var pairs: [(key: String, value: Any)] = []

    mutating func set(_ key: String, _ value: Any) {
        pairs.append((key: key, value: value))
    }
}

/// Writes JSON the way every file the app writes is formatted (docs/host-api.md, hard rule 4): UTF-8, 2-space indent, `"key": value`,
/// a trailing newline. JSONSerialization cannot do this: its pretty printer puts a space before the colon and escapes slashes.
/// Plain dictionaries are written with their keys sorted; use `OrderedJSONObject` where the order matters
enum JSONText {
    static func document(_ value: Any) -> String {
        var out = ""
        write(value, level: 0, into: &out)
        out += "\n"
        return out
    }

    private static func write(_ value: Any, level: Int, into out: inout String) {
        switch value {
        case let object as OrderedJSONObject:
            writeObject(object.pairs, level: level, into: &out)
        case let text as String:
            writeString(text, into: &out)
        case is NSNull:
            out += "null"
        case let dictionary as [String: Any]:
            writeObject(dictionary.sorted { $0.key < $1.key }, level: level, into: &out)
        case let array as [Any]:
            writeArray(array, level: level, into: &out)
        default:
            // A Swift Bool is told apart by its own type: through NSNumber it could not be told from the numbers 0 and 1
            if type(of: value) == Bool.self, let flag = value as? Bool {
                out += flag ? "true" : "false"
            } else if let number = value as? NSNumber {
                writeNumber(number, into: &out)
            } else {
                // Anything JSON cannot hold (a missing value, a date): written as null rather than lost silently
                out += "null"
            }
        }
    }

    private static func writeObject(_ pairs: [(key: String, value: Any)], level: Int, into out: inout String) {
        if pairs.isEmpty {
            out += "{}"
            return
        }
        out += "{\n"
        for (i, pair) in pairs.enumerated() {
            out += indent(level + 1)
            writeString(pair.key, into: &out)
            out += ": "
            write(pair.value, level: level + 1, into: &out)
            out += i < pairs.count - 1 ? ",\n" : "\n"
        }
        out += indent(level) + "}"
    }

    private static func writeArray(_ items: [Any], level: Int, into out: inout String) {
        if items.isEmpty {
            out += "[]"
            return
        }
        out += "[\n"
        for (i, item) in items.enumerated() {
            out += indent(level + 1)
            write(item, level: level + 1, into: &out)
            out += i < items.count - 1 ? ",\n" : "\n"
        }
        out += indent(level) + "]"
    }

    private static func indent(_ level: Int) -> String {
        String(repeating: "  ", count: level)
    }

    private static func writeNumber(_ number: NSNumber, into out: inout String) {
        if CFGetTypeID(number) == CFBooleanGetTypeID() {
            out += number.boolValue ? "true" : "false"
            return
        }
        let type = String(cString: number.objCType)
        if type == "d" || type == "f" {
            let d = number.doubleValue
            if !d.isFinite {
                out += "null"
            } else if d == d.rounded(.towardZero) && abs(d) < 1e15 {
                out += String(Int64(d))
            } else {
                out += "\(d)"
            }
        } else {
            out += String(number.int64Value)
        }
    }

    private static func writeString(_ text: String, into out: inout String) {
        out += "\""
        for scalar in text.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            default:
                if scalar.value < 0x20 {
                    out += String(format: "\\u%04x", scalar.value)
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
        }
        out += "\""
    }
}

/// A JSON boolean and nothing else: a number such as 1 is not a boolean. The Windows shell reads the settings file the same strict way
/// (a hand-edited `"updateCheck": "no"` counts as not set)
func jsonBool(_ value: Any?) -> Bool? {
    guard let value = value else { return nil }
    if type(of: value) == Bool.self { return value as? Bool }
    guard let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() else { return nil }
    return number.boolValue
}

/// The value, or JSON null. A Swift nil put into a dictionary that goes to the page would make the whole reply fail to encode
func jsonOrNull(_ value: Any?) -> Any {
    value ?? NSNull()
}
