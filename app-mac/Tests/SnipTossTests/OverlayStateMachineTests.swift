import AppKit
import XCTest

@testable import SnipToss

private let screen = CGRect(x: 0, y: 0, width: 1280, height: 720)
private let window = CGRect(x: 100, y: 100, width: 300, height: 200)
private let selection = CGRect(x: 200, y: 200, width: 400, height: 300)

/// A fake capture overlay view: records what was called; the text in the two input boxes is filled in by the test itself
/// (as if the user typed it)
private final class FakeView: OverlayView {
    var state: OverlayStateMachine!
    var log: [String] = []
    var captured = false
    var cursor: CGPoint?
    var lastCursor: CursorKind?
    var noteDraft = ""
    var textDraft = ""

    func refresh() { log.append("Refresh") }

    func redrawMarks() { log.append("RedrawMarks") }

    func setCursor(_ cursor: CursorKind) { lastCursor = cursor }

    func openNoteBox(_ text: String) {
        log.append("OpenNoteBox")
        noteDraft = text
    }

    func closeNoteBox() { log.append("CloseNoteBox") }

    func paintNote() { log.append("PaintNote") }

    func showNotePlaces() { log.append("ShowNotePlaces") }

    func openTextBox() {
        log.append("OpenTextBox")
        textDraft = ""
    }

    func closeTextBox() { log.append("CloseTextBox") }

    func restyleText() { log.append("RestyleText") }

    var textOrigin: CGPoint { state.textAt }

    func activate() { log.append("Activate") }

    func focusSelf() { log.append("FocusSelf") }

    /// As in the real one: when the mouse is released the view receives the end of the capture and calls `endOp` again
    func releaseMouse() {
        if !captured { return }
        captured = false
        state.endOp()
    }

    var cursorPosition: CGPoint? { cursor }
}

/// A fake session (with just this one layer): claim / release follow CaptureSession's rules, and on release every layer (this one
/// included) goes back to idle
private final class FakeHost: OverlayHost {
    var state: OverlayStateMachine!
    var log: [String] = []
    /// Something was drawn on another screen: this layer may not take ownership
    var refuse = false
    /// Another screen is selecting
    var otherOwner = false
    private(set) var isOwner = false

    var hasOwner: Bool { isOwner || otherOwner }

    func claim() -> Bool {
        if refuse { return false }
        isOwner = true
        otherOwner = false
        return true
    }

    func release() {
        if !isOwner { return }
        isOwner = false
        log.append("Release")
        state.idle()
    }

    func focusOwner() { log.append("FocusOwner") }

    func requestCancel() { log.append("RequestCancel") }

    func finish() { log.append("Finish") }
}

private final class Layer {
    let view: FakeView
    let host: FakeHost
    let state: OverlayStateMachine

    init(_ windows: [CGRect] = []) {
        let view = FakeView()
        let host = FakeHost()
        let state = OverlayStateMachine(
            view: view, host: host, scale: 1, full: screen, windows: windows, defaultColor: ToolPrefs.colors[0], defaultCategory: "change",
            prefs: ToolPrefs(), measure: FixedTextMeasure())
        view.state = state
        host.state = state
        self.view = view
        self.host = host
        self.state = state
    }

    /// As the view does: the mouse is captured only when the state machine says it is a drag
    @discardableResult
    func down(_ x: CGFloat, _ y: CGFloat, clicks: Int = 1) -> Bool {
        let drag = state.down(CGPoint(x: x, y: y), clicks: clicks)
        if drag { view.captured = true }
        return drag
    }

    func up() { state.endOp() }

    func drag(from: (x: CGFloat, y: CGFloat), to: (x: CGFloat, y: CGFloat)) {
        down(from.x, from.y)
        for i in 1...4 {
            let step = CGFloat(i)
            state.moveTo(CGPoint(x: from.x + (to.x - from.x) * step / 4, y: from.y + (to.y - from.y) * step / 4), shift: false)
        }
        up()
    }

    func click(_ x: CGFloat, _ y: CGFloat) {
        down(x, y)
        up()
    }

    func selected() -> Layer {
        drag(from: (200, 200), to: (600, 500))
        return self
    }

    @discardableResult
    func press(_ key: OverlayKey, _ mods: OverlayModifiers = []) -> Bool {
        state.press(key, mods)
    }

    /// The cursor the state machine asks the view for when the mouse is at this place
    func cursorAt(_ x: CGFloat, _ y: CGFloat) -> CursorKind? {
        state.moveTo(CGPoint(x: x, y: y), shift: false)
        return view.lastCursor
    }
}

/// The one element, failing the test if there are none or several
private func only(_ marks: [Mark], file: StaticString = #filePath, line: UInt = #line) throws -> Mark {
    XCTAssertEqual(marks.count, 1, "expected exactly one mark", file: file, line: line)
    return try XCTUnwrap(marks.first, file: file, line: line)
}

/// The capture overlay's state machine (OverlayStateMachine): uses a fake view and a fake session, and never opens the overlay.
/// It targets the ordering and priorities that are easiest to break; how it looks when drawn and the routing of the real mouse are covered
/// by the checks on a real Mac
final class OverlayStateMachineTests: SnipTestCase {
    func testAClickSelectsTheHoveredWindowOrTheWholeScreenWhenThereIsNoWindow() {
        let a = Layer([window])
        a.state.moveTo(CGPoint(x: 150, y: 150), shift: false)
        XCTAssertEqual(a.state.hover, window)
        XCTAssertEqual(a.view.lastCursor, .arrow)
        a.click(150, 150)
        XCTAssertEqual(a.state.sel, window)

        let b = Layer([window])
        b.state.moveTo(CGPoint(x: 800, y: 600), shift: false)
        b.click(800, 600)
        XCTAssertEqual(b.state.sel, screen)
    }

    func testDraggingOutASelectionATooSmallOneFallsBack() {
        let a = Layer().selected()
        XCTAssertEqual(a.state.sel, selection)
        XCTAssertTrue(a.state.handlesVisible)
        XCTAssertTrue(a.state.toolbarVisible)

        let b = Layer()
        b.drag(from: (10, 10), to: (12, 40))  // it was dragged (more than 3) but is only 2 wide
        XCTAssertEqual(b.state.sel, screen)
    }

