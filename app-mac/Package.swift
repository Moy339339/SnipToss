// swift-tools-version:5.9
import PackageDescription

// The Mac shell (ADR-0011): a native window around the same web UI the Windows app shows. It implements the bridge in docs/host-api.md.
let package = Package(
    name: "SnipToss",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(name: "SnipToss", path: "Sources/SnipToss")
    ]
)
