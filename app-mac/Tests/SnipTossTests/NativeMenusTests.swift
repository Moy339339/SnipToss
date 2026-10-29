import AppKit
import XCTest

@testable import SnipToss

/// The page's menus as the shell draws them: the model it receives, the rules for keys and for what a chosen item does, and the NSMenu
/// built from them. No window is needed: menus are plain objects until they are shown
final class NativeMenusTests: XCTestCase {
    // MARK: Fixtures

    private func sc(_ key: String, cmd: Bool = false, alt: Bool = false, shift: Bool = false) -> NativeShortcut {
        NativeShortcut(key: key, cmd: cmd, alt: alt, shift: shift)
    }

    private func item(
        _ id: String, _ label: String, disabled: Bool = false, checked: Bool = false, title: String? = nil, shortcut: NativeShortcut? = nil,
        hintText: String? = nil, role: NativeRole? = nil, swatches: [NativeSwatch]? = nil
    ) -> NativeEntry {
        .item(
            NativeItem(
                id: id, label: label, title: title, disabled: disabled, checked: checked, shortcut: shortcut, hintText: hintText, role: role,
                swatches: swatches))
    }

    private func swatch(_ id: String, _ label: String, _ color: String, key: String? = nil, checked: Bool = false) -> NativeSwatch {
        NativeSwatch(id: id, label: label, color: color, key: key, checked: checked)
    }

    /// The seven menus of the page in their order, each with a few items of the kinds the page has
    private func sevenMenus(_ label: (String) -> String = { $0 }) -> [NativeMenu] {
        [
            NativeMenu(
                label: label("File"),
                entries: [
                    item("0.0", "Add Files…", shortcut: sc("o", cmd: true)),
                    item("0.1", "Add from Clipboard", shortcut: sc("v", cmd: true)),
                    .separator,
                    item("0.3", "Refresh List", shortcut: sc("F5")),
                ]),
            NativeMenu(
                label: label("Edit"),
                entries: [
                    item("1.0", "Undo", disabled: true, shortcut: sc("z", cmd: true), role: .undo),
                    item("1.1", "Redo", shortcut: sc("z", cmd: true, shift: true), role: .redo),
                    .separator,
                    item("1.3", "Uncheck All", hintText: "3 checked"),
                ]),
            NativeMenu(
                label: label("View"),
                entries: [
                    item("2.0", "Fit", checked: true, shortcut: sc("0", cmd: true)),
                    item("2.1", "Next Note", title: "Select the next note", shortcut: sc("]")),
                ]),
            NativeMenu(
                label: label("Annotate"),
                entries: [
                    item("3.0", "Whole-Image Note", shortcut: sc("n")),
                    item(
                        "3.1", "Mark Color",
                        swatches: [
                            swatch("3.1.0", "Red", "#ff3b30", key: "1", checked: true), swatch("3.1.1", "Blue", "#0a84ff", key: "2"),
                        ]),
                ]),
            NativeMenu(label: label("Playback"), entries: [item("4.0", "Play", shortcut: sc("Space"))]),
            NativeMenu(label: label("Window"), entries: [item("5.0", "Minimize", shortcut: sc("m", cmd: true))]),
            NativeMenu(label: label("Help"), entries: [item("6.0", "Keyboard Shortcuts", hintText: "? / F1")]),
        ]
    }

    private func message(_ version: Int = 1, modal: Bool = false, _ menus: [NativeMenu]? = nil) -> MenusMessage {
        MenusMessage(version: version, modal: modal, menus: menus ?? sevenMenus())
    }

    /// What the bar is when the app starts: the app menu and the two stand-ins (MainMenu.build, without the call that needs NSApp)
    private func makeBar() -> NSMenu {
        let bar = NSMenu()
        for title in ["SnipToss", "Edit", "Window"] {
            let top = NSMenuItem()
            top.submenu = NSMenu(title: title)
            bar.addItem(top)
        }
        return bar
    }