    func testDraggingTheSelectionMovesItDraggingAHandleResizesItAndTheToolbarHidesWhileDragging() {
        let a = Layer().selected()
        XCTAssertTrue(a.down(400, 350))
        XCTAssertEqual(a.state.op, .move)
        a.state.moveTo(CGPoint(x: 410, y: 360), shift: false)
        XCTAssertFalse(a.state.toolbarVisible)
        a.up()
        XCTAssertEqual(a.state.sel, CGRect(x: 210, y: 210, width: 400, height: 300))
        XCTAssertTrue(a.down(610, 510))  // the bottom-right handle
        XCTAssertEqual(a.state.op, .resize)
        XCTAssertTrue(a.state.magnifierVisible)
        a.state.moveTo(CGPoint(x: 700, y: 600), shift: false)
        a.up()
        XCTAssertEqual(a.state.sel, CGRect(x: 210, y: 210, width: 490, height: 390))
    }

    func testClicksThatJustOpenAnInputBoxDoNotCaptureTheMouseOnlyDragsThatDrawDo() throws {
        // A number mark must not capture the mouse with nobody releasing it: later clicks on the toolbar and on Finish would be swallowed
        // by this layer, leaving only Esc, which loses all notes
        let a = Layer().selected()
        a.state.chooseTool(.note)
        XCTAssertFalse(a.down(300, 300))
        XCTAssertTrue(a.state.noteOpen)
        XCTAssertEqual(try only(a.state.marks).pendingNumber, 1)
        a.state.cancelNote()
        XCTAssertTrue(a.state.marks.isEmpty)

        a.state.chooseTool(.text)
        XCTAssertFalse(a.down(300, 300))
        XCTAssertTrue(a.state.textOpen)
        a.view.textDraft = "字"
        XCTAssertTrue(a.state.textKey(.escape))  // Esc means done writing
        XCTAssertEqual(try only(a.state.marks).text, "字")

        a.state.chooseTool(.rect)
        XCTAssertFalse(a.down(305, 305))  // a click on the text just written: selects it (to change its color), no drawing
        XCTAssertIdentical(a.state.picked, try only(a.state.marks))
        XCTAssertTrue(a.down(400, 400))
        XCTAssertEqual(a.state.op, .draw)
    }

    func testClickingANumberEditsThatNoteWithoutCapturingTheMouse() throws {
        let a = Layer().selected()
        a.state.chooseTool(.rect)
        a.drag(from: (250, 250), to: (300, 300))
        a.view.noteDraft = "改大"
        a.state.commitNote()
        let rect = try only(a.state.marks)
        XCTAssertEqual(rect.number, 1)
        XCTAssertEqual(a.cursorAt(250, 250), .hand)
        XCTAssertFalse(a.down(250, 250))  // the number is drawn at the top-left corner
        XCTAssertIdentical(a.state.noteFor, rect)
        XCTAssertEqual(a.view.noteDraft, "改大")
    }

    func testOnReleaseTheDragIsFinishedBeforeTheMouseIsReleasedAndTheReentryOnReleaseDoesNotFinishItTwice() {
        let a = Layer().selected()
        a.state.chooseTool(.rect)
        XCTAssertTrue(a.down(250, 250))
        a.state.moveTo(CGPoint(x: 350, y: 350), shift: false)
        a.view.log.removeAll()
        a.up()
        XCTAssertFalse(a.view.captured)
        XCTAssertEqual(a.state.op, .noDrag)
        XCTAssertEqual(a.state.marks.count, 1)
        XCTAssertEqual(a.view.log.filter { $0 == "OpenNoteBox" || $0 == "Activate" }, ["OpenNoteBox", "Activate"])
    }

    func testUndoOrderNoteBoxThenTextBoxThenTheLastMarkThenTheOverallComment() {
        let a = Layer().selected()
        a.state.chooseTool(.rect)
        a.drag(from: (250, 250), to: (300, 300))
        a.view.noteDraft = "一"
        a.state.commitNote()
        a.drag(from: (350, 350), to: (400, 400))
        XCTAssertTrue(a.state.noteOpen)  // the note box pops up after drawing
        a.state.undo()
        XCTAssertFalse(a.state.noteOpen)
        // The note box was cancelled together with the rectangle that opened it; the note written before stays
        XCTAssertEqual(a.state.marks.count, 1)

        a.state.chooseTool(.text)
        a.click(400, 400)
        a.view.textDraft = "不要了"
        a.state.undo()
        XCTAssertFalse(a.state.textOpen)
        XCTAssertEqual(a.state.marks.count, 1)  // what was undone is this piece of text

        a.state.undo()
        XCTAssertTrue(a.state.marks.isEmpty)

        XCTAssertTrue(a.press(.n))
        a.view.noteDraft = "整体"
        XCTAssertTrue(a.state.noteKey(.enter, []))
        XCTAssertEqual(a.state.overall, "整体")
        a.state.undo()
        XCTAssertEqual(a.state.overall, "")
    }

    func testRightClickOrderIgnoredWhileDraggingThenDiscardsNoteBoxFinishesTextBoxNothingWhenLockedReselectsOrCancels() throws {
        let a = Layer([window]).selected()
        XCTAssertTrue(a.down(400, 350))
        a.state.right()
        XCTAssertEqual(a.state.op, .move)
        a.up()

        a.press(.n)
        a.view.noteDraft = "不写了"
        a.state.right()
        XCTAssertFalse(a.state.noteOpen)
        XCTAssertEqual(a.state.overall, "")

        a.state.chooseTool(.text)
        a.click(400, 400)
        a.view.textDraft = "写好"
        a.state.right()
        XCTAssertEqual(try only(a.state.marks).text, "写好")

        a.state.right()  // something is drawn: the selection is locked and right-click does nothing
        XCTAssertEqual(a.state.sel, selection)
        XCTAssertTrue(a.host.log.isEmpty)

        a.state.undo()
        a.view.cursor = CGPoint(x: 150, y: 150)
        a.state.right()
        XCTAssertNil(a.state.sel)
        XCTAssertEqual(a.state.tool, .noTool)
        XCTAssertEqual(a.host.log, ["Release"])
        XCTAssertEqual(a.state.hover, window)  // the window under the pointer is highlighted at once, even if the mouse does not move

        a.state.right()
        XCTAssertEqual(a.host.log, ["Release", "RequestCancel", "FocusOwner"])
    }

    func testUnsavedTextInAnInputBoxAlsoLocksTheSelectionButOnlySpacesDoNot() {
        let a = Layer().selected()
        a.press(.n)
        XCTAssertFalse(a.state.locked)
        a.view.noteDraft = "  "
        XCTAssertFalse(a.state.locked)
        a.view.noteDraft = "还没保存"
        XCTAssertTrue(a.state.locked)
        XCTAssertTrue(a.state.hasNotes)
        XCTAssertFalse(a.state.handlesVisible)
        a.state.cancelNote()
        XCTAssertFalse(a.state.locked)

        a.state.chooseTool(.text)
        a.click(300, 300)
        a.view.textDraft = " "
        XCTAssertFalse(a.state.locked)
        a.view.textDraft = "还没写好"
        XCTAssertTrue(a.state.locked)
    }

