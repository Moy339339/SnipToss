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

/// One bridge method: parameters in (the decoded JSON, nil when the UI sent none), the reply out (anything JSONSerialization accepts)
typealias BridgeMethod = (Any?) throws -> Any?

/// The shell end of the bridge in docs/host-api.md: `{ id, method, params }` in, `{ id, result }` or `{ id, error, code }` out,
/// plus events the shell pushes by itself (`{ event, ...payload }`)
final class BridgeHost: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?
    private var methods: [String: BridgeMethod] = [:]
    /// Method names in the order the UI called them, and the ones nobody implements (the smoke run reports both)
    private(set) var calls: [String] = []
    private(set) var unhandled: [String] = []
    /// What the UI reported through the `log` method (its own errors, blocked-by-CSP notices); the smoke run reports it too
    var pageLogs: [String] = []

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
        calls.append(method)
        guard let handler = methods[method] else {
            unhandled.append(method)
            reply(["id": id, "error": "not implemented: \(method)"])
            return
        }
        do {
            let result = try handler(body["params"])
            reply(["id": id, "result": result ?? NSNull()])
        } catch let e as BridgeError {
            reply(["id": id, "error": e.message, "code": e.code ?? NSNull()])
        } catch {
            Log.error("bridge: \(method) failed: \(error)")
            reply(["id": id, "error": "\(error)"])
        }
    }

    /// Push an event to the UI (`libraryChanged`, `annotationsChanged`, ...)
    func emit(_ event: String, _ payload: [String: Any] = [:]) {
        var message = payload
        message["event"] = event
        reply(message)
    }

    private func reply(_ message: [String: Any]) {
        guard let webView, JSONSerialization.isValidJSONObject(message),
            let data = try? JSONSerialization.data(withJSONObject: message), let json = String(data: data, encoding: .utf8)
        else {
            Log.error("bridge: a reply could not be encoded or the page is gone")
            return
        }
        webView.evaluateJavaScript("window.__sniptoss && window.__sniptoss.receive(\(json))", completionHandler: nil)
    }
}
