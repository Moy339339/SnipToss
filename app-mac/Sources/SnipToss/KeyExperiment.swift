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
        let setup = """
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
        web.evaluateJavaScript(setup) { [self] _, _ in
            step("selectAll") { [self] in
                key("a", code: 0)
            } read: { [self] next in
                eval("(() => { const a = document.getElementById('probe-a'); return a.selectionStart + '-' + a.selectionEnd; })()") { [self] value in
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
                    eval("document.getElementById('probe-b').focus()") { [self] _ in
                        step("paste") { [self] in
                            key("v", code: 9)
                        } read: { [self] next in
                            eval("document.getElementById('probe-b').value") { [self] value in
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
        eval("document.getElementById('probe-b').blur(); document.body.focus(); window.__keys = []; true") { [self] _ in
            menuFired = 0
            step("orderPlain") { [self] in
                key("b", code: 11)
            } read: { [self] next in
                eval("window.__keys.join(',')") { [self] keys in
                    report["orderPageIgnores"] = ["pageKeydowns": keys ?? "?", "menuFired": menuFired]
                    next()
                }
            } then: { [self] in
                eval("window.__keys = []; window.__prevent = 'b'; true") { [self] _ in
                    menuFired = 0
                    step("orderPrevented") { [self] in
                        key("b", code: 11)
                    } read: { [self] next in
                        eval("window.__keys.join(',')") { [self] keys in
                            report["orderPagePrevents"] = ["pageKeydowns": keys ?? "?", "menuFired": menuFired]
                            next()
                        }
                    } then: { [self] in
                        done(report)
                    }
                }
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

    /// A ⌘ key press and release, posted to the app the way the system posts one
    private func key(_ chars: String, code: UInt16) {
        for type in [NSEvent.EventType.keyDown, .keyUp] {
            if let event = NSEvent.keyEvent(
                with: type, location: .zero, modifierFlags: [.command], timestamp: ProcessInfo.processInfo.systemUptime,
                windowNumber: window.windowNumber, context: nil, characters: chars, charactersIgnoringModifiers: chars, isARepeat: false,
                keyCode: code)
            {
                NSApp.sendEvent(event)
            }
        }
    }
}