    func testWhenLockedAClickOutsideTheBoxDoesNothingAndAScreenWithDrawingsCannotBeTakenOverAndTheKeyboardGoesBackToThatLayer() {
        let a = Layer().selected()
        a.state.chooseTool(.rect)
        a.drag(from: (250, 250), to: (300, 300))
        a.view.noteDraft = "框"
        a.state.commitNote()
        a.state.chooseTool(.rect)  // put the tool down
        XCTAssertFalse(a.down(700, 600))
        XCTAssertEqual(a.state.sel, selection)

        let b = Layer()
        b.host.refuse = true
        XCTAssertFalse(b.down(100, 100))
        XCTAssertNil(b.state.sel)
        XCTAssertEqual(b.host.log, ["FocusOwner"])
    }

    func testWhenAnotherScreenIsSelectingThisOneShowsNoHighlightAndNoMagnifier() {
        let a = Layer([window])
        a.state.moveTo(CGPoint(x: 150, y: 150), shift: false)
        XCTAssertEqual(a.state.shown, window)
        XCTAssertTrue(a.state.magnifierVisible)
        a.host.otherOwner = true
        XCTAssertNil(a.state.shown)
        XCTAssertFalse(a.state.magnifierVisible)
    }

    /// The Mac's counterpart of the Windows test with Alt+F4: while an input box is open the overlay's keys go to the box, with ⌘W and
    /// ⌘. as the exception (they cancel, as Alt+F4 does there)
    func testWhileAnInputBoxIsOpenTheOverlaysKeysGoToTheBoxWithCommandWAndCommandPeriodAsTheException() {
        let a = Layer().selected()
        a.press(.n)
        XCTAssertFalse(a.press(.r))
        XCTAssertEqual(a.state.tool, .noTool)
        XCTAssertFalse(a.press(.escape))
        XCTAssertFalse(a.press(.w))  // a plain W is not a shortcut
        XCTAssertFalse(a.press(.period))
        XCTAssertTrue(a.host.log.isEmpty)
        XCTAssertTrue(a.press(.w, [.command]))
        XCTAssertEqual(a.host.log, ["RequestCancel"])
        XCTAssertTrue(a.press(.period, [.command]))
        XCTAssertEqual(a.host.log, ["RequestCancel", "RequestCancel"])
    }

    func testCommandWAndCommandPeriodCancelWithoutAnInputBoxToo() {
        let a = Layer().selected()
        XCTAssertTrue(a.press(.w, [.command]))
        XCTAssertTrue(a.press(.period, [.command, .shift]))
        XCTAssertEqual(a.host.log, ["RequestCancel", "RequestCancel"])
        // Option+W is not command+W
        XCTAssertFalse(a.press(.w, [.option]))
        XCTAssertEqual(a.host.log.count, 2)
    }

    func testCommandShiftZIsNotUndo() {
        let a = Layer().selected()
        a.state.chooseTool(.rect)
        a.drag(from: (250, 250), to: (300, 300))
        a.view.noteDraft = "框"
        a.state.commitNote()
        XCTAssertFalse(a.press(.z, [.command, .shift]))
        XCTAssertEqual(a.state.marks.count, 1)
        XCTAssertTrue(a.press(.z, [.command]))
        XCTAssertTrue(a.state.marks.isEmpty)
    }

    func testCancelWarnsFirstOnlyWhenNotesWereWrittenAndASecondPressWithin3SecondsReallyCancels() {
        let a = Layer().selected()
        let t = Date(timeIntervalSince1970: 1_792_000_000)
        XCTAssertFalse(a.state.armCancel(now: t))  // no notes written: cancels straight away
        a.press(.n)
        a.view.noteDraft = "意见"
        XCTAssertTrue(a.state.armCancel(now: t))
        XCTAssertFalse(a.state.armCancel(now: t.addingTimeInterval(2.9)))
        XCTAssertTrue(a.state.armCancel(now: t.addingTimeInterval(5)))
    }

    func testDoubleClickingToFinishInsideTheBoxDiscardsTheEmptyNumberPinTheFirstClickJustPlaced() {
        let a = Layer().selected()
        a.state.chooseTool(.note)
        XCTAssertFalse(a.down(300, 300, clicks: 1))
        XCTAssertEqual(a.state.marks.count, 1)
        XCTAssertFalse(a.down(300, 300, clicks: 2))
        XCTAssertTrue(a.state.marks.isEmpty)
        XCTAssertEqual(a.host.log, ["Finish"])
    }

    func testDoubleClickingToFinishWithTheNoteBoxOpenSavesTheWrittenTextAsUsualAndRemovesTheNumberPinTheFirstClickAdded() {
        // The second click of a double-click must not mean "cancel": with the box open, the first click added another place
        // (or selected one) without closing the box, and cancelling would throw away the written text together with the note
        let a = Layer().selected()
        a.state.chooseTool(.note)
        a.click(300, 300)
        a.view.noteDraft = "改成圆角"
        a.click(400, 300)
        XCTAssertEqual(a.state.notePlaces, 2)
        XCTAssertFalse(a.down(500, 400, clicks: 1))  // the first click of the double-click: adds another place
        XCTAssertEqual(a.state.notePlaces, 3)
        XCTAssertFalse(a.down(500, 400, clicks: 2))
        XCTAssertEqual(a.host.log, ["Finish"])
        XCTAssertEqual(a.state.marks.count, 2)
        XCTAssertEqual(a.state.marks[0].note, "改成圆角")
        XCTAssertEqual(a.state.marks[0].number, 1)
    }

    func testNumbersFollowTheOrderWrittenAreRenumberedWhenTextIsDeletedAndTheNextNoteStartsWithThePreviousNotesCategory() throws {
        let a = Layer().selected()
        a.state.chooseTool(.rect)
        a.drag(from: (250, 250), to: (300, 300))
        XCTAssertEqual(a.state.noteCategory, "change")  // the default category
        a.view.noteDraft = "一"
        XCTAssertTrue(a.state.noteKey(.digit(2), [.option]))
        a.state.commitNote()
        a.drag(from: (350, 350), to: (400, 400))
        XCTAssertEqual(a.state.noteCategory, "remove")
        XCTAssertEqual(try XCTUnwrap(a.state.noteFor).pendingNumber, 2)
        a.view.noteDraft = "二"
        a.state.commitNote()
        XCTAssertEqual(a.state.marks.map { $0.number }, [1, 2])

        a.down(250, 250)  // click the number of note 1 and delete all its text: the note goes, together with its rectangle
        a.view.noteDraft = ""
        a.state.commitNote()
        XCTAssertEqual(a.state.marks.map { $0.number }, [1])
        XCTAssertEqual(try only(a.state.marks).note, "二")
        a.state.undo()  // it comes back with its number
        XCTAssertEqual(a.state.marks.map { $0.number }, [1, 2])
        XCTAssertEqual(a.state.marks[0].note, "一")
    }

