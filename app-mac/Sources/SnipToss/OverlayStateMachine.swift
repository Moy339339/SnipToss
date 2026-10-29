import CoreGraphics
import Foundation

/// What a drag is doing (from one press to release on the overlay); `noDrag` = no drag
enum DragOp {
    case noDrag, newSel, move, resize, draw
}

/// The cursor over the canvas (the view turns it into an NSCursor; `tool` = the small icon of the current drawing tool)
enum CursorKind {
    case arrow, hand, tool, sizeAll, sizeNWSE, sizeNESW, sizeNS, sizeWE
}

/// What the state machine needs the overlay view to do: draw, open and close the two input boxes, focus. The view is the overlay's content
/// view; in unit tests it is a fake
protocol OverlayView: AnyObject {
    /// Redraw the outline, the dimmed area, the handles and the toolbar (the note box follows if it is open)
    func refresh()

    /// Redraw only the marks (called on every frame of a drag-draw, so it must not re-lay out the toolbar)
    func redrawMarks()

    func setCursor(_ cursor: CursorKind)

    /// Open the note box (the title and category come from the state machine), put text in it first, and give it the keyboard
    func openNoteBox(_ text: String)

    func closeNoteBox()

    /// The note box's category changed
    func paintNote()

    /// While the note box is open, this note gained or lost a place, or the tool changed and marking continues: the "N marks" in the title
    /// follows, and the keyboard returns to the note box
    func showNotePlaces()

    /// The text currently in the note box (not saved yet)
    var noteDraft: String { get }

    /// Open the text box at `textAt` (empty, `textSize` font size, current color) and give it the keyboard
    func openTextBox()

    func closeTextBox()

    /// The font size or color changed while the text box is open
    func restyleText()

    /// The text currently in the text box (not finished yet)
    var textDraft: String { get }

    /// The top-left corner of the first character in the text box (points in this layer): the finished text is drawn here, so its position
    /// after compositing matches where it was typed
    var textOrigin: CGPoint { get }

    func activate()

    /// The keyboard returns to the overlay itself (after an input box closes)
    func focusSelf()

    /// Release the mouse if it is captured (the view calls `endOp` once more on release)
    func releaseMouse()

    /// The mouse position when it is on this display (points in this layer, not snapped); nil when it is on another display
    var cursorPosition: CGPoint? { get }
}

/// What the state machine asks the session (with several displays the selection can be on only one; see CaptureSession)
protocol OverlayHost: AnyObject {
    /// The selection is on this layer
    var isOwner: Bool { get }

    /// Some layer (possibly this one) has a selection
    var hasOwner: Bool { get }

    /// This layer starts selecting: the other layers go back to fully dark. Refused (returns false) if another layer has drawings
    func claim() -> Bool

    /// This layer stops selecting: all layers (including this one) go back to Idle
    func release()

    func focusOwner()

    func requestCancel()

    func finish()
}

/// The last color and thickness used (remembered while the app runs, shared by displays and captures through `shared`).
/// Three sizes: line width, text font size, Pixelate brush width. Even the thinnest Pixelate size must cover a line of body text in one
/// stroke (16 px text with its ascenders and descenders is about 20): with a thinner brush the top and bottom halves of the text still show
final class ToolPrefs {
    static let colors: [MarkColor] = [
        MarkColor(hex: 0xff6a3d), MarkColor(hex: 0xff4d6d), MarkColor(hex: 0xffc233), MarkColor(hex: 0x3ddc84), MarkColor(hex: 0x5b8cff),
        MarkColor(hex: 0xb07cff),
    ]
    /// The names of the preset colors (the options of the message markColor.name), matching `colors` one to one (same as markColors.ts in
    /// the main app)
    private static let names = ["orange", "red", "yellow", "green", "blue", "purple"]
    private static let lineSizes: [CGFloat] = [2, 4, 6]
    private static let textSizes: [CGFloat] = [14, 18, 24]
    private static let mosaicSizes: [CGFloat] = [20, 32, 56]

    static let shared = ToolPrefs()

    var color = ToolPrefs.colors[0]
    var sizeIndex: [Tool: Int] = [.text: 1, .mosaic: 1]

    /// What the mark color in Settings was when a color was chosen in the overlay. If Settings changes later, the new one wins: otherwise,
    /// after picking a color once, no later change to Settings → Annotations → Mark color would be recognized until the app restarts
    private var chosenOver: MarkColor?

    /// The name of a color: presets use their name (following the UI language), anything else (a mark color written by hand in the settings
    /// file) uses the hex value
    static func name(_ c: MarkColor) -> String {
        guard let i = colors.firstIndex(of: c) else { return c.hexText }
        return ShellText.t("markColor.name", ["color": names[i]])
    }

