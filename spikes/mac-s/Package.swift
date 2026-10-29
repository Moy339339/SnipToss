// swift-tools-version:5.9
import PackageDescription

// Throwaway probe, not product code: what a WKWebView shell for SnipToss can and cannot do (see docs/proposals/mac-port-prep.md).
let package = Package(
    name: "SpikeS",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "SpikeS", path: "Sources/SpikeS")
    ]
)