    func testChangingColorOrSizeWhileTypingUpdatesTheInputBoxAndTheFinishedTextKeepsTheValuesAtThatTime() throws {
        let a = Layer().selected()
        a.state.chooseTool(.text)
        a.click(300, 300)
        XCTAssertEqual(a.state.textSize, 18)  // the text size defaults to the middle step
        a.view.log.removeAll()
        a.state.setSize(2)
        a.state.setColor(ToolPrefs.colors[3])
        XCTAssertEqual(a.view.log.filter { $0 == "RestyleText" }.count, 2)
        a.view.textDraft = "绿字"
        a.state.right()
        let m = try only(a.state.marks)
        XCTAssertEqual(m.size, 24)
        XCTAssertEqual(m.color, ToolPrefs.colors[3])
    }

    func testColorChosenOnceIsRememberedAndAChangedSettingWins() {
        let prefs = ToolPrefs()
        let orange = ToolPrefs.colors[0]
        let blue = ToolPrefs.colors[4]
        prefs.start(orange)
        prefs.choose(ToolPrefs.colors[3], defaultColor: orange)
        prefs.start(orange)  // the next capture, settings unchanged
        XCTAssertEqual(prefs.color, ToolPrefs.colors[3])
        prefs.start(blue)  // the setting was changed to blue
        XCTAssertEqual(prefs.color, blue)
        XCTAssertEqual(blue, MarkColor(r: 0x5b, g: 0x8c, b: 0xff))
    }

    func testThePresetColorsAndSizes() {
        XCTAssertEqual(
            ToolPrefs.colors,
            [
                MarkColor(r: 0xff, g: 0x6a, b: 0x3d), MarkColor(r: 0xff, g: 0x4d, b: 0x6d), MarkColor(r: 0xff, g: 0xc2, b: 0x33),
                MarkColor(r: 0x3d, g: 0xdc, b: 0x84), MarkColor(r: 0x5b, g: 0x8c, b: 0xff), MarkColor(r: 0xb0, g: 0x7c, b: 0xff),
                MarkColor(r: 0x00, g: 0x00, b: 0x00), MarkColor(r: 0xff, g: 0xff, b: 0xff),
            ])
        let prefs = ToolPrefs()
        XCTAssertEqual(prefs.currentSize(.rect), 2)
        XCTAssertEqual(prefs.currentSize(.text), 18)
        XCTAssertEqual(prefs.currentSize(.mosaic), 32)
        prefs.sizeIndex[.pen] = 2
        XCTAssertEqual(prefs.currentSize(.pen), 6)
        XCTAssertEqual(ToolPrefs.sizes(.text), [14, 18, 24])
        XCTAssertEqual(ToolPrefs.sizes(.mosaic), [20, 32, 56])
    }

    func testIdleClosesOpenBoxesAndDrawingsWithoutTakingFocus() {
        let a = Layer().selected()
        a.press(.n)
        a.view.log.removeAll()
        a.state.idle()
        XCTAssertFalse(a.state.noteOpen)
        XCTAssertNil(a.state.sel)
        XCTAssertFalse(a.view.log.contains("FocusSelf"))  // the user is selecting on another screen at this moment
        XCTAssertTrue(a.view.log.contains("CloseNoteBox"))
    }

    func testArrowKeysNudgeTheSelectionByOnePixelOrTenWithShiftUnlessSomethingIsDrawn() {
        let a = Layer().selected()
        XCTAssertTrue(a.press(.right))
        XCTAssertEqual(a.state.sel, CGRect(x: 201, y: 200, width: 400, height: 300))
        XCTAssertTrue(a.press(.down, [.shift]))
        XCTAssertEqual(a.state.sel, CGRect(x: 201, y: 210, width: 400, height: 300))
        XCTAssertTrue(a.press(.left, [.shift]))
        XCTAssertTrue(a.press(.up))
        XCTAssertEqual(a.state.sel, CGRect(x: 191, y: 209, width: 400, height: 300))
        // With something drawn the selection is locked: the key is still taken, nothing moves
        a.press(.n)
        a.view.noteDraft = "整体"
        a.state.commitNote()
        XCTAssertTrue(a.press(.right))
        XCTAssertEqual(a.state.sel, CGRect(x: 191, y: 209, width: 400, height: 300))
    }

    func testLetterKeysPickToolsByTheirPlaceAndCommandCFinishes() {
        let a = Layer().selected()
        let tools: [(OverlayKey, Tool)] = [(.r, .rect), (.o, .ellipse), (.a, .arrow), (.b, .pen), (.m, .mosaic), (.t, .text), (.c, .note)]
        for (key, tool) in tools {
            XCTAssertTrue(a.press(key), "\(key)")
            XCTAssertEqual(a.state.tool, tool, "\(key)")
        }
        // Pressing the same key again stays on the tool (a shortcut always selects)
        a.press(.r)
        a.press(.r)
        XCTAssertEqual(a.state.tool, .rect)
        XCTAssertTrue(a.press(.c, [.command]))
        XCTAssertEqual(a.host.log, ["Finish"])
        XCTAssertEqual(a.state.tool, .rect)
        XCTAssertTrue(a.press(.enter))
        XCTAssertEqual(a.host.log, ["Finish", "Finish"])
        // Without a selection the tool keys are not taken
        let b = Layer()
        XCTAssertFalse(b.press(.r))
        XCTAssertFalse(b.press(.n))
        XCTAssertFalse(b.press(.digit(2)))
    }

    // MARK: One note with several places (docs/adr/0009-several-places.md)

