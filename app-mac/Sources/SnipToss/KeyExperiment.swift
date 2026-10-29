import AppKit
import WebKit

/// Two questions about keys with ⌘ in a WKWebView, answered on the machine that runs the smoke run (SNIPTOSS_SMOKE_READY=keys):
/// 1. Do ⌘A, ⌘C and ⌘V work in a text box, with and without the standard Edit menu in the main menu?
/// 2. When a key has both a page handler and a menu item with the same key, which one runs first, and does the page's preventDefault
///    keep the menu from running?
/// Keys are posted the way the system posts them (`NSApp.sendEvent`), so they take the same route through the window, the web view and the
/// main menu. The answers go into result.json as `keyExperiment`
final class KeyExperiment: NSObject {
    private let window: NSWindow
    private let web: WKWebView
    private var menuFired = 0
    private var report: [String: Any] = [:]

    init(window: NSWindow, web: WKWebView) {
        self.window = window
        self.web = web
    }

    @objc private func probeFired(_ sender: Any?) {
        menuFired += 1
    }

    func run(done: @escaping ([String: Any]) -> Void) {
        let hasMenu = NSApp.mainMenu != nil
        let hasEdit = NSApp.mainMenu?.items.contains { $0.submenu?.title == "Edit" } ?? false
        report["keyWindow"] = NSApp.keyWindow === window
        report["appActive"] = NSApp.isActive
        report["mainMenu"] = hasMenu
        report["editMenu"] = hasEdit
        // A menu item with ⌘B, only when there is a main menu to put it in (the run without one asks question 1 only)
        if let bar = NSApp.mainMenu {
            let probe = NSMenu(title: "Probe")
            let item = NSMenuItem(title: "Probe", action: #selector(probeFired(_:)), keyEquivalent: "b")
            item.target = self
            probe.addItem(item)
            let top = NSMenuItem()
            top.submenu = probe
            bar.addItem(top)
        }

        web.evaluateJavaScript(Scripts.setup) { [self] _, _ in
            step("selectAll") { [self] in
                key("a", code: 0)
            } read: { [self] next in
                eval(Scripts.readSelection) { [self] value in
                    report["selectAll"] = ["selection": value ?? "?", "expected": "0-11"]
                    next()
                }
            } then: { [self] in
                step("copy") { [self] in
                    key("c", code: 8)
                } read: { [self] next in
                    report["copy"] = ["pasteboard": NSPasteboard.general.string(forType: .string) ?? "(none)", "expected": "hello world"]
                    next()
                } then: { [self] in
                    eval(Scripts.focusB) { [self] _ in
                        step("paste") { [self] in
                            key("v", code: 9)
                        } read: { [self] next in
                            eval(Scripts.readB) { [self] value in
                                report["paste"] = ["value": value ?? "?", "expected": "hello world"]
                                next()
                            }
                        } then: { [self] in
                            order(done: done)
                        }
                    }
                }
            }
        }
    }

    // MARK: Question 2

    /// ⌘B with the page doing nothing about it, then with the page calling preventDefault
    private func order(done: @escaping ([String: Any]) -> Void) {
        guard NSApp.mainMenu != nil else {
            done(report)
            return
        }
        eval(Scripts.blurB) { [self] _ in
            menuFired = 0
            step("orderPlain") { [self] in
                key("b", code: 11)
            } read: { [self] next in
                eval(Scripts.readKeys) { [self] keys in
                    report["orderPageIgnores"] = ["pageKeydowns": keys ?? "?", "menuFired": menuFired]
                    next()
                }
            } then: { [self] in
                eval(Scripts.preventB) { [self] _ in
                    menuFired = 0
                    step("orderPrevented") { [self] in
                        key("b", code: 11)
                    } read: { [self] next in
                        eval(Scripts.readKeys) { [self] keys in
                            report["orderPagePrevents"] = ["pageKeydowns": keys ?? "?", "menuFired": menuFired]
                            next()
                        }
                    } then: { [self] in
                        aboutSelectAll(done: done)
                    }
                }
            }
        }
    }

    /// The same question with a key that has a standard menu item: with the page calling preventDefault on ⌘A, does the text still get
    /// selected (the menu ran anyway) or not (the page was first and its preventDefault stopped the menu)? And the probe item asked
    /// directly, to tell "the menu item does not fire" from "the key never reached the menu"
    private func aboutSelectAll(done: @escaping ([String: Any]) -> Void) {
        eval(Scripts.resetForSelectAll) { [self] _ in
            step("selectAllPrevented") { [self] in
                key("a", code: 0)
            } read: { [self] next in
                eval(Scripts.readSelectionAndKeys) {
                    [self] value in
                    report["selectAllPagePrevents"] = ["selectionAndKeydowns": value ?? "?", "ifMenuRanAnyway": "0-11", "ifPageFirst": "11-11"]
                    next()
                }
            } then: { [self] in
                menuFired = 0
                var handled = false
                if let event = makeEvent(.keyDown, "b", code: 11) { handled = NSApp.mainMenu?.performKeyEquivalent(with: event) ?? false }
                report["probeAskedDirectly"] = ["handled": handled, "menuFired": menuFired]
                done(report)
            }
        }
    }

    // MARK: Plumbing

    /// Runs `act`, waits for the key to take effect, runs `read` (which calls `next` when it has read), then `then`
    private func step(_ name: String, act: () -> Void, read: @escaping (@escaping () -> Void) -> Void, then: @escaping () -> Void) {
        act()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
            read { then() }
        }
    }