    private final class Recorder {
        var events: [(name: String, payload: [String: Any])] = []
        var actions: [Selector] = []
    }

    private func makeMenus(bar: NSMenu? = nil, recorder: Recorder = Recorder()) -> (NativeMenus, NSMenu, Recorder) {
        let bar = bar ?? makeBar()
        let menus = NativeMenus(
            bar: bar, emit: { recorder.events.append(($0, $1)) }, sendToResponder: { recorder.actions.append($0) })
        return (menus, bar, recorder)
    }

    /// The item at `index` of the page's `menu`th menu (0 = File)
    private func pageItem(_ bar: NSMenu, _ menu: Int, _ index: Int) -> NSMenuItem {
        bar.items[1 + menu].submenu!.items[index]
    }

    // MARK: The model arriving as JSON

    private func decode(_ json: String) -> Any? {
        try? JSONSerialization.jsonObject(with: Data(json.utf8))
    }

    func testReadsTheJSONOfASetMenusCall() throws {
        let params = decode(
            """
            { "version": 7, "modal": true, "menus": [
              { "label": "File", "items": [
                { "id": "0.0", "label": "Add Files…", "disabled": false, "checked": false,
                  "shortcut": { "key": "o", "cmd": true, "alt": false, "shift": false } },
                "-",
                { "id": "0.2", "label": "Undo", "disabled": true, "checked": false, "role": "undo", "title": "Undo the last change" },
                { "id": "0.3", "label": "Color", "disabled": false, "checked": false, "hintText": "x",
                  "swatches": [ { "id": "0.3.0", "label": "Red", "color": "#ff0000", "key": "1", "checked": true } ] }
              ] }
            ] }
            """)
        let parsed = try MenusMessage.parse(params)
        XCTAssertEqual(parsed.version, 7)
        XCTAssertTrue(parsed.modal)
        XCTAssertEqual(parsed.menus.count, 1)
        XCTAssertEqual(parsed.menus[0].label, "File")
        let entries = parsed.menus[0].entries
        XCTAssertEqual(entries.count, 4)
        guard case .item(let add) = entries[0], case .item(let undo) = entries[2], case .item(let color) = entries[3] else {
            return XCTFail("the entries are not the items they were sent as")
        }
        XCTAssertEqual(add.shortcut, sc("o", cmd: true))
        XCTAssertEqual(entries[1], .separator)
        XCTAssertEqual(undo.role, .undo)
        XCTAssertTrue(undo.disabled)
        XCTAssertEqual(undo.title, "Undo the last change")
        XCTAssertEqual(color.swatches, [swatch("0.3.0", "Red", "#ff0000", key: "1", checked: true)])
    }

    func testRefusesAMessageThatIsNotTheContract() {
        let bad: [String] = [
            "{ \"menus\": [] }",
            "{ \"version\": 1 }",
            "{ \"version\": 1, \"menus\": [ { \"items\": [] } ] }",
            "{ \"version\": 1, \"menus\": [ { \"label\": \"File\", \"items\": [ \"=\" ] } ] }",
            "{ \"version\": 1, \"menus\": [ { \"label\": \"File\", \"items\": [ { \"label\": \"x\" } ] } ] }",
            "{ \"version\": 1, \"menus\": [ { \"label\": \"File\", \"items\": [ { \"id\": \"0.0\", \"label\": \"x\", "
                + "\"swatches\": [ { \"id\": \"a\", \"label\": \"Red\" } ] } ] } ] }",
        ]
        for json in bad {
            XCTAssertThrowsError(try MenusMessage.parse(decode(json)), json)
        }
        XCTAssertThrowsError(try MenusMessage.parse(nil))
    }

    func testAMissingModalMeansNoDialog() throws {
        let parsed = try MenusMessage.parse(decode("{ \"version\": 1, \"menus\": [] }"))
        XCTAssertFalse(parsed.modal)
    }