    func testWithTheNoteBoxOpenMoreClicksAddPlacesUnderTheSameNumberTheBoxStaysOpenAndRepeatedClicksOnOnePlaceDoNotStack() throws {
        let a = Layer().selected()
        a.state.chooseTool(.note)
        a.click(300, 300)
        let lead = try XCTUnwrap(a.state.noteFor)
        a.view.noteDraft = "这几个按钮都改圆角"
        a.view.log.removeAll()
        XCTAssertFalse(a.down(400, 300))  // a plain click does not capture the mouse
        a.click(500, 300)
        a.click(501, 301)  // almost the same point as the previous place: does not stack
        XCTAssertTrue(a.state.noteOpen)
        XCTAssertIdentical(a.state.noteFor, lead)
        XCTAssertEqual(a.state.notePlaces, 3)
        XCTAssertEqual(a.state.marks.count, 3)
        for m in a.state.marks.dropFirst() { XCTAssertIdentical(m.lead, lead) }
        XCTAssertEqual(a.view.log.filter { $0 == "ShowNotePlaces" }.count, 2)
        XCTAssertFalse(a.view.log.contains("CloseNoteBox"))
        XCTAssertEqual(a.view.noteDraft, "这几个按钮都改圆角")

        XCTAssertTrue(a.state.noteKey(.enter, []))
        XCTAssertEqual(a.state.marks.map { $0.number }, [1, 0, 0])
        for m in a.state.marks { XCTAssertEqual(m.head.number, 1) }  // all are drawn as 1
        XCTAssertEqual(lead.note, "这几个按钮都改圆角")
    }

    func testWithTheBoxOpenARectangleDrawnAfterSwitchingToolBelongsToTheNoteAndAClickOutsideOrWithoutADragFinishesIt() {
        let a = Layer().selected()
        a.state.chooseTool(.note)
        a.click(300, 300)
        a.view.noteDraft = "一样的意见"
        a.state.chooseTool(.rect)  // switch to Rectangle: the box stays open
        XCTAssertTrue(a.state.noteOpen)
        XCTAssertTrue(a.down(350, 350))
        a.state.moveTo(CGPoint(x: 420, y: 420), shift: false)
        a.up()
        XCTAssertEqual(a.state.notePlaces, 2)
        XCTAssertTrue(a.state.noteOpen)
        // With Rectangle selected, a click inside the selection without a drag: as before, clicking elsewhere means done writing
        a.click(450, 450)
        XCTAssertFalse(a.state.noteOpen)
        XCTAssertEqual(a.state.marks[0].number, 1)
        XCTAssertIdentical(a.state.marks[1].lead, a.state.marks[0])

        // Pixelate does not mark a position: switching to it finishes the note first (as before)
        a.click(a.state.marks[0].points[0].x, a.state.marks[0].points[0].y)  // click the number: edits this note
        XCTAssertTrue(a.state.noteOpen)
        a.state.chooseTool(.mosaic)
        XCTAssertFalse(a.state.noteOpen)

        // A click outside the selection: done writing, no extra place
        a.state.chooseTool(.note)
        a.click(560, 460)
        a.view.noteDraft = "第二条"
        a.click(700, 600)
        XCTAssertFalse(a.state.noteOpen)
        XCTAssertEqual(a.state.marks.map { $0.number }, [1, 0, 2])
    }

    func testUndoAndOptionZRemoveTheLastAddedPlaceAndOnlyUndoCancelsTheNoteOnceNoneAreLeftWhileOptionZThenDoesNothing() {
        let a = Layer().selected()
        a.state.chooseTool(.note)
        a.click(300, 300)
        a.click(400, 300)
        a.click(500, 300)
        XCTAssertTrue(a.state.noteKey(.z, [.option]))
        XCTAssertEqual(a.state.notePlaces, 2)
        a.state.undo()
        XCTAssertEqual(a.state.notePlaces, 1)
        XCTAssertTrue(a.state.noteKey(.z, [.option]))  // only the first place is left: the key is swallowed and nothing is cancelled
        XCTAssertTrue(a.state.noteOpen)
        a.state.undo()  // undo again: cancels the note (the new number pin is removed)
        XCTAssertFalse(a.state.noteOpen)
        XCTAssertTrue(a.state.marks.isEmpty)
    }

    func testEscRemovesThePlacesAddedWhileEditingAndSavingASavedNoteEmptyDeletesItWithAllItsPlacesUntilUndone() throws {
        let a = Layer().selected()
        a.state.chooseTool(.rect)
        a.drag(from: (250, 250), to: (300, 300))
        a.state.chooseTool(.note)
        a.click(400, 300)
        a.view.noteDraft = "两处"
        a.state.commitNote()
        XCTAssertEqual(a.state.marks.count, 2)
        let rect = a.state.marks[0]

        // Edit this note: click one more place, then Esc: what was added now is removed, the original two places remain and the text is
        // unchanged
        let badge = MarkPainter.badgeCenter(rect, keepInside: a.state.keep)
        a.click(badge.x, badge.y)
        XCTAssertIdentical(a.state.noteFor, rect)
        a.click(500, 400)
        XCTAssertEqual(a.state.notePlaces, 3)
        XCTAssertTrue(a.state.noteKey(.escape, []))
        XCTAssertEqual(a.state.marks.count, 2)
        XCTAssertEqual(rect.note, "两处")

        // Click the number of the place that was added afterwards: that edits this note too
        let pin = a.state.marks[1]
        let pinBadge = MarkPainter.badgeCenter(pin, keepInside: a.state.keep)
        a.click(pinBadge.x, pinBadge.y)
        XCTAssertIdentical(a.state.noteFor, rect)
        XCTAssertEqual(a.state.notePlaces, 2)

        // Deleting all the text and saving means dropping the note: the rectangle and the number pin go with it (nothing is left behind on
        // the screenshot)
        a.view.noteDraft = ""
        a.state.commitNote()
        XCTAssertTrue(a.state.marks.isEmpty)
        XCTAssertFalse(a.state.locked)
        // One undo brings back the whole note
        a.state.undo()
        XCTAssertEqual(a.state.marks.count, 2)
        XCTAssertEqual(rect.note, "两处")
        XCTAssertEqual(rect.number, 1)
    }

    // MARK: Marks exist only with a note: leaving a new one unwritten takes its mark away

    func testLeavingANewMarksNoteBoxWithoutWritingTakesTheMarkAway() {
        let ways = [
            "click outside", "click inside", "Esc", "Cancel", "right-click", "Return", "switch to Pixelate", "overall comment",
            "double-click to finish",
        ]
        for how in ways {
            for tool in [Tool.rect, .ellipse, .arrow, .pen] {
                let a = Layer().selected()
                a.state.chooseTool(tool)
                a.drag(from: (250, 250), to: (330, 320))
                XCTAssertTrue(a.state.noteOpen, "\(how) \(tool)")
                XCTAssertEqual(a.state.marks.count, 1, "\(how) \(tool)")
                a.view.noteDraft = "  "  // only spaces count as nothing written
                switch how {
                case "click outside": a.click(700, 600)
                case "click inside": a.click(450, 450)
                case "Esc": XCTAssertTrue(a.state.noteKey(.escape, []))
                case "Cancel": a.state.cancelNote()
                case "right-click": a.state.right()
                case "Return": XCTAssertTrue(a.state.noteKey(.enter, []))
                case "switch to Pixelate": a.state.chooseTool(.mosaic)
                case "overall comment": a.state.toggleOverall()
                default: a.down(450, 450, clicks: 2)
                }
                XCTAssertTrue(a.state.marks.isEmpty, "\(how) \(tool)")
                XCTAssertNil(a.state.noteFor, "\(how) \(tool)")
            }
        }
    }

