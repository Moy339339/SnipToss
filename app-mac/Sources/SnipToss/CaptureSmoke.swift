import AppKit

/// The capture smoke run (SNIPTOSS_SMOKE_READY=capture): the layers are put over the screens with a made-up pattern as the picture, what
/// they are is written into result.json, and they are drawn to pictures. Nothing real is ever captured here. The mouse and the keyboard
/// are events posted into the app's queue, so they go the way the real ones go (hit testing, the key window, the input boxes)
enum CaptureSmoke {
    /// The made-up pattern needs no permission: the run says it has one, so the layers open without asking the system
    struct Access: ScreenAccess {
        var allowed: Bool { true }
        func request() {}
        func openSettings() {}
    }

    /// What would go on the clipboard and into the notices: recorded, so the runner's clipboard is left alone and the run can check them
    static let clipboard = RecordingCaptureClipboard()
    static let notices = RecordingCaptureNotices()

    static func source() -> PatternScreenSource {
        let screens = NSScreen.screens.map { screen in
            PatternScreenSource.Screen(displayID: ScreenID.of(screen), frame: screen.frame, scale: screen.backingScaleFactor)
        }
        // A run without a screen still makes a layer, on a screen that is made up
        var source = PatternScreenSource(
            screens: screens.isEmpty ? [PatternScreenSource.Screen(displayID: 0, frame: CGRect(x: 0, y: 0, width: 800, height: 600), scale: 1)] : screens)
        // One made-up window in the middle of the main screen (30–70 %), for hovering and clicking a window
        let main = source.screens[0].frame
        source.windowRects = [CGRect(x: main.width * 0.3, y: main.height * 0.3, width: main.width * 0.4, height: main.height * 0.4)]
        return source
    }

