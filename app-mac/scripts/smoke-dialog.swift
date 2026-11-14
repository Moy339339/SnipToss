// A stand-in for the dialog in which macOS asks whether an app may keep recording the screen: that one is a window of the
// UserNotificationCenter process at the modal panel level, in front of the other apps. Built under that name for the capture smoke run
// (mac.yml), which checks that the capture layers step below such a dialog and come back on top once it has gone. Shows a small panel in
// the middle of the main screen and takes the front, until it is terminated.
// Build: swiftc -O app-mac/scripts/smoke-dialog.swift -o <folder>/UserNotificationCenter
import AppKit

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 260, height: 260), styleMask: [.titled], backing: .buffered, defer: false)
panel.level = .modalPanel
panel.title = "Smoke dialog"
panel.center()
app.activate(ignoringOtherApps: true)
panel.makeKeyAndOrderFront(nil)
signal(SIGTERM) { _ in exit(0) }
app.run()