    // MARK: Keys

    func testKeyEquivalentsForTheKeyNamesThePageUses() {
        XCTAssertEqual(MenuKeys.keyEquivalent("o"), "o")
        XCTAssertEqual(MenuKeys.keyEquivalent("O"), "o")
        XCTAssertEqual(MenuKeys.keyEquivalent("0"), "0")
        XCTAssertEqual(MenuKeys.keyEquivalent("["), "[")
        XCTAssertEqual(MenuKeys.keyEquivalent("\\"), "\\")
        XCTAssertEqual(MenuKeys.keyEquivalent("ArrowUp"), "\u{F700}")
        XCTAssertEqual(MenuKeys.keyEquivalent("ArrowDown"), "\u{F701}")
        XCTAssertEqual(MenuKeys.keyEquivalent("ArrowLeft"), "\u{F702}")
        XCTAssertEqual(MenuKeys.keyEquivalent("ArrowRight"), "\u{F703}")
        XCTAssertEqual(MenuKeys.keyEquivalent("F1"), "\u{F704}")
        XCTAssertEqual(MenuKeys.keyEquivalent("F5"), "\u{F708}")
        XCTAssertEqual(MenuKeys.keyEquivalent("F11"), "\u{F70E}")
        XCTAssertEqual(MenuKeys.keyEquivalent("Delete"), "\u{F728}")
        XCTAssertEqual(MenuKeys.keyEquivalent("Home"), "\u{F729}")
        XCTAssertEqual(MenuKeys.keyEquivalent("End"), "\u{F72B}")
        XCTAssertEqual(MenuKeys.keyEquivalent("PageUp"), "\u{F72C}")
        XCTAssertEqual(MenuKeys.keyEquivalent("PageDown"), "\u{F72D}")
        XCTAssertEqual(MenuKeys.keyEquivalent("Backspace"), "\u{8}")
        XCTAssertEqual(MenuKeys.keyEquivalent("Enter"), "\r")
        XCTAssertEqual(MenuKeys.keyEquivalent("Escape"), "\u{1B}")
        XCTAssertEqual(MenuKeys.keyEquivalent("Space"), " ")
    }

    func testKeyNamesThatAreNotKeysHaveNoEquivalent() {
        for name in ["", "F0", "F36", "Fn", "Tab2", "ArrowSideways", "ab"] {
            XCTAssertNil(MenuKeys.keyEquivalent(name), name)
        }
    }

    func testOnlyShortcutsThatCannotBeTypedAreRegistered() {
        // Command shortcuts and the function keys
        XCTAssertTrue(MenuKeys.registers(sc("o", cmd: true)))
        XCTAssertTrue(MenuKeys.registers(sc("o", cmd: true, shift: true)))
        XCTAssertTrue(MenuKeys.registers(sc("b", cmd: true, alt: true)))
        XCTAssertTrue(MenuKeys.registers(sc("ArrowUp", cmd: true)))
        XCTAssertTrue(MenuKeys.registers(sc("\\", cmd: true)))
        XCTAssertTrue(MenuKeys.registers(sc("F5")))
        XCTAssertTrue(MenuKeys.registers(sc("F11")))
        // Keys that type a letter, move the caret or delete are the text box's: drawn, not registered
        for plain in ["n", "t", "x", "[", "]", "Enter", "Delete", "Space", "ArrowLeft", "1"] {
            XCTAssertFalse(MenuKeys.registers(sc(plain)), plain)
        }
        XCTAssertFalse(MenuKeys.registers(sc("h", shift: true)))
        XCTAssertFalse(MenuKeys.registers(sc("1", alt: true)))
        XCTAssertFalse(MenuKeys.registers(sc("nothing", cmd: true)))
    }