    static func sizes(_ t: Tool) -> [CGFloat] {
        switch t {
        case .text: return textSizes
        case .mosaic: return mosaicSizes
        default: return lineSizes
        }
    }

    func currentSize(_ t: Tool) -> CGFloat {
        ToolPrefs.sizes(t)[sizeIndex[t] ?? 0]
    }

    /// When an overlay opens: the mark color in Settings is `defaultColor`
    func start(_ defaultColor: MarkColor) {
        if chosenOver == defaultColor { return }
        color = defaultColor
        chosenOver = nil
    }

    /// A color was clicked on the sub-toolbar
    func choose(_ c: MarkColor, defaultColor: MarkColor) {
        color = c
        chosenOver = defaultColor
    }
}

/// The state and transitions of the overlay on one display: selection, hover, drag, tool, marks, note box, text box, undo, the warning
/// before cancelling. It does not touch AppKit views: when it needs to draw, open or close an input box, or move focus it calls
/// `OverlayView`, and for multi-display matters it asks `OverlayHost` (the session), so unit tests can run without a window
/// (OverlayStateMachineTests). Keep the order of calls to the view as is (state first or open the box first, release the mouse first or
/// finish up first). All coordinates are points in this layer, y pointing down; the press point is already snapped to physical pixels
/// (`OverlayGeometry.snap`)
final class OverlayStateMachine {
    /// After notes have been written, the first Esc / × only warns; pressing again within this time really cancels
    static let warnFor: TimeInterval = 3

    let prefs: ToolPrefs

    private let view: OverlayView
    private let host: OverlayHost
    private let scale: CGFloat
    private let full: CGRect
    private let windows: [CGRect]
    private let defaultColor: MarkColor
    private let defaultCategory: String
    private let measure: TextMeasuring

    /// - Parameters:
    ///   - scale: pixels per point of this display
    ///   - windows: the windows on this display, topmost first
    ///   - measure: how big a text mark is (for hit testing)
    init(
        view: OverlayView, host: OverlayHost, scale: CGFloat, full: CGRect, windows: [CGRect], defaultColor: MarkColor,
        defaultCategory: String, prefs: ToolPrefs, measure: TextMeasuring = SystemTextMeasure()
    ) {
        self.view = view
        self.host = host
        self.scale = scale
        self.full = full
        self.windows = windows
        self.defaultColor = defaultColor
        self.defaultCategory = defaultCategory
        self.prefs = prefs
        self.measure = measure
    }

    private(set) var marks: [Mark] = []

    /// nil = still choosing
    private(set) var sel: CGRect?

    private(set) var hover: CGRect?

    private(set) var tool: Tool = .noTool

    private(set) var overall = ""

    private(set) var overallCategory = "change"

    /// The category used by the last newly written note on this screenshot: the next one starts from it (like the main app, which remembers
    /// the last one per item)
    private var lastCategory: String?

    private(set) var op: DragOp = .noDrag

    /// The mark being drag-drawn (it enters `marks` only on release)
    private(set) var drawing: Mark?

    private var start = CGPoint.zero
    private var startSel = CGRect.zero
    private var downSel: CGRect?
    private var handle = -1
    private var moved = false

    // The small note box (the words for the AI)
    private(set) var noteOpen = false

    /// Which note the box is writing (its first place); nil with `noteOpen` = writing the overall comment
    private(set) var noteFor: Mark?

    /// The places marked after this note box opened (undo and Esc take these back)
    private var added: [Mark] = []

    /// How many places the note being written marks (0 for the overall comment)
    var notePlaces: Int {
        guard let lead = noteFor else { return 0 }
        return marks.filter { $0.head === lead }.count
    }

    /// While the note box is open and the note being written marks a place, clicking or drawing with these tools in the selection = this
    /// note gains another place and the box stays open (one comment covers several places without repeating it; ADR-0009).
    /// Pixelate and Text do not mark positions, so as before "click elsewhere = done writing"
    private static func marksPlace(_ t: Tool) -> Bool {
        t == .note || t == .rect || t == .ellipse || t == .arrow || t == .pen
    }

    /// The mark picked by a click: the colors on the sub-toolbar and the number keys 1–6 change this one, while later drawings still use
    /// the color in `prefs` (like the main app, where 1–6 on a selected mark changes only that one). Once a note marks several places,
    /// clicking any one of them changes its color, so the note can say by color which place gets which change. nil = nothing picked
    private(set) var picked: Mark?

    /// Colors that were changed (restored on undo): `seq` is ordered together with the marks' `seq`, and undo undoes the later one first
    private var recolored: [(mark: Mark, was: MarkColor, seq: Int)] = []

