import Foundation

/// Color helpers shared by the capture overlay, the color picker and the composited image: #rrggbb text, HSV for the picker, and which
/// colors are too light for white text. The same as ColorMath in the Windows shell and isLightMark in packages/core, checked against the
/// same samples (tests/golden/light-colors.json)
enum ColorMath {
    /// "#rrggbb" or "rrggbb" (either case, surrounding spaces ignored); nil for anything else
    static func parse(_ text: String?) -> MarkColor? {
        var t = (text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if t.hasPrefix("#") { t.removeFirst() }
        guard t.count == 6, t.unicodeScalars.allSatisfy({ CharacterSet(charactersIn: "0123456789abcdefABCDEF").contains($0) }),
            let value = Int(t, radix: 16)
        else { return nil }
        return MarkColor(hex: value)
    }

    /// Light enough that white text on it cannot be read (white, very pale custom colors): numbers drawn on it use dark text.
    /// The test is OKLab lightness above 0.9, so the preset yellow (about 0.85) keeps its white number
    static func isLight(_ c: MarkColor) -> Bool { okLightness(c) > 0.9 }

    /// The dark text used on light marks (the window background color of the app)
    static let darkInk = MarkColor(hex: 0x141416)

    /// OKLab lightness L (0–1) of an sRGB color
    static func okLightness(_ c: MarkColor) -> Double {
        func linear(_ v: UInt8) -> Double {
            let x = Double(v) / 255
            return x <= 0.04045 ? x / 12.92 : pow((x + 0.055) / 1.055, 2.4)
        }
        let r = linear(c.r), g = linear(c.g), b = linear(c.b)
        let l = cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
        let m = cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
        let s = cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
        return 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s
    }

    /// Hue 0–360, saturation and value 0–1
    static func hsv(_ c: MarkColor) -> (h: Double, s: Double, v: Double) {
        let r = Double(c.r) / 255, g = Double(c.g) / 255, b = Double(c.b) / 255
        let maxV = max(r, g, b), minV = min(r, g, b)
        let d = maxV - minV
        var h = 0.0
        if d > 0 {
            if maxV == r {
                h = 60 * ((g - b) / d).truncatingRemainder(dividingBy: 6)
            } else if maxV == g {
                h = 60 * ((b - r) / d + 2)
            } else {
                h = 60 * ((r - g) / d + 4)
            }
        }
        if h < 0 { h += 360 }
        return (h, maxV == 0 ? 0 : d / maxV, maxV)
    }

    static func fromHsv(_ hue: Double, _ saturation: Double, _ value: Double) -> MarkColor {
        let h = (hue.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
        let s = min(max(saturation, 0), 1), v = min(max(value, 0), 1)
        let c = v * s
        let x = c * (1 - abs((h / 60).truncatingRemainder(dividingBy: 2) - 1))
        let m = v - c
        let (r, g, b): (Double, Double, Double)
        switch Int(h / 60) {
        case 0: (r, g, b) = (c, x, 0)
        case 1: (r, g, b) = (x, c, 0)
        case 2: (r, g, b) = (0, c, x)
        case 3: (r, g, b) = (0, x, c)
        case 4: (r, g, b) = (x, 0, c)
        default: (r, g, b) = (c, 0, x)
        }
        // Rounded half to even, as Math.Round in the Windows shell: the same spot in the picker gives the same color on both
        func byte(_ t: Double) -> UInt8 { UInt8((min(max(t, 0), 1) * 255).rounded(.toNearestOrEven)) }
        return MarkColor(r: byte(r + m), g: byte(g + m), b: byte(b + m))
    }
}