    func testTheStandardEditKeysAreLeftToTheStandardItems() {
        // The page's "Add from Clipboard" is ⌘V; if it were registered it would be found before Paste and ⌘V would do nothing in a text box
        for key in ["x", "c", "v", "a"] {
            XCTAssertFalse(MenuKeys.registers(sc(key, cmd: true)), key)
            // With another modifier it is a different shortcut
            XCTAssertTrue(MenuKeys.registers(sc(key, cmd: true, shift: true)), key)
        }
    }

    func testModifierMask() {
        XCTAssertEqual(MenuKeys.modifierMask(sc("o", cmd: true)), [.command])
        XCTAssertEqual(MenuKeys.modifierMask(sc("o", cmd: true, shift: true)), [.command, .shift])
        XCTAssertEqual(MenuKeys.modifierMask(sc("b", cmd: true, alt: true)), [.command, .option])
        XCTAssertEqual(MenuKeys.modifierMask(sc("F5")), [])
    }

    func testShortcutsAreWrittenTheWayTheMacWritesThem() {
        XCTAssertEqual(MenuKeys.text(sc("o", cmd: true, shift: true)), "⇧⌘O")
        XCTAssertEqual(MenuKeys.text(sc("b", cmd: true, alt: true)), "⌥⌘B")
        XCTAssertEqual(MenuKeys.text(sc("n")), "N")
        XCTAssertEqual(MenuKeys.text(sc("h", shift: true)), "⇧H")
        XCTAssertEqual(MenuKeys.text(sc("[")), "[")
        XCTAssertEqual(MenuKeys.text(sc("ArrowUp", cmd: true)), "⌘↑")
        XCTAssertEqual(MenuKeys.text(sc("F5")), "F5")
        XCTAssertEqual(MenuKeys.text(sc("Space")), "Space")
        XCTAssertEqual(MenuKeys.text(sc("Enter")), "↩")
        XCTAssertEqual(MenuKeys.text(sc("Delete")), "⌦")
        XCTAssertEqual(MenuKeys.text(sc("v", cmd: true)), "⌘V")
    }

    // MARK: What a chosen item does

    func testAKeyThePageDeclinedDoesNotRunAnything() {
        XCTAssertEqual(MenuPolicy.choice(byKey: true, role: nil), .ignore)
    }

    func testUndoAndRedoByKeyGoToTheTextBox() {
        XCTAssertEqual(MenuPolicy.choice(byKey: true, role: .undo), .textUndo)
        XCTAssertEqual(MenuPolicy.choice(byKey: true, role: .redo), .textRedo)
    }

    func testTheMouseAlwaysTellsThePage() {
        XCTAssertEqual(MenuPolicy.choice(byKey: false, role: nil), .send)
        XCTAssertEqual(MenuPolicy.choice(byKey: false, role: .undo), .send)
        XCTAssertEqual(MenuPolicy.choice(byKey: false, role: .redo), .send)
    }

    // MARK: Colors

    private func components(_ color: NSColor) -> [CGFloat] {
        var r: CGFloat = 0
        var g: CGFloat = 0
        var b: CGFloat = 0
        var a: CGFloat = 0
        color.getRed(&r, green: &g, blue: &b, alpha: &a)
        return [r, g, b, a].map { ($0 * 255).rounded() }
    }

    func testReadsHexColors() {
        XCTAssertEqual(components(SwatchImage.color("#ff3b30")), [255, 59, 48, 255])
        XCTAssertEqual(components(SwatchImage.color("0a84ff")), [10, 132, 255, 255])
        XCTAssertEqual(components(SwatchImage.color("#f80")), [255, 136, 0, 255])
        XCTAssertEqual(components(SwatchImage.color("#11223380")), [17, 34, 51, 128])
    }

    func testAColorThatIsNotHexIsGrey() {
        XCTAssertEqual(SwatchImage.color("red"), NSColor.gray)
        XCTAssertEqual(SwatchImage.color("#12"), NSColor.gray)
        XCTAssertEqual(SwatchImage.color(""), NSColor.gray)
    }