    /// The ordering of marks and color changes (`Mark.seq` and `recolored`'s `seq` are taken from here)
    private var clock = 0

    /// The clock when this note box opened: while the box is open undo only undoes color changes made after this, and Esc / cancel restores
    /// all of them
    private var noteSince = 0

    private(set) var noteCategory = "change"

    // Text tool: text written directly on the image
    private(set) var textOpen = false

    private(set) var textAt = CGPoint.zero

    private(set) var textSize: CGFloat = 0

    private var cancelArmed = Date.distantPast

    /// There are drawings on this display: marks, an overall comment, or text typed in an input box and not yet saved. This locks the
    /// selection (it cannot be moved or re-selected with a right-click), another display cannot start selecting, and cancelling warns once
    /// first (unsaved typed text must count: switching displays or clicking × would lose it at once)
    var locked: Bool { !marks.isEmpty || !overall.isEmpty || pendingText }

    private var pendingText: Bool {
        (textOpen && !view.textDraft.trimmedBothEnds.isEmpty) || (noteOpen && !view.noteDraft.trimmedBothEnds.isEmpty)
    }

    var hasNotes: Bool { marks.contains { $0.hasNote } || !overall.isEmpty || pendingText }

    /// Numbers must not be drawn outside this range (the selection)
    var keep: CGRect { sel ?? WPFRect.empty }

    /// The part that gets an outline and is not dimmed: the selection; while still choosing, the hovered window (none while another display
    /// is selecting)
    var shown: CGRect? {
        if let sel { return sel }
        return host.hasOwner && !host.isOwner ? nil : hover
    }

    var handlesVisible: Bool { sel != nil && !locked && op != .newSel }

    /// The toolbar hides while the selection is being dragged, moved or resized
    var toolbarVisible: Bool { sel != nil && !(op == .newSel || op == .move || op == .resize) }

    var magnifierVisible: Bool { op == .newSel || op == .resize || (sel == nil && !host.hasOwner) }

    // MARK: Mouse

    /// Left button down (p is already snapped to physical pixels). Returns true = a drag starts and the view must capture the mouse
    func down(_ p: CGPoint, clicks: Int) -> Bool {
        if clicks == 2, let framed = sel, framed.wpfContains(p), host.isOwner {
            // Double-click inside the frame = finish (whatever tool is selected). If the first click just opened an empty numbered dot /
            // text box, drop it (saving an empty one = removing it).
            // If the first click placed a numbered dot while the note box was open: remove it, and the text being written is saved as usual
            // (cancelling here would lose the typed text together with this note)
            if noteOpen {
                if let last = added.last, last.kind == .note, last.points[0].wpfDistance(to: p) < 6 { _ = removeLastPlace() }
                commitNote()
            }
            commitText()
            host.finish()
            return false
        }
        unpick()  // a click anywhere first drops the picked mark; if the click hits a mark it is picked again
        if noteOpen {
            // Hit one of this note's places: pick it (to change its color), keep the box open, and do not add a place
            if let mine = noteFor, host.isOwner, let place = placeAt(p), place.head === mine {
                pick(place)
                return false
            }
            // The note being written marks a place, a tool that can mark positions is selected, and the click is inside the selection (not
            // on another note's number): mark one more place and keep the box open
            if let lead = noteFor, Self.marksPlace(tool), let inside = sel, inside.wpfContains(p), host.isOwner {
                let hit = badgeAt(p)
                if hit == nil || hit === lead {
                    moved = false
                    start = p
                    downSel = sel
                    startMark(p)
                    return op != .noDrag
                }
            }
            commitNote()  // clicking outside = done writing
            return false
        }
        if textOpen {
            commitText()
            return false
        }
        if !host.claim() {
            // Another display already has drawings: give the keyboard back to that layer (otherwise Enter and the tool keys land on this
            // display, which has no selection, and do nothing)
            host.focusOwner()
            return false
        }
        moved = false
        start = p
        downSel = sel
        guard let s = sel else {
            op = .newSel
            return true
        }
        if let m = placeAt(p) {
            // Hit a mark (a number or a line): pick it; if it has a note, open that note too (clicking a number = edit that note)
            if m.head.hasNote { openNote(m.head) }
            pick(m)
            return false
        } else if tool != .noTool && s.wpfContains(p) {
            startMark(p)
            // A numbered dot or text opens its input box on a single click, with no drag: do not capture the mouse. A capture nobody
            // releases would make this layer swallow later clicks on the toolbar and Finish
            // (symptom: after writing a note nothing responds, and the only way out is Esc, which loses all the notes)
            if op == .noDrag { return false }
        } else if !locked {
            handle = OverlayGeometry.hitHandle(s, p)
            startSel = s
            if handle >= 0 {
                op = .resize
            } else if s.wpfContains(p) {
                op = .move
            } else {
                op = .newSel
            }
        } else {
            return false
        }
        return true
    }

