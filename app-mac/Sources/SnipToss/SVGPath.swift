import CoreGraphics
import Foundation

/// Path data in the SVG mini-language (WPF's path markup is the same), absolute commands only: M L H V C S Q A Z. The toolbar icons and the
/// tool cursors are written this way, with the same strings as the Windows shell and packages/web/src/icons.tsx. Coordinates are used as
/// they are, so in a view whose y axis points down the shapes come out the way they look in the web UI
enum SVGPath {
    static func parse(_ text: String) -> CGPath {
        let path = CGMutablePath()
        var scanner = PathScanner(Array(text))
        var command: Character?
        var current = CGPoint.zero
        var start = CGPoint.zero
        // The second control point of the last C or S, which an S that follows mirrors
        var control: CGPoint?
        while true {
            if let next = scanner.command() {
                command = next
            } else if !scanner.atNumber {
                break
            }
            // A number with no command before it repeats the last command (after M, the pairs that follow are lines)
            guard let c = command else { break }
            var nextControl: CGPoint?
            switch c {
            case "M":
                guard let p = scanner.point() else { return path }
                path.move(to: p)
                current = p
                start = p
                command = "L"
            case "L":
                guard let p = scanner.point() else { return path }
                path.addLine(to: p)
                current = p
            case "H":
                guard let x = scanner.number() else { return path }
                current = CGPoint(x: x, y: current.y)
                path.addLine(to: current)
            case "V":
                guard let y = scanner.number() else { return path }
                current = CGPoint(x: current.x, y: y)
                path.addLine(to: current)
            case "C":
                guard let c1 = scanner.point(), let c2 = scanner.point(), let p = scanner.point() else { return path }
                path.addCurve(to: p, control1: c1, control2: c2)
                current = p
                nextControl = c2
            case "S":
                guard let c2 = scanner.point(), let p = scanner.point() else { return path }
                let c1 = control.map { CGPoint(x: 2 * current.x - $0.x, y: 2 * current.y - $0.y) } ?? current
                path.addCurve(to: p, control1: c1, control2: c2)
                current = p
                nextControl = c2
            case "Q":
                guard let c1 = scanner.point(), let p = scanner.point() else { return path }
                path.addQuadCurve(to: p, control: c1)
                current = p
            case "A":
                guard let rx = scanner.number(), let ry = scanner.number(), let rotation = scanner.number(), let large = scanner.number(),
                    let sweep = scanner.number(), let p = scanner.point()
                else { return path }
                arc(path, from: current, to: p, rx: rx, ry: ry, degrees: rotation, large: large != 0, sweep: sweep != 0)
                current = p
            case "Z", "z":
                path.closeSubpath()
                current = start
                // Z takes no numbers: what follows must be a command
                command = nil
            default:
                return path
            }
            control = nextControl
        }
        return path
    }

    /// An elliptical arc from `from` to `to` (SVG's endpoint form), turned into the center form and added as Bézier curves. The formulas are
    /// the ones in the SVG specification's implementation notes (F.6.5, F.6.6): radii too small to reach the end point are scaled up
    static func arc(_ path: CGMutablePath, from: CGPoint, to: CGPoint, rx: CGFloat, ry: CGFloat, degrees: CGFloat, large: Bool, sweep: Bool) {
        if from == to { return }
        var rx = abs(rx)
        var ry = abs(ry)
        if rx == 0 || ry == 0 {
            path.addLine(to: to)
            return
        }
        let phi = degrees * .pi / 180
        let cosPhi = cos(phi)
        let sinPhi = sin(phi)
        let dx = (from.x - to.x) / 2
        let dy = (from.y - to.y) / 2
        let x1 = cosPhi * dx + sinPhi * dy
        let y1 = -sinPhi * dx + cosPhi * dy
        let lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
        if lambda > 1 {
            rx *= lambda.squareRoot()
            ry *= lambda.squareRoot()
        }
        let numerator = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
        let denominator = rx * rx * y1 * y1 + ry * ry * x1 * x1
        var coefficient = denominator == 0 ? 0 : max(0, numerator / denominator).squareRoot()
        if large == sweep { coefficient = -coefficient }
        let cx1 = coefficient * rx * y1 / ry
        let cy1 = -coefficient * ry * x1 / rx
        let cx = cosPhi * cx1 - sinPhi * cy1 + (from.x + to.x) / 2
        let cy = sinPhi * cx1 + cosPhi * cy1 + (from.y + to.y) / 2
        func angle(_ ux: CGFloat, _ uy: CGFloat, _ vx: CGFloat, _ vy: CGFloat) -> CGFloat {
            atan2(ux * vy - uy * vx, ux * vx + uy * vy)
        }
        let ux = (x1 - cx1) / rx
        let uy = (y1 - cy1) / ry
        let vx = (-x1 - cx1) / rx
        let vy = (-y1 - cy1) / ry
        let theta = angle(1, 0, ux, uy)
        var delta = angle(ux, uy, vx, vy)
        if !sweep && delta > 0 { delta -= 2 * .pi }
        if sweep && delta < 0 { delta += 2 * .pi }
        // The unit circle, stretched to the radii, turned and moved to the center: points come out as center + R(φ)·(rx cos θ, ry sin θ)
        let transform = CGAffineTransform(translationX: cx, y: cy).rotated(by: phi).scaledBy(x: rx, y: ry)
        path.addRelativeArc(center: .zero, radius: 1, startAngle: theta, delta: delta, transform: transform)
    }

    private struct PathScanner {
        let chars: [Character]
        var i = 0

        init(_ chars: [Character]) { self.chars = chars }

        private static func isDigit(_ c: Character) -> Bool { c >= "0" && c <= "9" }

        private mutating func skipSeparators() {
            while i < chars.count, chars[i] == " " || chars[i] == "," || chars[i] == "\t" || chars[i] == "\n" || chars[i] == "\r" { i += 1 }
        }

        mutating func command() -> Character? {
            skipSeparators()
            guard i < chars.count, chars[i].isASCII, chars[i].isLetter else { return nil }
            defer { i += 1 }
            return chars[i]
        }

        var atNumber: Bool {
            mutating get {
                skipSeparators()
                guard i < chars.count else { return false }
                let c = chars[i]
                return Self.isDigit(c) || c == "-" || c == "+" || c == "."
            }
        }

        mutating func number() -> CGFloat? {
            skipSeparators()
            var text = ""
            if i < chars.count, chars[i] == "-" || chars[i] == "+" {
                text.append(chars[i])
                i += 1
            }
            var dot = false
            while i < chars.count {
                let c = chars[i]
                if Self.isDigit(c) {
                    text.append(c)
                } else if c == "." && !dot {
                    dot = true
                    text.append(c)
                } else {
                    break
                }
                i += 1
            }
            return Double(text).map { CGFloat($0) }
        }

        mutating func point() -> CGPoint? {
            guard let x = number(), let y = number() else { return nil }
            return CGPoint(x: x, y: y)
        }
    }
}