    func testASecondPlaceDrawnIntoANewNoteGoesTooWhenTheNoteIsLeftUnwritten() {
        let a = Layer().selected()
        a.state.chooseTool(.rect)
        a.drag(from: (250, 250), to: (300, 300))
        a.drag(from: (350, 350), to: (420, 420))  // the box is still open: another place of the same note
        XCTAssertEqual(a.state.notePlaces, 2)
        a.click(700, 600)
        XCTAssertTrue(a.state.marks.isEmpty)
        XCTAssertFalse(a.state.locked)  // nothing left, so the selection can be moved and re-selected again
    }

    // MARK: Deleting a picked mark (the toolbar's Delete, delete / forward delete)

    func testDeletingAPlaceKeepsTheNoteUntilItsLastPlaceAndUndoBringsEachBack() throws {
        let a = Layer().selected()
        a.state.chooseTool(.note)
        a.click(300, 300)
        a.click(400, 300)
        a.view.noteDraft = "两处"
        a.state.commitNote()
        let first = a.state.marks[0]
        let second = a.state.marks[1]

        // Clicking the second place opens the note and picks it; Delete takes only that place away and the box stays open
        a.click(400, 300)
        XCTAssertIdentical(a.state.picked, second)
        a.state.deletePicked()
        XCTAssertTrue(a.state.noteOpen)
        XCTAssertEqual(a.state.notePlaces, 1)
        XCTAssertIdentical(try only(a.state.marks), first)
        XCTAssertTrue(a.view.log.contains("ShowNotePlaces"))  // the title says "1 mark" again and typing continues
        a.state.undo()  // with the box open, undo first brings back what was deleted in it
        XCTAssertEqual(a.state.notePlaces, 2)
        a.click(400, 300)
        a.state.deletePicked()
        XCTAssertTrue(a.state.noteKey(.enter, []))
        XCTAssertEqual(first.number, 1)

        // Deleting the last place deletes the note (the box closes); undo brings back the note, then the place deleted before
        a.click(300, 300)
        XCTAssertIdentical(a.state.picked, first)
        a.state.deletePicked()
        XCTAssertFalse(a.state.noteOpen)
        XCTAssertTrue(a.state.marks.isEmpty)
        XCTAssertFalse(a.state.hasNotes)
        a.state.undo()
        XCTAssertIdentical(try only(a.state.marks), first)
        XCTAssertEqual(first.number, 1)
        XCTAssertEqual(first.note, "两处")
        a.state.undo()
        XCTAssertEqual(a.state.marks.count, 2)
    }

    func testEscInTheBoxBringsBackAPlaceDeletedWhileItWasOpen() {
        let a = Layer().selected()
        a.state.chooseTool(.note)
        a.click(300, 300)
        a.click(400, 300)
        a.view.noteDraft = "两处"
        a.state.commitNote()
        a.click(400, 300)
        a.state.deletePicked()
        XCTAssertEqual(a.state.marks.count, 1)
        XCTAssertTrue(a.state.noteKey(.escape, []))
        XCTAssertEqual(a.state.marks.count, 2)
        XCTAssertEqual(a.state.marks.filter { $0.head.number == 1 }.count, 2)
    }

    func testDeletingANotesFirstPlaceLeavesTheNoteOnTheRestAndFinishingHandsItToTheNextPlace() {
        let a = Layer().selected()
        a.state.chooseTool(.rect)
        a.drag(from: (250, 250), to: (330, 330))
        a.state.chooseTool(.note)
        a.click(450, 400)
        a.view.noteDraft = "改成圆角"
        a.state.commitNote()
        a.state.chooseTool(.rect)
        a.drag(from: (480, 250), to: (560, 330))  // a second note, so the numbers are 1 and 2
        a.view.noteDraft = "第二条"
        a.state.commitNote()
        let rect = a.state.marks[0]
        let pin = a.state.marks[1]
        let other = a.state.marks[2]

        a.click(331, 300)  // the rectangle's right edge: a line only picks the rectangle, note 1 stays closed
        XCTAssertIdentical(a.state.picked, rect)
        XCTAssertNil(a.state.noteFor)
        XCTAssertTrue(a.state.press(.delete, []))  // the delete key reaches the overlay, not a note box
        XCTAssertTrue(a.state.marks.elementsEqual([pin, other], by: ===))
        XCTAssertEqual(pin.head.number, 1)  // the pin still shows number 1
        XCTAssertEqual(other.number, 2)

        // What is composited: the pin carries the note now, and the numbers are as shown
        let done = a.state.finished()
        XCTAssertTrue(done.elementsEqual([pin, other], by: ===))
        XCTAssertNil(pin.lead)
        XCTAssertEqual(pin.note, "改成圆角")
        XCTAssertEqual(pin.number, 1)
    }

    func testWithoutABoxDeleteAndForwardDeleteDeleteThePickedTextAndNothingHappensWhenNothingIsPicked() throws {
        let a = Layer().selected()
        a.state.chooseTool(.text)
        a.click(300, 300)
        a.view.textDraft = "甲"
        XCTAssertTrue(a.state.textKey(.escape))
        a.click(400, 400)
        a.view.textDraft = "乙"
        XCTAssertTrue(a.state.textKey(.escape))
        XCTAssertFalse(a.press(.delete))  // nothing picked: the key is not used
        XCTAssertEqual(a.state.marks.count, 2)
        a.state.chooseTool(.text)  // put the tool down
        a.click(302, 305)
        XCTAssertEqual(a.state.picked?.text, "甲")
        XCTAssertTrue(a.press(.delete))
        XCTAssertEqual(try only(a.state.marks).text, "乙")
        XCTAssertNil(a.state.picked)
        a.click(402, 405)
        XCTAssertTrue(a.press(.forwardDelete))
        XCTAssertTrue(a.state.marks.isEmpty)
        a.state.undo()
        a.state.undo()
        XCTAssertEqual(a.state.marks.map { $0.text }, ["甲", "乙"])
    }