    /// Mouse move (raw = points in this layer, not yet clamped to the screen or snapped). Returns the snapped point (the magnifier samples
    /// its pixel)
    @discardableResult
    func moveTo(_ raw: CGPoint, shift: Bool) -> CGPoint {
        let p = OverlayGeometry.snap(OverlayGeometry.clamp(raw, to: full), scale: scale)
        if p.wpfDistance(to: start) > 3 { moved = true }
        switch op {
        case .noDrag:
            updateHover(p)
            view.setCursor(cursorAt(p))
        case .newSel:
            if moved {
                sel = WPFRect.spanning(start, p)
                view.refresh()
            }
        case .move:
            let d = p.wpfVector(from: start)
            var r = startSel
            r.origin.x = clampValue(r.origin.x + d.dx, full.wpfLeft, full.wpfRight - r.size.width)
            r.origin.y = clampValue(r.origin.y + d.dy, full.wpfTop, full.wpfBottom - r.size.height)
            sel = r
            view.refresh()
        case .resize:
            sel = OverlayGeometry.resized(startSel, handle, p)
            view.refresh()
        case .draw:
            extendMark(p, shift: shift)
        }
        return p
    }

    /// Ends this drag: the left button was released, or the mouse capture was taken away (Cmd+Tab mid-drag, a system window popped up, so
    /// the release never arrives). Without handling the lost capture, `op` would stay in the dragging state: the selection or mark would
    /// follow the mouse without a button pressed, and the toolbar would not appear
    func endOp() {
        if op == .noDrag {
            view.releaseMouse()  // safety net: however it got captured, releasing the button always lets go
            return
        }
        let was = op
        op = .noDrag
        view.releaseMouse()  // this re-enters endOp, by which time op is already noDrag
        switch was {
        case .newSel where !moved:
            // No drag = a single click: if nothing is selected yet, select the hovered window (the whole display if none); if something is
            // selected, leave it
            sel = downSel ?? hover ?? full
        case .newSel, .resize:
            if let s = sel, s.wpfWidth < 4 || s.wpfHeight < 4 { sel = downSel ?? hover ?? full }
        case .draw:
            finishMark()
        case .noDrag, .move:
            break
        }
        if sel == nil { host.release() }
        view.refresh()
        if sel != nil { view.activate() }
    }

    /// Right button released
    func right() {
        // The left button is still down (mid-drag): ignore it. Acting on it would clear the selection, so the rectangle just dragged would
        // end up with no selection: no toolbar, and Enter could not finish
        if op != .noDrag { return }
        unpick()
        if noteOpen {
            cancelNote()
        } else if textOpen {
            commitText()
        } else if sel != nil && !locked {
            // Right-click = select again (as in other screenshot tools)
            sel = nil
            tool = .noTool
            host.release()
            hoverAtCursor()  // highlight the window under the mouse at once even if the mouse does not move (same as right after opening)
            view.refresh()
        } else if sel == nil {
            // notes may have been written on another display: warn once first as usual (discarding everything at once would lose them)
            host.requestCancel()
            host.focusOwner()  // the warning says "press Enter to finish": the keyboard must return to the layer that has the selection
        }
    }

    /// The mouse moved to another display: remove this display's hover highlight (two displays would each light one at the same time).
    /// Ignored while dragging
    func mouseLeft() {
        if op != .noDrag || sel != nil || hover == nil { return }
        hover = nil
        view.refresh()
    }

    /// The mouse is resting on this display: highlight the window under it by its position without waiting for the mouse to move (otherwise
    /// it appears only after a movement)
    func hoverAtCursor() {
        if let c = view.cursorPosition { updateHover(OverlayGeometry.snap(OverlayGeometry.clamp(c, to: full), scale: scale)) }
    }

    /// While there is no selection yet, highlight the topmost window under the mouse (the whole display if none); a click selects it
    private func updateHover(_ p: CGPoint) {
        if sel != nil || host.hasOwner { return }
        let hit = windows.firstIndex { $0.wpfContains(p) }  // the first one from the top
        if let hit { hover = windows[hit] } else { hover = full }
        view.refresh()
    }

