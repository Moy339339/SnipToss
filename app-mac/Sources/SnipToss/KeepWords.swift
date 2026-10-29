import Foundation

/// Keeps words whole when text wraps, the way the main UI does with word-break: keep-all: a Korean word is not broken between its
/// syllables, nor a Japanese katakana word ("クリップボー / ド"). An invisible WORD JOINER goes between the letters of such a word; Chinese,
/// which wraps between any two characters, is left as it is. For drawn text only: the text given to an AI is never changed
enum KeepWords {
    static let wordJoiner = Character(Unicode.Scalar(0x2060)!)

    private static func hangul(_ c: Unicode.Scalar) -> Bool {
        (0xAC00...0xD7A3).contains(c.value) || (0x1100...0x11FF).contains(c.value) || (0x3130...0x318F).contains(c.value)
    }

    /// Katakana, the long vowel mark ー and half-width katakana
    private static func katakana(_ c: Unicode.Scalar) -> Bool {
        (0x30A0...0x30FF).contains(c.value) || (0xFF65...0xFF9F).contains(c.value)
    }

    static func of(_ text: String) -> String {
        let scalars = Array(text.unicodeScalars)
        if !scalars.contains(where: { hangul($0) || katakana($0) }) { return text }
        var out = String.UnicodeScalarView()
        for (i, a) in scalars.enumerated() {
            out.append(a)
            guard i + 1 < scalars.count else { continue }
            let b = scalars[i + 1]
            let letters = CharacterSet.alphanumerics
            if (letters.contains(a) && letters.contains(b) && (hangul(a) || hangul(b))) || (katakana(a) && katakana(b)) {
                out.append(contentsOf: String(wordJoiner).unicodeScalars)
            }
        }
        return String(out)
    }
}