    /// Opens the layers, describes them, then presses Esc the way the keyboard would (to the key window) and checks that the capture
    /// ended; `close()` is the fallback when it did not. Then a right click ends a second capture, a third is started with another program
    /// in front, and the fourth goes through the main line
    static func run(session: CaptureSession, outDir: URL, done: @escaping ([String: Any]) -> Void) {
        var report: [String: Any] = ["screens": NSScreen.screens.count]
        var closedCalls = 0
        session.start(whenClosed: { closedCalls += 1 })
        wait(tries: 50, until: { session.isOpen }) { opened in
            report["opened"] = opened
            guard opened else {
                report["whenClosedCalls"] = closedCalls
                return done(report)
            }
            // Let the first frame be drawn
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                let panels = session.overlayPanels
                report["layers"] = panels.enumerated().map { Self.describeLayer($1, index: $0, outDir: outDir) }
                report["appActive"] = NSApp.isActive
                report["keyLayer"] = panels.firstIndex { $0.isKeyWindow } ?? -1
                report["keyWindowIsLayer"] = NSApp.keyWindow is OverlayPanel
                Self.pressKey(53, "\u{1B}")
                Self.wait(tries: 20, until: { !session.isOpen }) { closedByEsc in
                    report["closedByEsc"] = closedByEsc
                    if !closedByEsc { session.close() }
                    report["closed"] = !session.isOpen
                    report["layersAfter"] = session.overlayPanels.count
                    report["whenClosedCalls"] = closedCalls
                    Self.rightClickRound(session) { found in
                        report["rightClick"] = found
                        Self.otherAppInFrontRound(session) { inFront in
                            report["otherAppInFront"] = inFront
                            Self.mainLineRound(session, outDir: outDir) { line in
                                report["mainLine"] = line
                                done(report)
                            }
                        }
                    }
                }
            }
        }
    }

    /// A second capture, ended with a right click in the middle of the first layer, posted the way the mouse sends it
    private static func rightClickRound(_ session: CaptureSession, done: @escaping ([String: Any]) -> Void) {
        var closedCalls = 0
        session.start(whenClosed: { closedCalls += 1 })
        Self.wait(tries: 50, until: { session.isOpen }) { opened in
            guard opened, let panel = session.overlayPanels.first else { return done(["opened": opened]) }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                let middle = CGPoint(x: panel.frame.width / 2, y: panel.frame.height / 2)
                Self.post(.rightMouseDown, at: middle, in: panel)
                Self.post(.rightMouseUp, at: middle, in: panel)
                Self.wait(tries: 20, until: { !session.isOpen }) { closed in
                    if !closed { session.close() }
                    done(["opened": true, "closedByRightClick": closed, "whenClosedCalls": closedCalls])
                }
            }
        }
    }

    /// A third capture started while another program (Finder) is in front, as when the shortcut is pressed in another app: the layer must
    /// still get the keyboard, and Esc must end it
    private static func otherAppInFrontRound(_ session: CaptureSession, done: @escaping ([String: Any]) -> Void) {
        _ = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.finder").first?.activate(options: [])
        Self.wait(tries: 30, until: { !NSApp.isActive }) { otherInFront in
            var report: [String: Any] = ["otherAppWasInFront": otherInFront]
            session.start()
            Self.wait(tries: 50, until: { session.isOpen && session.keyboardRoute != nil }) { known in
                report["opened"] = session.isOpen
                report["keyboardRoute"] = session.keyboardRoute ?? "unknown"
                report["appActive"] = NSApp.isActive
                guard known else {
                    session.close()
                    return done(report)
                }
                Self.pressKey(53, "\u{1B}")
                Self.wait(tries: 20, until: { !session.isOpen }) { closed in
                    if !closed { session.close() }
                    report["closedByEsc"] = closed
                    done(report)
                }
            }
        }
    }

    /// The fourth capture goes the way a user goes, on the first layer: drag out a selection, click Rectangle on the toolbar, draw one,
    /// type a note (one key typed the way the keyboard types it) and click Save; C for the Pin, a click, a note saved with Return; T for
    /// Text, a click, a word ended with Esc; Esc once more only warns (notes were written); a picture of the layer; Finish on the toolbar.
    /// After every step the layer is described
    private static func mainLineRound(_ session: CaptureSession, outDir: URL, done: @escaping ([String: Any]) -> Void) {
        var closedCalls = 0
        session.start(whenClosed: { closedCalls += 1 })
        Self.wait(tries: 50, until: { session.isOpen && session.keyboardRoute != nil }) { opened in
            guard opened, let overlay = session.overlays.first, let panel = overlay.window as? OverlayPanel else {
                session.close()
                return done(["opened": opened])
            }
            let w = overlay.full.width
            let h = overlay.full.height
            func at(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: (w * x).rounded(), y: (h * y).rounded()) }
            var steps: [[String: Any]] = []
            var report: [String: Any] = ["opened": true, "keyboardRoute": session.keyboardRoute ?? "unknown"]
            let actions: [(String, () -> Void)] = [
                ("select", { Self.drag(from: at(0.2, 0.2), to: at(0.7, 0.7), in: panel) }),
                ("rectTool", { Self.click(Self.center(of: "rect", in: overlay), in: panel) }),
                ("drawRect", { Self.drag(from: at(0.3, 0.3), to: at(0.45, 0.45), in: panel) }),
                ("typeNote", {
                    overlay.noteBox.textView.insertText("Make this blue", replacementRange: NSRange(location: NSNotFound, length: 0))
                    Self.pressKey(0x07, "x")
                }),
                ("saveNote", { Self.click(Self.center(of: "note-save", in: overlay), in: panel) }),
                ("pinTool", { Self.pressKey(0x08, "c") }),
                ("placePin", { Self.click(at(0.55, 0.35), in: panel) }),
                ("typePin", {
                    overlay.noteBox.textView.insertText("Remove this", replacementRange: NSRange(location: NSNotFound, length: 0))
                    Self.pressKey(0x24, "\r")
                }),
                ("textTool", { Self.pressKey(0x11, "t") }),
                ("placeText", { Self.click(at(0.35, 0.55), in: panel) }),
                ("typeText", {
                    overlay.textBox.textView.insertText("Hi", replacementRange: NSRange(location: NSNotFound, length: 0))
                    Self.pressKey(53, "\u{1B}")
                }),
                ("escapeWarns", { Self.pressKey(53, "\u{1B}") }),
                ("picture", {
                    if let png = overlay.render()?.representation(using: .png, properties: [:]) {
                        try? png.write(to: outDir.appendingPathComponent("capture-main.png"))
                        report["picture"] = "capture-main.png"
                    }
                }),
                ("finish", { Self.click(Self.center(of: "done", in: overlay), in: panel) }),
            ]
            func run(_ i: Int) {
                if i == actions.count || !session.isOpen && i < actions.count - 1 {
                    Self.wait(tries: 20, until: { !session.isOpen }) { closed in
                        if !closed { session.close() }
                        report["steps"] = steps
                        report["closed"] = closed
                        report["whenClosedCalls"] = closedCalls
                        if let r = session.lastResult {
                            let result: [String: Any] = [
                                "selection": [
                                    Int((r.selection.width * r.screen.scale).rounded()), Int((r.selection.height * r.screen.scale).rounded()),
                                ],
                                "marks": r.marks.map { Self.describeMark($0) }, "overall": r.overall,
                            ]
                            report["result"] = result
                        }
                        // What finishing handed over: the composited picture (kept next to the result for a look), the saved file, the
                        // clipboard and the notice
                        if let out = session.lastOutput {
                            try? out.png.write(to: outDir.appendingPathComponent("capture-composed.png"))
                            let file = session.lastFile ?? ""
                            let output: [String: Any] = [
                                "size": [out.size.width, out.size.height], "file": (file as NSString).lastPathComponent,
                                "fileSaved": !file.isEmpty && FileManager.default.fileExists(atPath: file),
                                "clipboardPuts": Self.clipboard.puts, "clipboardPngBytes": Self.clipboard.png?.count ?? 0,
                                "clipboardHasTiff": Self.clipboard.tiff != nil, "clipboardText": Self.clipboard.text.map { $0 as Any } ?? NSNull(),
                                "notices": Self.notices.shown.map { ["kind": $0.kind, "title": $0.title, "detail": $0.detail] },
                            ]
                            report["output"] = output
                        }
                        done(report)
                    }
                    return
                }
                let (name, act) = actions[i]
                act()
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) {
                    var step = Self.describe(overlay)
                    step["step"] = name
                    step["open"] = session.isOpen
                    steps.append(step)
                    run(i + 1)
                }
            }
            run(0)
        }
    }

    // MARK: Posting input

    /// A mouse event at a point of the layer (y pointing down), posted into the app's queue for the layer's window
    static func post(_ type: NSEvent.EventType, at p: CGPoint, in panel: NSPanel, flags: NSEvent.ModifierFlags = []) {
        let location = CGPoint(x: p.x, y: panel.frame.height - p.y)
        let pressure: Float = type == .leftMouseUp || type == .rightMouseUp ? 0 : 1
        if let event = NSEvent.mouseEvent(
            with: type, location: location, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: panel.windowNumber,
            context: nil, eventNumber: 0, clickCount: 1, pressure: pressure)
        {
            NSApp.postEvent(event, atStart: false)
        }
    }

    static func click(_ p: CGPoint?, in panel: NSPanel) {
        guard let p else { return }
        post(.leftMouseDown, at: p, in: panel)
        post(.leftMouseUp, at: p, in: panel)
    }

    static func drag(from a: CGPoint, to b: CGPoint, steps: Int = 8, in panel: NSPanel) {
        post(.leftMouseDown, at: a, in: panel)
        for i in 1...steps {
            let t = CGFloat(i) / CGFloat(steps)
            post(.leftMouseDragged, at: CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t), in: panel)
        }
        post(.leftMouseUp, at: b, in: panel)
    }

    /// A key as the keyboard sends it: into the app's queue, from where it goes to the key window and its first responder
    static func pressKey(_ code: UInt16, _ characters: String, flags: NSEvent.ModifierFlags = []) {
        let window = NSApp.keyWindow?.windowNumber ?? 0
        for type in [NSEvent.EventType.keyDown, .keyUp] {
            if let event = NSEvent.keyEvent(
                with: type, location: .zero, modifierFlags: flags, timestamp: ProcessInfo.processInfo.systemUptime, windowNumber: window,
                context: nil, characters: characters, charactersIgnoringModifiers: characters, isARepeat: false, keyCode: code)
            {
                NSApp.postEvent(event, atStart: false)
            }
        }
    }

    /// The middle of a visible button of the layer, by its id
    static func center(of id: String, in overlay: CaptureOverlay) -> CGPoint? {
        guard let b = buttons(in: overlay).first(where: { $0.id == id }) else { return nil }
        let r = b.convert(b.bounds, to: overlay)
        return CGPoint(x: r.midX, y: r.midY)
    }

    private static func buttons(in view: NSView) -> [OverlayButton] {
        var found: [OverlayButton] = []
        for sub in view.subviews where !sub.isHidden {
            if let b = sub as? OverlayButton { found.append(b) }
            found += buttons(in: sub)
        }
        return found
    }

    // MARK: Describing

    private static func rect(_ r: CGRect?) -> Any {
        guard let r else { return NSNull() }
        return [Double(r.minX), Double(r.minY), Double(r.width), Double(r.height)]
    }

    static func describeMark(_ m: Mark) -> [String: Any] {
        [
            "kind": "\(m.kind)", "color": m.color.hexText, "size": Double(m.size), "points": m.points.map { [Double($0.x), Double($0.y)] },
            "text": m.text, "note": m.note, "category": m.category, "number": m.head.number, "pending": m.head.pendingNumber,
            "lead": m.lead != nil,
        ]
    }

    /// What the layer is now: the state, the visible parts and buttons, who has the keyboard
    static func describe(_ o: CaptureOverlay) -> [String: Any] {
        guard let s = o.state else { return [:] }
        var d: [String: Any] = [
            "sel": rect(s.sel), "hover": rect(s.hover), "shown": rect(s.shown), "tool": "\(s.tool)", "color": s.prefs.color.hexText,
            "locked": s.locked, "op": "\(s.op)", "cursor": o.cursorName, "handles": s.handlesVisible, "noteOpen": s.noteOpen,
            "textOpen": s.textOpen, "overall": s.overall, "marks": s.marks.map { describeMark($0) },
            "toolbar": o.toolbar.isHidden ? NSNull() as Any : rect(o.toolbar.frame), "subbar": o.subbar.isHidden ? NSNull() as Any : rect(o.subbar.frame),
            "sizeLabel": o.sizeLabel.isHidden ? NSNull() as Any : o.sizeLabel.label.text as Any, "magnifier": !o.magnifier.isHidden,
            "warn": o.warn.isHidden ? NSNull() as Any : o.warn.label.text as Any, "level": o.window?.level.rawValue ?? -1, "key": o.window?.isKeyWindow ?? false,
            "buttons": buttons(in: o).map { $0.id },
        ]
        let responder = o.window?.firstResponder
        d["firstResponder"] =
            responder === o ? "overlay" : responder === o.noteBox.textView ? "note" : responder === o.textBox.textView ? "text" : responder.map { "\(type(of: $0))" } ?? "none"
        if s.noteOpen {
            let note: [String: Any] = [
                "title": o.noteBox.title.text, "text": o.noteBox.textView.string, "category": s.noteCategory, "saveEnabled": !o.noteBox.isEmpty,
                "box": rect(o.noteBox.frame),
            ]
            d["note"] = note
        }
        if s.textOpen {
            let text: [String: Any] = ["text": o.textBox.textView.string, "box": rect(o.textBox.frame)]
            d["text"] = text
        }
        return d
    }

    private static func wait(tries: Int, until condition: @escaping () -> Bool, _ done: @escaping (Bool) -> Void) {
        if condition() { return done(true) }
        if tries == 0 { return done(false) }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { Self.wait(tries: tries - 1, until: condition, done) }
    }

    private static func describeLayer(_ panel: OverlayPanel, index: Int, outDir: URL) -> [String: Any] {
        func rect(_ r: CGRect) -> [Double] { [Double(r.minX), Double(r.minY), Double(r.width), Double(r.height)] }
        var info: [String: Any] = [
            "level": panel.level.rawValue, "behavior": panel.collectionBehavior.rawValue,
            "nonactivating": panel.styleMask.contains(.nonactivatingPanel), "borderless": panel.styleMask.contains(.borderless),
            "canBecomeKey": panel.canBecomeKey, "visible": panel.isVisible, "isKey": panel.isKeyWindow, "frame": rect(panel.frame),
            "scale": Double(panel.backingScaleFactor),
            "screenFrame": panel.screen.map { rect($0.frame) } ?? [],
        ]
        guard let overlay = panel.contentView as? CaptureOverlay else { return info }
        info["state"] = describe(overlay)
        if let rep = overlay.render() {
            info["pixels"] = [rep.pixelsWide, rep.pixelsHigh]
            if let png = rep.representation(using: .png, properties: [:]) {
                let name = "capture-overlay-\(index).png"
                try? png.write(to: outDir.appendingPathComponent(name))
                info["picture"] = name
            }
            // Three pixels on the diagonal, a quarter, half and three quarters of the way down: the pattern's color at that place, dimmed by
            // half outside the highlighted part. The colors change along both axes, so a picture drawn upside down or at another scale does
            // not match. A pixel on the highlight's outline or under the size label is left out
            let space = rep.colorSpace
            info["colorSpace"] = space.localizedName ?? "\(space.colorSpaceModel.rawValue)"
            let shown = overlay.state.shown
            info["samples"] = [1, 2, 3].compactMap { quarter -> [String: Any]? in
                let x = rep.pixelsWide * quarter / 4
                let y = rep.pixelsHigh * quarter / 4
                let point = CGPoint(x: CGFloat(x) / overlay.scale, y: CGFloat(y) / overlay.scale)
                if let shown, shown.insetBy(dx: -4, dy: -4).contains(point) && !shown.insetBy(dx: 4, dy: 4).contains(point) { return nil }
                if !overlay.sizeLabel.isHidden && overlay.sizeLabel.frame.insetBy(dx: -2, dy: -2).contains(point) { return nil }
                let lit = shown?.contains(point) ?? false
                guard let actual = rep.colorAt(x: x, y: y)?.usingColorSpace(.sRGB) else { return nil }
                return [
                    "at": [x, y], "lit": lit, "actual": srgb(actual),
                    "expected": Self.expectedColor(PatternScreenSource.color(x: x, y: y), in: space, dimmed: !lit) ?? [],
                ]
            }
        }
        return info
    }

    private static func srgb(_ color: NSColor) -> [Int] {
        [color.redComponent, color.greenComponent, color.blueComponent].map { Int(($0 * 255).rounded()) }
    }

    /// The pattern's color as the layer shows it: matched into the layer's color space (as drawing the picture is), black at half strength
    /// over it there when it is dimmed, and read back in sRGB. The dimming happens in the screen's color space, so the result depends on
    /// the screen's profile; working it out the same way keeps the check independent of it
    static func expectedColor(_ c: (red: UInt8, green: UInt8, blue: UInt8), in space: NSColorSpace, dimmed: Bool) -> [Int]? {
        guard
            let blank = NSBitmapImageRep(
                bitmapDataPlanes: nil, pixelsWide: 1, pixelsHigh: 1, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
            let rep = blank.retagging(with: space), let context = NSGraphicsContext(bitmapImageRep: rep)
        else { return nil }
        let pixel = NSRect(x: 0, y: 0, width: 1, height: 1)
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = context
        NSColor(srgbRed: CGFloat(c.red) / 255, green: CGFloat(c.green) / 255, blue: CGFloat(c.blue) / 255, alpha: 1).setFill()
        pixel.fill()
        if dimmed {
            OverlayStyle.dim.setFill()
            pixel.fill(using: .sourceOver)
        }
        context.flushGraphics()
        NSGraphicsContext.restoreGraphicsState()
        return rep.colorAt(x: 0, y: 0)?.usingColorSpace(.sRGB).map(srgb)
    }
}