    private func cursorAt(_ p: CGPoint) -> CursorKind {
        guard let s = sel else { return .arrow }
        // A mark that can be hit shows a hand (clicking picks it and edits its note). While the note box is open only this note's places
        // can be hit; anything else is "click outside = done writing"
        let overMark: Bool
        if noteOpen {
            if let mine = noteFor, let place = placeAt(p) { overMark = place.head === mine } else { overMark = false }
        } else {
            overMark = !textOpen && placeAt(p) != nil
        }
        if overMark { return .hand }
        // Drawing tools: the pointer becomes that tool's small icon (as in the main app), and the Pin tool shows a pin
        if tool != .noTool && s.wpfContains(p) { return .tool }
        if locked { return .arrow }
        switch OverlayGeometry.hitHandle(s, p) {
        case 0, 4: return .sizeNWSE
        case 2, 6: return .sizeNESW
        case 1, 5: return .sizeNS
        case 3, 7: return .sizeWE
        default: return s.wpfContains(p) ? .sizeAll : .arrow
        }
    }

    private func nudge(_ dx: CGFloat, _ dy: CGFloat) {
        guard let s = sel, !locked else { return }
        sel = OverlayGeometry.nudge(s, dx: dx, dy: dy, scale: scale, full: full)
        view.refresh()
    }

    // MARK: Several displays, cancelling

    /// Another display started selecting: this one goes back to fully dark, with no highlight
    func idle() {
        // An open empty note box or text box is closed along with it (one with text locks the selection, so it never gets here): left open,
        // they would stay on the dark display and swallow the first click after coming back.
        // closeNote / hideText are not called: they pull keyboard focus back to this layer, while the user is selecting on another display
        // right now
        noteOpen = false
        noteFor = nil
        added.removeAll()
        view.closeNoteBox()
        textOpen = false
        view.closeTextBox()
        sel = nil
        hover = nil
        marks.removeAll()
        picked = nil
        recolored.removeAll()
        overall = ""
        tool = .noTool
        view.refresh()
    }

    /// Once notes have been written, the first Esc / × does not cancel but warns "press again to discard"; only a second press within
    /// `warnFor` really cancels. Returns true = this time should warn (and not cancel)
    func armCancel(now: Date) -> Bool {
        if !hasNotes || now.timeIntervalSince(cancelArmed) < Self.warnFor { return false }
        cancelArmed = now
        return true
    }

    /// On finish: the open note box and text box are committed first
    func commitOpenEdits() {
        if noteOpen { commitNote() }
        if textOpen { commitText() }
    }

    // MARK: Drawing marks

    private func startMark(_ p: CGPoint) {
        switch tool {
        case .text:
            openText(p)
            op = .noDrag
            return
        case .note:
            op = .noDrag
            if noteOpen, let lead = noteFor {
                // Mark one more place. If this note already has a numbered dot at almost the same spot (a double click), do not stack
                // another
                let stacked = marks.contains { $0.head === lead && $0.kind == .note && $0.points[0].wpfDistance(to: p) < 6 }
                if !stacked { addPlace(Mark(kind: .note, color: prefs.color, size: 2, points: [p], lead: lead)) }
                return
            }
            let pin = Mark(kind: .note, color: prefs.color, size: 2, points: [p])
            put(pin)
            view.redrawMarks()
            openNote(pin)
            return
        default:
            break
        }
        let m = Mark(kind: tool, color: prefs.color, size: prefs.currentSize(tool), points: [p])
        if tool == .rect || tool == .ellipse || tool == .arrow { m.points.append(p) }
        drawing = m
        op = .draw
    }

    private func extendMark(_ point: CGPoint, shift: Bool) {
        guard let m = drawing, let s = sel else { return }
        var p = CGPoint(x: clampValue(point.x, s.wpfLeft, s.wpfRight), y: clampValue(point.y, s.wpfTop, s.wpfBottom))
        switch m.kind {
        case .rect, .ellipse:
            // Shift: square / circle
            if shift { p = OverlayGeometry.squareCorner(m.points[0], p, sel: s) }
            m.points[1] = p
        case .arrow:
            m.points[1] = p
        default:
            if p.wpfDistance(to: m.points[m.points.count - 1]) >= 1.5 { m.points.append(p) }
        }
        view.redrawMarks()
    }

    private func finishMark() {
        let finished = drawing
        drawing = nil
        guard let m = finished, !m.isTiny else {
            view.redrawMarks()
            // A click inside the selection while the note box is open, without a drag: as before, clicking elsewhere = done writing
            if finished != nil && noteOpen { commitNote() }
            return
        }
        if noteOpen, let lead = noteFor {
            // Drawn while the note box is open: this note gains another place, and the box stays open and does not move
            m.lead = lead
            addPlace(m)
            return
        }
        put(m)
        view.redrawMarks()
        // After drawing a rectangle, ellipse, arrow or pen stroke: pop up the note box next to it (Esc writes nothing and just keeps the
        // mark)
        if m.kind == .rect || m.kind == .ellipse || m.kind == .arrow || m.kind == .pen { openNote(m) }
    }

