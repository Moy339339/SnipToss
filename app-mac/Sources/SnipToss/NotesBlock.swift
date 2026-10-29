import AppKit

/// One note in the notes area: number (0 = no number circle, used for the overall comment), circle color, category, position, original text
struct NoteEntry {
    let number: Int
    let color: MarkColor
    let category: String
    let whereText: String
    let body: String
}

/// The notes area below a screenshot: number circle + a "category · position" line (the category in its color) + the original text, wrapped
/// to the image's width; a closing paragraph may follow (Settings → Copying → Extra instructions). The same layout as the Windows shell's,
/// so a picture copied on either looks the same. `s` is the magnification: the screen's scale for a screenshot
final class NotesBlock {
    private struct Item {
        let number: Int
        let color: MarkColor
        let head: NSAttributedString
        let headHeight: CGFloat
        let body: NSAttributedString
        let bodyHeight: CGFloat
        /// The width the text wraps at
        let width: CGFloat
    }

    private struct Para {
        let text: NSAttributedString
        let height: CGFloat
        let width: CGFloat
    }

    /// The narrowest the notes area gets (narrower, each line would hold only a few characters); a narrower picture is widened to it
    static let minWidth = 420
    /// The gap between two columns
    private static let gutter: CGFloat = 24

    private let items: [Item]
    private let overall: Item?
    private let title: Para?
    private let extra: Para?
    private let s: CGFloat
    /// With two columns, the index of the first note in the right column; with one = items.count
    private let split: Int
    private let columnWidth: CGFloat

    let width: Int
    let height: Int

    /// Split into two columns (many notes would otherwise make the picture grow without limit)
    var twoColumns: Bool { split < items.count }

    private init(items: [Item], overall: Item?, title: Para?, extra: Para?, s: CGFloat, split: Int, columnWidth: CGFloat, width: Int, height: Int) {
        self.items = items
        self.overall = overall
        self.title = title
        self.extra = extra
        self.s = s
        self.split = split
        self.columnWidth = columnWidth
        self.width = width
        self.height = height
    }

    /// The drawn text, one entry a paragraph: the title, each note's "category · position" and original text, the overall comment, the
    /// closing paragraph. With the invisible characters added for wrapping (`keepPairs`, `KeepWords`)
    func texts() -> [String] {
        var all: [String] = []
        if let title { all.append(title.text.string) }
        for i in items + (overall.map { [$0] } ?? []) {
            all.append(i.head.string)
            all.append(i.body.string)
        }
        if let extra { all.append(extra.text.string) }
        return all
    }

    private static let noBreakSpace = Character(Unicode.Scalar(0xA0)!)

    /// Keeps the pairs of a position on one line: a name and its number in "w=100" (a line may break after Chinese and Japanese letters, so a
    /// joiner goes before "="), the letter and number in "y 17%–40%" (the space before a digit becomes a no-break space), and the two ends
    /// of "13%–38%" (a line may break after the dash)
    static func keepPairs(_ text: String) -> String {
        let chars = Array(text)
        var out = ""
        for (i, c) in chars.enumerated() {
            if c == "=" { out.append(KeepWords.wordJoiner) }
            out.append(c == " " && i + 1 < chars.count && chars[i + 1].isASCII && chars[i + 1].isNumber ? noBreakSpace : c)
            if c == "–" { out.append(KeepWords.wordJoiner) }
        }
        return out
    }

    private static let light = NSColor(hex: 0xe8e8ea)
    private static let muted = NSColor(hex: 0x8a8a92)