    func testClickingAMarksLineOnlyPicksItSoDeleteReachesTheOverlayWhileClickingItsNumberOpensTheNote() throws {
        let a = Layer().selected()
        a.state.chooseTool(.rect)
        a.drag(from: (250, 250), to: (330, 330))
        a.view.noteDraft = "改成圆角"
        a.state.commitNote()
        a.state.chooseTool(.rect)  // put the tool down
        let rect = try only(a.state.marks)

        a.click(331, 300)  // the right edge: picked, no note box, so the keys are the overlay's
        XCTAssertIdentical(a.state.picked, rect)
        XCTAssertNil(a.state.noteFor)
        XCTAssertTrue(a.press(.delete))
        XCTAssertTrue(a.state.marks.isEmpty)  // its only place: the note goes with it
        a.state.undo()
        XCTAssertIdentical(try only(a.state.marks), rect)
        XCTAssertEqual(rect.note, "改成圆角")

        let badge = MarkPainter.badgeCenter(rect, keepInside: a.state.keep)  // the number: edit that note
        a.click(badge.x.rounded(), badge.y.rounded())
        XCTAssertIdentical(a.state.noteFor, rect)
        XCTAssertIdentical(a.state.picked, rect)
        XCTAssertFalse(a.press(.delete))  // the box is open: delete edits its text
        XCTAssertIdentical(try only(a.state.marks), rect)
    }

    func testKeys7And8AreBlackAndWhite() {
        let a = Layer().selected()
        XCTAssertTrue(a.press(.digit(7)))
        XCTAssertEqual(a.state.prefs.color, MarkColor(hex: 0x000000))
        XCTAssertTrue(a.press(.keypad(8)))
        XCTAssertEqual(a.state.prefs.color, MarkColor(hex: 0xffffff))
        XCTAssertEqual(ToolPrefs.colors.count, 8)
        XCTAssertEqual(OverlayKey.from(keyCode: 0x1A), .digit(7))
        XCTAssertEqual(OverlayKey.from(keyCode: 0x1C), .digit(8))
        XCTAssertEqual(OverlayKey.from(keyCode: 0x5B), .keypad(8))
        XCTAssertNil(OverlayKey.from(keyCode: 0x19))  // 9: no ninth preset, and the overlay leaves the key alone
    }

    /// The color chosen on the overlay survives a restart only while the Settings color it was chosen over still applies
    func testTheCaptureColorIsKeptOnlyWhileTheSettingItWasChosenOverStillApplies() {
        let prefs = ToolPrefs()
        let orange = ToolPrefs.colors[0]
        let teal = MarkColor(hex: 0x17a998)
        prefs.restore(teal, over: orange)  // kept from the last run, chosen while the setting was orange
        prefs.start(orange)
        XCTAssertEqual(prefs.color, teal)
        XCTAssertEqual(prefs.chosenOverColor, orange)
        prefs.start(ToolPrefs.colors[4])  // the setting has changed since: the setting wins
        XCTAssertEqual(prefs.color, ToolPrefs.colors[4])
        XCTAssertNil(prefs.chosenOverColor)
    }

    // MARK: Clicking a mark changes its color (so a note with several places can refer to them by color)

    func testWithTheNoteBoxOpenClickingOneOfItsPlacesSelectsItAndRecolorsOnlyItWithoutClosingTheBoxOrAddingAPlace() {
        let a = Layer().selected()
        a.state.chooseTool(.note)
        a.click(300, 300)
        a.click(400, 300)
        let first = a.state.marks[0]
        let second = a.state.marks[1]
        a.view.noteDraft = "左边改成 A，黄色那处改成 B"
        a.view.log.removeAll()
        XCTAssertEqual(a.cursorAt(402, 301), .hand)
        a.click(402, 301)  // click the number of the second place
        XCTAssertIdentical(a.state.picked, second)
        XCTAssertTrue(a.state.noteOpen)
        XCTAssertEqual(a.state.notePlaces, 2)
        // clicking the canvas does not take focus from the input box, so none needs returning
        XCTAssertFalse(a.view.log.contains("ShowNotePlaces"))
        a.state.setColor(ToolPrefs.colors[2])
        XCTAssertEqual(second.color, ToolPrefs.colors[2])
        XCTAssertEqual(first.color, ToolPrefs.colors[0])
        XCTAssertEqual(a.state.prefs.color, ToolPrefs.colors[0])  // the color for later drawing is unchanged

        // Click one more place on blank space: the selection is dropped and the new place uses the original color
        a.click(500, 300)
        XCTAssertNil(a.state.picked)
        XCTAssertEqual(a.state.notePlaces, 3)
        XCTAssertEqual(a.state.marks[2].color, ToolPrefs.colors[0])
        XCTAssertTrue(a.state.noteKey(.enter, []))
        XCTAssertEqual(second.color, ToolPrefs.colors[2])
        XCTAssertNil(a.state.picked)

        // The number of another note: with the box open, clicking outside still means done writing, and it is not selected
        a.state.chooseTool(.rect)
        a.drag(from: (250, 400), to: (300, 450))
        XCTAssertEqual(a.cursorAt(300, 300), .tool)
        a.click(300, 300)
        XCTAssertFalse(a.state.noteOpen)
        XCTAssertNil(a.state.picked)
    }

    func testWithoutTheNoteBoxClickingATextSelectsItKeys1To8RecolorItUndoRevertsTheColorFirstAndEscDeselectsFirst() throws {
        // Text is the mark that lives without a note (rectangles, arrows and pen strokes come with one)
        let a = Layer().selected()
        a.state.chooseTool(.text)
        a.click(300, 300)
        a.view.textDraft = "甲"
        XCTAssertTrue(a.state.textKey(.escape))
        a.click(400, 400)
        a.view.textDraft = "乙"
        XCTAssertTrue(a.state.textKey(.escape))
        let text = a.state.marks[0]
        XCTAssertEqual(a.cursorAt(305, 305), .hand)
        XCTAssertEqual(a.cursorAt(500, 300), .tool)  // blank space: a new mark is drawn as usual
        XCTAssertFalse(a.down(305, 305))
        a.up()
        XCTAssertIdentical(a.state.picked, text)
        XCTAssertFalse(a.state.noteOpen)  // a mark without a note is only selected
        XCTAssertTrue(a.press(.digit(5)))
        XCTAssertEqual(text.color, ToolPrefs.colors[4])
        XCTAssertTrue(a.press(.keypad(2)))
        XCTAssertEqual(text.color, ToolPrefs.colors[1])
        XCTAssertFalse(a.press(.digit(3), [.command]))  // with ⌘ it is not a color change
        XCTAssertEqual(a.state.prefs.color, ToolPrefs.colors[0])

        // Undo goes one step at a time: the last action was a color change, so it is reverted first; the next undo removes the text written
        // last
        a.state.undo()
        XCTAssertEqual(text.color, ToolPrefs.colors[4])
        a.state.undo()
        XCTAssertEqual(text.color, ToolPrefs.colors[0])
        XCTAssertEqual(a.state.marks.count, 2)
        a.state.undo()
        XCTAssertIdentical(try only(a.state.marks), text)
        XCTAssertIdentical(a.state.picked, text)

        // Esc: first deselects without cancelling the capture; pressing it again cancels
        XCTAssertTrue(a.press(.escape))
        XCTAssertNil(a.state.picked)
        XCTAssertTrue(a.host.log.isEmpty)
        // With nothing selected, 1–8 set the color for later drawing
        XCTAssertTrue(a.press(.digit(4)))
        XCTAssertEqual(a.state.prefs.color, ToolPrefs.colors[3])
        XCTAssertEqual(text.color, ToolPrefs.colors[0])
        XCTAssertTrue(a.press(.escape))
        XCTAssertEqual(a.host.log, ["RequestCancel"])
    }