    /// One more place marked while the note box is open: added to this note
    private func addPlace(_ m: Mark) {
        put(m)
        added.append(m)
        view.redrawMarks()
        view.showNotePlaces()
    }

    /// Adds a newly drawn mark (recording its order)
    private func put(_ m: Mark) {
        clock += 1
        m.seq = clock
        marks.append(m)
    }

    /// Takes a mark out of `marks` (the first one that is this very object)
    private func removeMark(_ m: Mark) {
        if let i = marks.firstIndex(where: { $0 === m }) { marks.remove(at: i) }
    }

    /// Removes the last place marked this time (undo, Option+Z in the note box). Returns false = nothing was marked this time
    @discardableResult
    private func removeLastPlace() -> Bool {
        guard let last = added.last else { return false }
        removeMark(last)
        added.removeLast()
        view.redrawMarks()
        view.showNotePlaces()
        return true
    }

    func undo() {
        if noteOpen {
            // First undo what was done while this box was open: the places marked and the colors changed, the later one first; only when
            // none is left cancel the note being written;
            // one more press is needed to undo the last mark (undoing while editing note 1 must not delete the last mark as well)
            if !undoRecolor(after: max(noteSince, added.last?.seq ?? 0)) && !removeLastPlace() { cancelNote() }
            keepPick()
            return
        }
        if textOpen {
            // Typing text: what gets undone is this text (undoing the previously drawn mark would leave this text in place, so that a click
            // anywhere afterwards would commit it)
            hideText()
            return
        }
        // The last action was a color change (later than the last drawn mark): change it back
        if undoRecolor(after: marks.last?.seq ?? 0) {
            keepPick()
            return
        }
        if !marks.isEmpty { marks.removeLast() } else { overall = "" }
        keepPick()
        renumber()
        view.refresh()
    }

    /// Undoes the last color change if it is later than `after` (the last drawn mark, or the moment this note box opened). Returns false =
    /// nothing to undo
    private func undoRecolor(after: Int) -> Bool {
        // Ignore marks that are gone (undone, taken back)
        recolored.removeAll { r in !marks.contains { $0 === r.mark } }
        guard let last = recolored.last, last.seq > after else { return false }
        recolored.removeLast()
        last.mark.color = last.was
        view.refresh()
        return true
    }

    /// After an undo the picked mark is gone: it is no longer picked
    private func keepPick() {
        if let m = picked, !marks.contains(where: { $0 === m }) { unpick() }
    }

    private func pick(_ m: Mark) {
        picked = m
        view.refresh()  // draw a selection box on the mark, and the sub-toolbar switches to its color
    }

    private func unpick() {
        if picked == nil { return }
        picked = nil
        view.refresh()
    }

    private func renumber() {
        var n = 0
        // The number is kept on the first place, and the places marked afterwards draw the first place's number
        for m in marks {
            if m.lead == nil && !m.note.isEmpty {
                n += 1
                m.number = n
            } else {
                m.number = 0
            }
        }
        view.redrawMarks()
    }

    /// Which note's number was hit (for a note with several places, any place's number is that note; returns the first place)
    private func badgeAt(_ p: CGPoint) -> Mark? {
        badgePlaceAt(p)?.head
    }

    /// Which place's number was hit (the note being written and not yet saved counts too: its number is already drawn)
    private func badgePlaceAt(_ p: CGPoint) -> Mark? {
        marks.last { m in
            (m.head.hasNote || m.head.pendingNumber > 0) && MarkPainter.badgeCenter(m, keepInside: keep).wpfDistance(to: p) <= 11
        }
    }

    /// Which mark was hit: numbers are drawn on top, so check numbers first, then lines and text (later ones are on top); Pixelate does not
    /// count (it has no color to change)
    private func placeAt(_ p: CGPoint) -> Mark? {
        if let number = badgePlaceAt(p) { return number }
        return marks.last { m in
            m.kind == .note
                ? MarkPainter.badgeCenter(m, keepInside: keep).wpfDistance(to: p) <= 11
                : m.hits(p, measure: measure)
        }
    }

    // MARK: Writing notes (the words for the AI)

    /// - Parameter m: nil = overall comment
    private func openNote(_ m: Mark?) {
        if noteOpen { commitNote() }  // switching to open another: the open one is committed first and its preview number is taken back
        picked = nil  // when opened by clicking a mark, the caller picks the hit place again afterwards
        noteFor = m
        noteOpen = true
        added.removeAll()
        noteSince = clock
        if let m, !m.hasNote { m.pendingNumber = marks.filter { $0.hasNote }.count + 1 }
        if let m, m.hasNote {
            noteCategory = m.category
        } else if m == nil && !overall.isEmpty {
            noteCategory = overallCategory
        } else {
            noteCategory = lastCategory ?? defaultCategory
        }
        view.openNoteBox(m?.note ?? overall)
        view.refresh()
    }