    private func eval(_ script: String, _ done: @escaping (String?) -> Void) {
        web.evaluateJavaScript(script) { result, _ in
            if let text = result as? String { done(text) } else if let result { done("\(result)") } else { done(nil) }
        }
    }

    private func makeEvent(_ type: NSEvent.EventType, _ chars: String, code: UInt16) -> NSEvent? {
        NSEvent.keyEvent(
            with: type, location: .zero, modifierFlags: [.command], timestamp: ProcessInfo.processInfo.systemUptime,
            windowNumber: window.windowNumber, context: nil, characters: chars, charactersIgnoringModifiers: chars, isARepeat: false,
            keyCode: code)
    }

    /// A ⌘ key press and release, posted to the app the way the system posts one
    private func key(_ chars: String, code: UInt16) {
        for type in [NSEvent.EventType.keyDown, .keyUp] {
            if let event = makeEvent(type, chars, code: code) { NSApp.sendEvent(event) }
        }
    }
}

extension KeyExperiment {
    /// Every script the experiment sends to the page. One place so that a unit test can check that each one parses: a quote slipped out
    /// of one of them twice, and the experiment then ran against a page that had thrown a syntax error
    enum Scripts {
        static let setup = """
            (() => {
              document.body.insertAdjacentHTML('beforeend',
                '<textarea id="probe-a" style="position:fixed;left:8px;top:8px;width:200px;height:40px;z-index:99999"></textarea>' +
                '<textarea id="probe-b" style="position:fixed;left:8px;top:60px;width:200px;height:40px;z-index:99999"></textarea>');
              document.getElementById('probe-a').value = 'hello world';
              window.__keys = [];
              window.__prevent = '';
              window.addEventListener('keydown', (e) => {
                window.__keys.push(e.key + (e.metaKey ? ' meta' : ''));
                if (window.__prevent && e.key === window.__prevent) e.preventDefault();
              }, true);
              document.getElementById('probe-a').focus();
              return true;
            })()
            """
        static let readSelection = "(() => { const a = document.getElementById('probe-a'); return a.selectionStart + '-' + a.selectionEnd; })()"
        static let focusB = "document.getElementById('probe-b').focus()"
        static let readB = "document.getElementById('probe-b').value"
        static let blurB = "document.getElementById('probe-b').blur(); document.body.focus(); window.__keys = []; true"
        static let readKeys = "window.__keys.join(',')"
        static let preventB = "window.__keys = []; window.__prevent = 'b'; true"
        static let resetForSelectAll =
            "(() => { const a = document.getElementById('probe-a'); a.focus(); a.setSelectionRange(11, 11); window.__keys = []; window.__prevent = 'a'; return true; })()"
        static let readSelectionAndKeys =
            "(() => { const a = document.getElementById('probe-a'); return a.selectionStart + '-' + a.selectionEnd + ' / ' + window.__keys.join(','); })()"

        static let all = [
            setup, readSelection, focusB, readB, blurB, readKeys, preventB, resetForSelectAll, readSelectionAndKeys,
        ]
    }
}