    func testTheSwatchIsADot() {
        let dot = SwatchImage.dot("#ff3b30")
        XCTAssertEqual(dot.size, NSSize(width: 12, height: 12))
        XCTAssertFalse(dot.isTemplate)
    }

    // MARK: Building the bar

    func testThePagesMenusReplaceTheStandIns() {
        let (menus, bar, _) = makeMenus()
        XCTAssertEqual(bar.items.count, 3)
        menus.apply(message())
        // The app menu, then the seven
        XCTAssertEqual(bar.items.count, 8)
        XCTAssertEqual(bar.items[0].submenu?.title, "SnipToss")
        XCTAssertEqual(bar.items.dropFirst().compactMap { $0.submenu?.title }, ["File", "Edit", "View", "Annotate", "Playback", "Window", "Help"])
        XCTAssertEqual(bar.items.dropFirst().map { $0.title }, ["File", "Edit", "View", "Annotate", "Playback", "Window", "Help"])
        XCTAssertEqual(menus.version, 1)
    }

    func testTheEditMenuEndsWithTheStandardItems() throws {
        let (menus, bar, _) = makeMenus()
        menus.apply(message())
        let edit = try XCTUnwrap(bar.items[2].submenu)
        // Undo, Redo, a separator, "Uncheck All" are the page's; then a separator and the four standard items
        XCTAssertEqual(edit.items.count, 4 + 5)
        XCTAssertTrue(edit.items[4].isSeparatorItem)
        let standard = Array(edit.items.suffix(4))
        XCTAssertEqual(standard.map { $0.title }, ["Cut", "Copy", "Paste", "Select All"])
        XCTAssertEqual(
            standard.compactMap { $0.action },
            [#selector(NSText.cut(_:)), #selector(NSText.copy(_:)), #selector(NSText.paste(_:)), #selector(NSText.selectAll(_:))])
        // Sent to whoever has the focus, not to the app
        XCTAssertTrue(standard.allSatisfy { $0.target == nil && $0.isEnabled })
        XCTAssertEqual(standard.map { $0.keyEquivalent }, ["x", "c", "v", "a"])
        // No other menu gets them
        XCTAssertEqual(bar.items[1].submenu?.items.count, 4)
    }

    func testAnItemCarriesWhatTheModelSays() {
        let (menus, bar, _) = makeMenus()
        menus.apply(message())
        let add = pageItem(bar, 0, 0)
        XCTAssertEqual(add.title, "Add Files…")
        XCTAssertEqual(add.keyEquivalent, "o")
        XCTAssertEqual(add.keyEquivalentModifierMask, [.command])
        XCTAssertTrue(add.isEnabled)
        XCTAssertEqual(add.state, .off)
        XCTAssertNil(add.toolTip)
        let fit = pageItem(bar, 2, 0)
        XCTAssertEqual(fit.state, .on)
        XCTAssertEqual(pageItem(bar, 2, 1).toolTip, "Select the next note")
        XCTAssertTrue(pageItem(bar, 0, 2).isSeparatorItem)
    }

    func testAShortcutThatIsNotRegisteredIsWrittenAfterTheTitle() {
        let (menus, bar, _) = makeMenus()
        menus.apply(message())
        for (menu, index, title) in [(2, 1, "Next Note  ]"), (3, 0, "Whole-Image Note  N"), (4, 0, "Play  Space"), (0, 1, "Add from Clipboard  ⌘V")] {
            let shown = pageItem(bar, menu, index)
            XCTAssertEqual(shown.title, title)
            XCTAssertEqual(shown.keyEquivalent, "", title)
        }
        // The function key is registered, so the system draws it
        let refresh = pageItem(bar, 0, 3)
        XCTAssertEqual(refresh.title, "Refresh List")
        XCTAssertEqual(refresh.keyEquivalent, "\u{F708}")
        XCTAssertEqual(refresh.keyEquivalentModifierMask, [])
    }

    func testTextThatIsNotAShortcutIsAddedToTheTitle() {
        let (menus, bar, _) = makeMenus()
        menus.apply(message())
        XCTAssertEqual(pageItem(bar, 1, 3).title, "Uncheck All  3 checked")
        XCTAssertEqual(pageItem(bar, 6, 0).title, "Keyboard Shortcuts  ? / F1")
    }

    func testARowOfChoicesBecomesASubmenu() throws {
        let (menus, bar, _) = makeMenus()
        menus.apply(message())
        let parent = pageItem(bar, 3, 1)
        XCTAssertEqual(parent.title, "Mark Color")
        // AppKit gives an item with a submenu its own action (submenuAction:); the item must not have ours
        XCTAssertTrue(parent.action == nil || NSStringFromSelector(parent.action!) == "submenuAction:")
        let choices = try XCTUnwrap(parent.submenu).items
        XCTAssertEqual(choices.map { $0.title }, ["Red  1", "Blue  2"])
        XCTAssertEqual(choices.map { $0.state }, [.on, .off])
        XCTAssertTrue(choices.allSatisfy { $0.image != nil && $0.isEnabled && $0.action != nil })
    }

    func testAGreyedRowGreysItsChoices() throws {
        var entries = sevenMenus()
        entries[3] = NativeMenu(
            label: "Annotate", entries: [item("3.1", "Mark Color", disabled: true, swatches: [swatch("3.1.0", "Red", "#ff0000")])])
        let (menus, bar, _) = makeMenus()
        menus.apply(message(1, entries))
        let parent = pageItem(bar, 3, 0)
        XCTAssertFalse(parent.isEnabled)
        XCTAssertFalse(try XCTUnwrap(parent.submenu).items[0].isEnabled)
    }

    func testADisabledItemIsGrey() {
        let (menus, bar, _) = makeMenus()
        menus.apply(message())
        // Undo is the exception (below); anything else disabled is grey
        var entries = sevenMenus()
        entries[0] = NativeMenu(label: "File", entries: [item("0.0", "Add Files…", disabled: true)])
        menus.apply(message(2, entries))
        XCTAssertFalse(pageItem(bar, 0, 0).isEnabled)
    }

    func testUndoAndRedoAreNeverGrey() {
        let (menus, bar, _) = makeMenus()
        menus.apply(message())
        // The model has Undo disabled, and with a dialog open everything is: these two stay on, for the text box that may have the caret
        XCTAssertTrue(pageItem(bar, 1, 0).isEnabled)
        menus.apply(message(2, modal: true))
        XCTAssertTrue(pageItem(bar, 1, 0).isEnabled)
        XCTAssertTrue(pageItem(bar, 1, 1).isEnabled)
    }

    func testADialogGreysThePagesItemsButNotTheStandardOnes() throws {
        let (menus, bar, _) = makeMenus()
        menus.apply(message(1, modal: true))
        XCTAssertTrue(menus.modal)
        XCTAssertFalse(pageItem(bar, 0, 0).isEnabled)
        XCTAssertFalse(pageItem(bar, 0, 3).isEnabled)
        XCTAssertFalse(pageItem(bar, 1, 3).isEnabled)
        let choices = try XCTUnwrap(pageItem(bar, 3, 1).submenu).items
        XCTAssertTrue(choices.allSatisfy { !$0.isEnabled })
        let edit = try XCTUnwrap(bar.items[2].submenu)
        XCTAssertTrue(edit.items.suffix(4).allSatisfy { $0.isEnabled })
        // Closing the dialog brings them back
        menus.apply(message(2, modal: false))
        XCTAssertTrue(pageItem(bar, 0, 0).isEnabled)
        XCTAssertTrue(choices.allSatisfy { $0.isEnabled })
    }

    // MARK: Keeping the bar in step

    func testNewStateIsPutOnTheSameItemsNotOnNewOnes() throws {
        let (menus, bar, _) = makeMenus()
        menus.apply(message())
        let before = bar.items.dropFirst().flatMap { $0.submenu?.items ?? [] }
        var entries = sevenMenus()
        entries[0] = NativeMenu(
            label: "File",
            entries: [
                item("0.0", "Add Files…", disabled: true, shortcut: sc("o", cmd: true)),
                item("0.1", "Add from Clipboard", shortcut: sc("v", cmd: true)),
                .separator,
                item("0.3", "Reload List", shortcut: sc("F5")),
            ])
        menus.apply(message(2, entries))
        let after = bar.items.dropFirst().flatMap { $0.submenu?.items ?? [] }
        XCTAssertEqual(before.count, after.count)
        XCTAssertTrue(zip(before, after).allSatisfy { $0 === $1 }, "an open menu must not be rebuilt for a change of state")
        XCTAssertFalse(pageItem(bar, 0, 0).isEnabled)
        XCTAssertEqual(pageItem(bar, 0, 3).title, "Reload List")
    }

    func testAMenuThatChangesShapeIsRebuiltAndKeepsItsStandardItems() throws {
        let (menus, bar, _) = makeMenus()
        menus.apply(message())
        var entries = sevenMenus()
        entries[1] = NativeMenu(label: "Edit", entries: [item("1.0", "Undo", role: .undo), item("1.1", "Redo", role: .redo)])
        menus.apply(message(2, entries))
        let edit = try XCTUnwrap(bar.items[2].submenu)
        XCTAssertEqual(edit.items.count, 2 + 5)
        XCTAssertEqual(edit.items.suffix(4).map { $0.title }, ["Cut", "Copy", "Paste", "Select All"])
    }

    func testTheTitleOfAMenuFollowsTheLanguage() {
        let (menus, bar, _) = makeMenus()
        menus.apply(message())
        menus.apply(message(2, sevenMenus { "\($0)-zh" }))
        XCTAssertEqual(bar.items.dropFirst().map { $0.title }.first, "File-zh")
        XCTAssertEqual(bar.items[1].submenu?.title, "File-zh")
    }

    func testMenusThatAreGoneAreTakenOut() {
        let (menus, bar, _) = makeMenus()
        menus.apply(message())
        menus.apply(message(2, Array(sevenMenus().prefix(5))))
        XCTAssertEqual(bar.items.count, 6)
        menus.apply(message(3))
        XCTAssertEqual(bar.items.count, 8)
    }

    func testAnOlderMessageNeverReplacesANewerOne() {
        let (menus, bar, _) = makeMenus()
        menus.apply(message(5))
        var older = sevenMenus()
        older[0] = NativeMenu(label: "Old", entries: [])
        menus.apply(message(4, older))
        XCTAssertEqual(bar.items[1].title, "File")
        XCTAssertEqual(menus.version, 5)
    }

    func testANewPageStartsCountingAgain() {
        let (menus, bar, _) = makeMenus()
        menus.apply(message(57))
        menus.pageReloading()
        // The menus stay on screen until the new page sends its own
        XCTAssertEqual(bar.items.count, 8)
        var next = sevenMenus()
        next[0] = NativeMenu(label: "Datei", entries: [])
        menus.apply(message(1, next))
        XCTAssertEqual(bar.items[1].title, "Datei")
        XCTAssertEqual(menus.version, 1)
    }

    func testAMenuAddedByAnotherPartOfTheAppIsLeftAlone() {
        let (menus, bar, _) = makeMenus()
        let extra = NSMenuItem()
        extra.submenu = NSMenu(title: "Probe")
        bar.addItem(extra)
        menus.apply(message())
        XCTAssertTrue(bar.items.contains { $0 === extra })
        menus.apply(message(2, Array(sevenMenus().prefix(3))))
        XCTAssertTrue(bar.items.contains { $0 === extra })
        XCTAssertEqual(bar.items.count, 1 + 3 + 1)
    }

    // MARK: A chosen item

    func testChoosingWithTheMouseTellsThePageWithTheVersionOfTheModel() {
        let (menus, bar, recorder) = makeMenus()
        menus.apply(message(7))
        menus.choose(pageItem(bar, 2, 0), byKey: false)
        XCTAssertEqual(recorder.events.count, 1)
        XCTAssertEqual(recorder.events[0].name, "menuCommand")
        XCTAssertEqual(recorder.events[0].payload["id"] as? String, "2.0")
        XCTAssertEqual(recorder.events[0].payload["version"] as? Int, 7)
    }

    func testAnItemSaysTheVersionOfTheLatestModelItWasUpdatedWith() {
        let (menus, bar, recorder) = makeMenus()
        menus.apply(message(1))
        menus.apply(message(2))
        menus.choose(pageItem(bar, 0, 0), byKey: false)
        XCTAssertEqual(recorder.events[0].payload["version"] as? Int, 2)
    }

    func testAChoiceInARowGoesBackWithTheChoicesOwnId() throws {
        let (menus, bar, recorder) = makeMenus()
        menus.apply(message(3))
        menus.choose(try XCTUnwrap(pageItem(bar, 3, 1).submenu).items[1], byKey: false)
        XCTAssertEqual(recorder.events[0].payload["id"] as? String, "3.1.1")
        XCTAssertEqual(recorder.events[0].payload["version"] as? Int, 3)
    }

    func testAKeyThePageLetGoRunsNothing() {
        let (menus, bar, recorder) = makeMenus()
        menus.apply(message())
        menus.choose(pageItem(bar, 0, 0), byKey: true)
        XCTAssertTrue(recorder.events.isEmpty)
        XCTAssertTrue(recorder.actions.isEmpty)
    }

    func testUndoAndRedoByKeyGoToTheWebView() {
        let (menus, bar, recorder) = makeMenus()
        menus.apply(message())
        menus.choose(pageItem(bar, 1, 0), byKey: true)
        menus.choose(pageItem(bar, 1, 1), byKey: true)
        XCTAssertTrue(recorder.events.isEmpty)
        XCTAssertEqual(recorder.actions.map { NSStringFromSelector($0) }, ["undo:", "redo:"])
    }

    func testUndoByMouseIsLeftToThePageWhichLooksAtTheFocus() {
        let (menus, bar, recorder) = makeMenus()
        menus.apply(message(4))
        menus.choose(pageItem(bar, 1, 0), byKey: false)
        XCTAssertTrue(recorder.actions.isEmpty)
        XCTAssertEqual(recorder.events[0].payload["id"] as? String, "1.0")
    }

    func testAnItemThatIsNotOursIsIgnored() {
        let (menus, _, recorder) = makeMenus()
        menus.choose(NSMenuItem(title: "Other", action: nil, keyEquivalent: ""), byKey: false)
        XCTAssertTrue(recorder.events.isEmpty)
    }

    // MARK: The smoke report

    func testTheReportCountsTheStandardItemsByTheirActions() {
        let (menus, bar, _) = makeMenus()
        menus.apply(message())
        let report = MenuReport.describe(bar)
        XCTAssertEqual(report["mainMenu"] as? Bool, true)
        XCTAssertEqual(report["titles"] as? [String], ["SnipToss", "File", "Edit", "View", "Annotate", "Playback", "Window", "Help"])
        XCTAssertEqual(report["standardEditItems"] as? [String], ["cut:", "copy:", "paste:", "selectAll:"])
        XCTAssertGreaterThan(report["withKeyEquivalent"] as? Int ?? 0, 4)
        XCTAssertEqual(MenuReport.describe(nil)["mainMenu"] as? Bool, false)
    }

    func testThePageIsToldTheShellDrawsTheMenus() {
        XCTAssertTrue(bridgeShimScript.contains("nativeMenus: true"))
    }
}