    /// A key pressed in the note box (the overlay's own keys give way first, see `press`). Returns true = handled, and the input box does
    /// not get it
    func noteKey(_ key: OverlayKey, _ mods: OverlayModifiers) -> Bool {
        if key == .enter && !mods.contains(.shift) {
            // Return and ⌘Return both save (a note on a screenshot is usually one sentence); Shift+Return inserts a line break
            commitNote()
            return true
        }
        if key == .escape {
            cancelNote()
            return true
        }
        if mods.contains(.option), let n = key.mainRowDigit, n >= 1, n <= 4 {
            setNoteCategory(Categories.keys[n - 1])
            return true
        }
        if mods.contains(.option) && key == .z {
            // remove the last place marked (same as Alt+Z in the main app's composer); if none was marked, do nothing and do not cancel the
            // whole note
            _ = removeLastPlace()
            return true
        }
        return false
    }

    func setNoteCategory(_ key: String) {
        noteCategory = key
        view.paintNote()
    }

    func commitNote() {
        if !noteOpen { return }
        let text = view.noteDraft.trimmedBothEnds
        if !text.isEmpty { lastCategory = noteCategory }
        if let m = noteFor {
            m.note = text
            m.category = noteCategory
            if text.isEmpty {
                // No text written (or all of it deleted) = no note wanted: remove the numbered dots, and keep the rectangles and arrows as
                // plain drawings
                for x in marks.filter({ $0.lead === m }) { drop(x) }
                if m.kind == .note { removeMark(m) }
            }
        } else {
            overall = text
            overallCategory = noteCategory
        }
        closeNote()
    }

    func cancelNote() {
        if !noteOpen { return }
        // Colors changed while this box was open are changed back; places marked since, and a newly placed numbered dot that never had
        // text, are taken back together (the dot is removed, rectangles and arrows stay as plain drawings without a note); when editing an
        // existing note its original places are left alone
        while undoRecolor(after: noteSince) {}
        for x in added { drop(x) }
        if let pin = noteFor, pin.kind == .note, pin.note.isEmpty { removeMark(pin) }
        closeNote()
    }

    /// A place no longer belongs to this note: a numbered dot (there only to mark a position) is removed, while rectangles, arrows and pen
    /// strokes stay as drawings
    private func drop(_ x: Mark) {
        if x.kind == .note { removeMark(x) } else { x.lead = nil }
    }

    private func closeNote() {
        noteOpen = false
        added.removeAll()
        picked = nil  // the picked mark is one of this note's places: once the box closes it is no longer picked (redrawn below)
        if let f = noteFor { f.pendingNumber = 0 }
        noteFor = nil
        view.closeNoteBox()
        renumber()
        view.refresh()
        view.focusSelf()
    }

    // MARK: Text tool (text written on the image)

    private func openText(_ p: CGPoint) {
        textAt = p
        textSize = prefs.currentSize(.text)
        textOpen = true
        view.openTextBox()
    }

    /// A key pressed in the text box: Esc means done (not cancel), and everything else goes to the input box (Return inserts a line break)
    func textKey(_ key: OverlayKey) -> Bool {
        if key != .escape { return false }
        commitText()
        return true
    }

    private func commitText() {
        if !textOpen { return }
        let text = view.textDraft.trimmedEnd
        if !text.trimmedBothEnds.isEmpty {
            put(Mark(kind: .text, color: prefs.color, size: textSize, points: [view.textOrigin], text: text))
        }
        hideText()
    }

    /// Closes the text box (finished text has already become a mark; on undo it just closes and keeps no text)
    private func hideText() {
        textOpen = false
        view.closeTextBox()
        view.redrawMarks()
        view.refresh()
        view.focusSelf()
    }

    // MARK: Keyboard, toolbar