    func testClickingAMarksNumberOpensThatNoteAndSelectsThatPlaceAColorChangedInTheBoxIsRevertedByEscAndUndoGoesInOrder() {
        let a = Layer().selected()
        a.state.chooseTool(.note)
        a.click(300, 300)
        a.click(400, 300)
        a.view.noteDraft = "两处"
        a.state.commitNote()
        let first = a.state.marks[0]
        let second = a.state.marks[1]

        // Click the number of the second place: opens this note and selects the second place
        a.click(400, 300)
        XCTAssertIdentical(a.state.noteFor, first)
        XCTAssertIdentical(a.state.picked, second)
        a.state.setColor(ToolPrefs.colors[3])
        XCTAssertTrue(a.state.noteKey(.escape, []))  // discard the change
        XCTAssertEqual(second.color, ToolPrefs.colors[0])
        XCTAssertNil(a.state.picked)

        // Open it again: change the second place's color → add another place → change its color; undo goes backwards in the order done,
        // and only when all are undone is the note cancelled
        a.click(400, 300)
        a.state.setColor(ToolPrefs.colors[3])
        a.click(500, 300)
        let third = a.state.marks[2]
        a.click(500, 300)  // click the place just added: selects it (no second one is stacked)
        XCTAssertIdentical(a.state.picked, third)
        XCTAssertEqual(a.state.notePlaces, 3)
        a.state.setColor(ToolPrefs.colors[4])
        a.state.undo()
        XCTAssertEqual(third.color, ToolPrefs.colors[0])
        a.state.undo()
        XCTAssertEqual(a.state.notePlaces, 2)
        XCTAssertNil(a.state.picked)
        a.state.undo()
        XCTAssertEqual(second.color, ToolPrefs.colors[0])
        XCTAssertTrue(a.state.noteOpen)
        a.state.undo()
        XCTAssertFalse(a.state.noteOpen)
        XCTAssertEqual(first.note, "两处")
        XCTAssertEqual(a.state.marks.count, 2)

        // A saved color change is kept
        a.click(400, 300)
        a.state.setColor(ToolPrefs.colors[1])
        a.state.commitNote()
        XCTAssertEqual(second.color, ToolPrefs.colors[1])
    }

    func testWithTheOverallCommentOpenClickingTheCanvasStillFinishesItWithoutAddingAPlace() {
        let a = Layer().selected()
        a.state.chooseTool(.note)
        a.press(.n)
        XCTAssertTrue(a.state.noteOpen)
        a.view.noteDraft = "整体"
        a.click(300, 300)
        XCTAssertFalse(a.state.noteOpen)
        XCTAssertTrue(a.state.marks.isEmpty)
        XCTAssertEqual(a.state.overall, "整体")
    }
}

/// The overlay's keys on the Mac: found by the key's place on the keyboard, ⌘ and ⌥ standing in for Ctrl and Alt
final class OverlayKeysTests: SnipTestCase {
    func testKeysAreFoundByTheirVirtualKeyCodeNotByTheCharacterTheyType() {
        let cases: [(UInt16, OverlayKey)] = [
            (0x00, .a), (0x0B, .b), (0x08, .c), (0x2E, .m), (0x2D, .n), (0x1F, .o), (0x0F, .r), (0x11, .t), (0x0D, .w), (0x06, .z), (0x2F, .period),
            (0x12, .digit(1)), (0x13, .digit(2)), (0x14, .digit(3)), (0x15, .digit(4)), (0x17, .digit(5)), (0x16, .digit(6)),
            (0x1A, .digit(7)), (0x1C, .digit(8)),
            (0x53, .keypad(1)), (0x54, .keypad(2)), (0x55, .keypad(3)), (0x56, .keypad(4)), (0x57, .keypad(5)), (0x58, .keypad(6)),
            (0x59, .keypad(7)), (0x5B, .keypad(8)),
            (0x7B, .left), (0x7C, .right), (0x7E, .up), (0x7D, .down), (0x24, .enter), (0x4C, .enter), (0x35, .escape),
            (0x33, .delete), (0x75, .forwardDelete),
        ]
        for (code, key) in cases {
            XCTAssertEqual(OverlayKey.from(keyCode: code), key, "key code \(code)")
        }
    }

    func testKeysTheOverlayDoesNotUseAreNotMapped() {
        // Q (so ⌘Q stays with the system), Space, 0, 9, keypad 9, Tab, F4
        for code: UInt16 in [0x0C, 0x31, 0x1D, 0x19, 0x5C, 0x30, 0x76] {
            XCTAssertNil(OverlayKey.from(keyCode: code), "key code \(code)")
        }
    }

    func testDigitAccessorsSeparateTheMainRowFromTheKeypad() {
        XCTAssertEqual(OverlayKey.digit(4).mainRowDigit, 4)
        XCTAssertNil(OverlayKey.digit(4).keypadDigit)
        XCTAssertEqual(OverlayKey.keypad(2).keypadDigit, 2)
        XCTAssertNil(OverlayKey.keypad(2).mainRowDigit)
        XCTAssertNil(OverlayKey.a.mainRowDigit)
    }

    func testModifiersFromAKeyEvent() {
        let flags: NSEvent.ModifierFlags = [.command, .shift, .capsLock]
        let mods = OverlayModifiers(flags)
        XCTAssertTrue(mods.contains(.command))
        XCTAssertTrue(mods.contains(.shift))
        XCTAssertFalse(mods.contains(.option))
        XCTAssertFalse(mods.contains(.control))
        XCTAssertFalse(mods.isPlain)
        let none: OverlayModifiers = []
        XCTAssertTrue(none.isPlain)
        // The real Control key is not used by the overlay: it does not make a key press "modified"
        XCTAssertTrue(OverlayModifiers(NSEvent.ModifierFlags.control).isPlain)
    }
}
