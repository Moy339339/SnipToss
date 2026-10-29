import Foundation

/// Placeholder answers for the calls the UI makes while it starts that have no real implementation worth a file of their own.
/// A method that is not registered answers "not implemented" (docs/host-api.md)
func installStubMethods(into bridge: BridgeHost) {
    bridge.register("ready") { _ in nil }

    bridge.register("log") { [weak bridge] params in
        guard let p = params as? [String: Any], let message = p["message"] as? String else { return nil }
        let level = p["level"] as? String ?? "info"
        bridge?.addPageLog("\(level): \(message)")
        if level == "info" { Log.info("page: \(message)") } else { Log.error("page \(level): \(message)") }
        return nil
    }
}