    /// A key pressed on the overlay (the view gets it first, the input boxes after). Returns true = handled (swallowed); false = leave it
    /// to the input box / the system.
    ///
    /// One difference from the Windows shell: there Alt+F4 means cancel (warn once first if notes were written), and it is handled before
    /// the input-box check because left to the system it would close only this layer without the session knowing, and Screen Capture could
    /// never open again. Alt+F4 means nothing on a Mac; ⌘W and ⌘. (command + period) do exactly that. ⌘Q is not handled: it stays with the
    /// system
    func press(_ key: OverlayKey, _ mods: OverlayModifiers) -> Bool {
        if mods.contains(.command) && (key == .w || key == .period) {
            host.requestCancel()
            return true
        }
        if noteOpen || textOpen { return false }  // the input box handles it itself
        // ⌘ takes the place of Ctrl in the Windows shortcuts; ⌥ the place of Alt
        let command = mods.contains(.command)
        let shift = mods.contains(.shift)
        let plain = mods.isPlain
        switch key {
        case .escape where picked != nil:
            unpick()  // first put down the picked mark; pressing again cancels the capture
        case .escape:
            host.requestCancel()
        case .digit(let n) where plain && sel != nil && n >= 1 && n <= 6:
            setColor(ToolPrefs.colors[n - 1])  // same order as the colors on the sub-toolbar (same as 1–6 in the main app)
        case .keypad(let n) where plain && sel != nil && n >= 1 && n <= 6:
            setColor(ToolPrefs.colors[n - 1])
        case .enter:
            host.finish()  // works when the selection is on another display too (finish looks for the layer that has drawings)
        case .c where command:
            host.finish()
        case .z where command && !shift:  // ⇧⌘Z is redo in the main app, and the overlay has no redo: do not treat it as another undo
            undo()
        case .left:
            nudge(shift ? -10 : -1, 0)
        case .right:
            nudge(shift ? 10 : 1, 0)
        case .up:
            nudge(0, shift ? -10 : -1)
        case .down:
            nudge(0, shift ? 10 : 1)
        default:
            let t = Self.toolFor(key)
            if t != .noTool && !command && sel != nil {
                chooseTool(t, toggle: false)
            } else if key == .n && !command && sel != nil {
                openNote(nil)
            } else {
                return false
            }
        }
        return true
    }

    /// The tool a letter key picks (by the key's place on the keyboard: R O A B M T C)
    private static func toolFor(_ key: OverlayKey) -> Tool {
        switch key {
        case .r: return .rect
        case .o: return .ellipse
        case .a: return .arrow
        case .b: return .pen
        case .m: return .mosaic
        case .t: return .text
        case .c: return .note
        default: return .noTool
        }
    }

    /// The "Overall comment" button on the toolbar: the open note box and text box are committed first (same as clicking a tool button),
    /// then the overall comment opens; if the overall comment is already open = commit and close (same as clicking the selected tool
    /// again). Opening it directly would lose the text of the note being written, and the newly drawn mark would keep its preview number
    /// while the copied image had no matching explanation
    func toggleOverall() {
        if noteOpen && noteFor == nil {
            commitNote()
            return
        }
        if noteOpen { commitNote() }
        commitText()
        openNote(nil)
    }

    /// - Parameter toggle: Clicking the already selected tool on the toolbar = put it down; a shortcut key always selects (as in the main
    /// app, pressing R repeatedly stays on Rectangle)
    func chooseTool(_ t: Tool, toggle: Bool = true) {
        let next: Tool = toggle && tool == t ? .noTool : t
        picked = nil  // picking up a tool means drawing something new (redrawn below)
        // While a note that marks a place is being written, switching to another tool that can mark positions keeps the box open and
        // continues marking with it (same as switching tools while the main app's composer is open); switching to anything else commits as
        // before
        let keepNote = noteOpen && noteFor != nil && Self.marksPlace(next)
        if noteOpen && !keepNote { commitNote() }
        if textOpen { commitText() }
        tool = next
        view.refresh()
        cursorAtPointer()
        if keepNote { view.showNotePlaces() }
    }

    /// The nth thickness was clicked on the sub-toolbar (for text, the font size)
    func setSize(_ index: Int) {
        prefs.sizeIndex[tool] = index
        if tool == .text && textOpen {
            textSize = prefs.currentSize(.text)
            view.restyleText()
        }
        view.refresh()
        cursorAtPointer()
    }

    /// A color was clicked on the sub-toolbar or 1–6 was pressed: with a mark picked only it changes (undoable), otherwise it sets the
    /// color for later drawings
    func setColor(_ c: MarkColor) {
        if let m = picked {
            if m.color != c {
                clock += 1
                recolored.append((mark: m, was: m.color, seq: clock))
                m.color = c
            }
            view.refresh()
            return
        }
        prefs.choose(c, defaultColor: defaultColor)
        // While typing text: the text in the input box changes color too (otherwise it would keep the old color and only change after being
        // committed)
        if textOpen { view.restyleText() }
        view.refresh()
        cursorAtPointer()
    }

    /// After the tool, thickness or color changes: the pointer changes at once even if the mouse is still (after pressing M to switch tools
    /// it would change only once the mouse moved). Ignored while dragging
    private func cursorAtPointer() {
        if op == .noDrag, let c = view.cursorPosition {
            view.setCursor(cursorAt(OverlayGeometry.snap(OverlayGeometry.clamp(c, to: full), scale: scale)))
        }
    }
}