    /// - Parameter imageHeight: the height of the screenshot above: when one column of notes is taller and the picture is wide enough, the
    ///   notes go into two columns
    static func build(
        entries: [NoteEntry], overall: NoteEntry?, title: String?, extra: String?, imageWidth: Int, s: CGFloat, imageHeight: Int = .max
    ) -> NotesBlock {
        let width = max(imageWidth, Int(ceil(CGFloat(minWidth) * s)))
        let pad = 16 * s
        func laid(_ text: NSAttributedString, _ maxWidth: CGFloat, _ size: CGFloat) -> Para {
            let wrapAt = max(40, maxWidth)
            let style = NSMutableParagraphStyle()
            style.minimumLineHeight = size * s * 1.55
            style.maximumLineHeight = size * s * 1.55
            style.lineBreakMode = .byWordWrapping
            let styled = NSMutableAttributedString(attributedString: text)
            styled.addAttribute(.paragraphStyle, value: style, range: NSRange(location: 0, length: styled.length))
            let box = styled.boundingRect(with: CGSize(width: wrapAt, height: 1_000_000), options: [.usesLineFragmentOrigin])
            return Para(text: styled, height: ceil(box.height), width: wrapAt)
        }
        func para(_ text: String, _ maxWidth: CGFloat, _ color: NSColor, _ size: CGFloat) -> Para {
            laid(NSAttributedString(string: text, attributes: [.font: OverlayStyle.font(size * s), .foregroundColor: color]), maxWidth, size)
        }
        // "Change · Region: … x=100 y=100 w=200 h=100 px": the category in its color and heavier, the position in gray
        func head(_ category: String, _ rest: String, _ textWidth: CGFloat) -> Para {
            let label = KeepWords.of(Categories.label(category))
            let text = NSMutableAttributedString(
                string: rest.isEmpty ? label : "\(label) · \(keepPairs(KeepWords.of(rest)))",
                attributes: [.font: OverlayStyle.font(12 * s), .foregroundColor: muted])
            let labelRange = NSRange(location: 0, length: (label as NSString).length)
            text.addAttributes([.foregroundColor: Categories.color(category).nsColor, .font: OverlayStyle.font(12 * s, weight: .semibold)], range: labelRange)
            return laid(text, textWidth, 12)
        }
        func item(_ e: NoteEntry, _ columnWidth: CGFloat) -> Item {
            let h = head(e.category, e.whereText, columnWidth - 28 * s)
            let b = para(e.body, columnWidth - 28 * s, light, 14)
            return Item(number: e.number, color: e.color, head: h.text, headHeight: h.height, body: b.text, bodyHeight: b.height, width: h.width)
        }
        func itemHeight(_ i: Item) -> CGFloat { i.headHeight + 2 * s + i.bodyHeight + 12 * s }

        let headPara = title.map { para(KeepWords.of($0), CGFloat(width) - pad * 2, muted, 12) }
        let tail = extra.flatMap { $0.trimmedBothEnds.isEmpty ? nil : para($0.trimmedBothEnds, CGFloat(width) - pad * 2, light, 14) }
        let fixedHeight = pad + (headPara.map { $0.height + 12 * s } ?? 0) + (tail.map { $0.height + 12 * s } ?? 0) + pad - 12 * s

        // One column first; when that is taller than the screenshot, the picture fits two columns (each a bit over half the narrowest notes
        // area) and there is more than one note: two columns as even in height as they can be
        let one = CGFloat(width) - pad * 2
        var list = entries.map { item($0, one) }
        var over = overall.map { item($0, one) }
        var total = fixedHeight + list.reduce(0) { $0 + itemHeight($1) } + (over.map(itemHeight) ?? 0)
        var split = list.count
        var columnWidth = one
        let half = (one - gutter * s) / 2
        if total > CGFloat(imageHeight) && list.count > 1 && half >= CGFloat(minWidth) * s * 0.6 {
            list = entries.map { item($0, half) }
            over = overall.map { item($0, one) }
            let heights = list.map(itemHeight)
            let sum = heights.reduce(0, +)
            // Fill the left column until it passes half (numbers read down the left column, then the right)
            var left: CGFloat = 0
            split = 0
            while split < list.count - 1 && left + heights[split] / 2 < sum / 2 {
                left += heights[split]
                split += 1
            }
            split = max(1, split)
            let columns = max(heights[..<split].reduce(0, +), heights[split...].reduce(0, +))
            total = fixedHeight + columns + (over.map(itemHeight) ?? 0)
            columnWidth = half
        }
        return NotesBlock(
            items: list, overall: over, title: headPara, extra: tail, s: s, split: split, columnWidth: columnWidth, width: width,
            height: Int(ceil(total)))
    }

    /// Draws the notes area at the top-left of a context whose y axis points down, `canvasWidth` wide
    func draw(in context: CGContext, canvasWidth: Int) {
        context.saveGState()
        defer { context.restoreGState() }
        context.setFillColor(NSColor(hex: 0x1b1b1e).cgColor)
        context.fill(CGRect(x: 0, y: 0, width: CGFloat(canvasWidth), height: CGFloat(height)))
        context.setFillColor(NSColor(hex: 0x2c2c31).cgColor)
        context.fill(CGRect(x: 0, y: 0, width: CGFloat(canvasWidth), height: max(1, s.rounded(.toNearestOrEven))))
        let pad = 16 * s
        var y = pad
        if let title {
            draw(title.text, at: CGPoint(x: pad, y: y), width: title.width, height: title.height, in: context)
            y += title.height + 12 * s
        }
        let top = y
        var bottom = y
        for (i, item) in items.enumerated() {
            // Two columns: the right one starts at `split`, back at the top
            if i == split && twoColumns { y = top }
            let x = i < split ? pad : pad + columnWidth + NotesBlock.gutter * s
            if item.number > 0 {
                MarkPainter.drawBadge(item.number, color: item.color, center: CGPoint(x: x + 10 * s, y: y + item.headHeight / 2), radius: 10 * s, in: context)
            }
            y = drawItem(item, x: x + 28 * s, y: y, in: context)
            bottom = max(bottom, y)
        }
        y = bottom
        if let overall { y = drawItem(overall, x: pad + 28 * s, y: y, in: context) }
        if let extra { draw(extra.text, at: CGPoint(x: pad, y: y), width: extra.width, height: extra.height, in: context) }
    }

    private func drawItem(_ item: Item, x: CGFloat, y: CGFloat, in context: CGContext) -> CGFloat {
        draw(item.head, at: CGPoint(x: x, y: y), width: item.width, height: item.headHeight, in: context)
        let bodyTop = y + item.headHeight + 2 * s
        draw(item.body, at: CGPoint(x: x, y: bodyTop), width: item.width, height: item.bodyHeight, in: context)
        return bodyTop + item.bodyHeight + 12 * s
    }

    private func draw(_ text: NSAttributedString, at origin: CGPoint, width: CGFloat, height: CGFloat, in context: CGContext) {
        MarkPainter.withAppKit(context) {
            text.draw(with: CGRect(origin: origin, size: CGSize(width: width, height: height)), options: [.usesLineFragmentOrigin])
        }
    }
}
