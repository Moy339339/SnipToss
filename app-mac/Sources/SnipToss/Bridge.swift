import Foundation
import WebKit

/// A failed bridge call. `code` is the class the UI explains in its own language (docs/host-api.md, "The error code"); nil for the rest
struct BridgeError: Error {
    let message: String
    let code: String?
    init(_ message: String, code: String? = nil) {
        self.message = message
        self.code = code
    }
}

/// One bridge method: parameters in (the decoded JSON, nil when the UI sent none), the reply out (anything JSONSerialization accepts).
/// It runs on a background queue, never on the main thread, so a slow disk (an unreachable network drive) cannot freeze the window.
/// A method that has to touch AppKit hops to the main thread itself (`onMain`)
typealias BridgeMethod = (Any?) throws -> Any?

/// Run `work` on the main thread and wait for it. Only for bridge methods (which run on a background queue), never from the main thread
func onMain<T>(_ work: () -> T) -> T {
    precondition(!Thread.isMainThread, "onMain is for background threads")
    return DispatchQueue.main.sync(execute: work)
}

/// The shell end of the bridge in docs/host-api.md: `{ id, method, params }` in, `{ id, result }` or `{ id, error, code }` out,
/// plus events the shell pushes by itself (`{ event, ...payload }`)
final class BridgeHost: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?
    private var methods: [String: BridgeMethod] = [:]
    /// Calls run concurrently: one slow call does not hold up the rest. Methods that write guard their own state with locks
    private let queue = DispatchQueue(label: "snip.bridge", qos: .userInitiated, attributes: .concurrent)
    private let recordLock = NSLock()
    private var recordedCalls: [String] = []
    private var recordedUnhandled: [String] = []
    private var recordedPageLogs: [String] = []

    /// Method names in the order the UI called them, and the ones nobody implements (the smoke run reports both)
    var calls: [String] { recordLock.withLock { recordedCalls } }
    var unhandled: [String] { recordLock.withLock { recordedUnhandled } }
    /// What the UI reported through the `log` method (its own errors, blocked-by-CSP notices); the smoke run reports it too
    var pageLogs: [String] { recordLock.withLock { recordedPageLogs } }

    func addPageLog(_ line: String) {
        recordLock.withLock { recordedPageLogs.append(line) }
    }

    /// Register before the page loads; the table is read-only afterwards
    func register(_ name: String, _ method: @escaping BridgeMethod) {
        methods[name] = method
    }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        // Only the app's own page may talk to the shell
        guard message.frameInfo.isMainFrame, let url = message.frameInfo.request.url, url.scheme == uiScheme, url.host == uiHost else {
            Log.info("bridge: message from a page that is not the app's own UI was dropped")
            return
        }
        guard let body = message.body as? [String: Any], let id = body["id"] as? Int, let method = body["method"] as? String else {
            Log.info("bridge: malformed message dropped")
            return
        }
        recordLock.withLock { recordedCalls.append(method) }
        guard let handler = methods[method] else {
            recordLock.withLock { recordedUnhandled.append(method) }
            reply(["id": id, "error": "not implemented: \(method)"])
            return
        }
        let params = body["params"]
        queue.async { [self] in
            do {
                let result = try handler(params)
                reply(["id": id, "result": result ?? NSNull()])
            } catch let e as BridgeError {
                Log.info("bridge: \(method) refused: \(e.message)")
                reply(["id": id, "error": e.message, "code": e.code ?? NSNull()])
            } catch {
                Log.error("bridge: \(method) failed: \(error)")
                reply(["id": id, "error": "\(error)", "code": NSNull()])
            }
        }
    }

    /// Push an event to the UI (`libraryChanged`, `annotationsChanged`, ...). Safe from any thread
    func emit(_ event: String, _ payload: [String: Any] = [:]) {
        var message = payload
        message["event"] = event
        reply(message)
    }

    /// Safe from any thread: the page is only touched on the main thread
    private func reply(_ message: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(message), let data = try? JSONSerialization.data(withJSONObject: message),
            let json = String(data: data, encoding: .utf8)
        else {
            Log.error("bridge: a reply could not be encoded")
            return
        }
        DispatchQueue.main.async { [weak self] in
            self?.webView?.evaluateJavaScript("window.__sniptoss && window.__sniptoss.receive(\(json))", completionHandler: nil)
        }
    }
}
