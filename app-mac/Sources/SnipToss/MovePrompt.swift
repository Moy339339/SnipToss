import AppKit

/// The prompt at startup to move the app into Applications, when it runs from where it was downloaded or straight from the disk image
/// (AppLocation). The main button quits and shows Applications in Finder, with the copy the user opened selected in a window of its own,
/// so it can be dragged across; the other one goes on from where it is this once, and the prompt comes back at the next start. The app
/// does not move itself: that would mean taking the quarantine mark off a downloaded app on the user's behalf
enum MovePrompt {
    /// What the prompt says: the title, the body (why, then what to do, as two paragraphs) and the buttons, the main one first
    struct Texts: Equatable {
        var title: String
        var body: String
        var buttons: [String]
    }

    static func texts(for problem: AppLocation.Problem) -> Texts {
        let app = ShellText.t("brand.name")
        let why = ShellText.t("shell.move.why", ["app": app, "where": problem == .diskImage ? "diskImage" : "translocated"])
        return Texts(
            title: ShellText.t("shell.move.title", ["app": app]),
            body: why + "\n\n" + ShellText.t("shell.move.steps", ["app": app]),
            buttons: [ShellText.t("shell.move.quit"), ShellText.t("shell.move.notNow")])
    }

    /// What Finder shows for the main button: the Applications folder, and the copy the user opened, selected, when it is known. For a
    /// translocated app that is where the system says it was opened from (in Downloads, or on the disk image); straight from a disk image
    /// it is the app itself
    struct Reveal: Equatable {
        var applications: URL
        var select: URL?
    }

    static func reveal(
        for problem: AppLocation.Problem, bundlePath: String, originalPath: (String) -> String? = AppLocation.originalPath(of:)
    ) -> Reveal {
        let select: String?
        switch problem {
        case .translocated: select = originalPath(bundlePath)
        case .diskImage: select = bundlePath
        }
        return Reveal(applications: applicationsFolder, select: select.map { URL(fileURLWithPath: $0) })
    }

    static var applicationsFolder: URL {
        FileManager.default.urls(for: .applicationDirectory, in: .localDomainMask).first
            ?? URL(fileURLWithPath: "/Applications", isDirectory: true)
    }

    /// The alert, laid out, not shown yet
    static func alert(for problem: AppLocation.Problem) -> NSAlert {
        let texts = texts(for: problem)
        let alert = NSAlert()
        alert.messageText = texts.title
        alert.informativeText = texts.body
        alert.addButton(withTitle: texts.buttons[0])
        // Esc goes to the button that is not the default one only when it says Cancel; this one says Not Now
        alert.addButton(withTitle: texts.buttons[1]).keyEquivalent = "\u{1B}"
        // NSAlert works out the title's height before it settles the window's width and keeps it: a title that fits one line at the final
        // width can be given the height of two, an empty line under it (the Chinese title with the long body). A second layout measures
        // it again at the final width, and running the alert keeps that
        alert.layout()
        alert.layout()
        return alert
    }

    /// Asks, and does what was chosen. True = the app goes on starting; false = it is to quit (Finder was asked to show the folders)
    static func ask(_ problem: AppLocation.Problem, bundlePath: String) -> Bool {
        NSApp.activate(ignoringOtherApps: true)
        let quit = alert(for: problem).runModal() == .alertFirstButtonReturn
        let from = problem == .diskImage ? "straight from a disk image" : "from a translocated copy"
        Log.info("Running \(from): \(quit ? "quit to be moved into Applications" : "went on from there this time")")
        if quit { show(reveal(for: problem, bundlePath: bundlePath)) }
        return !quit
    }

    /// Opens Applications, then the copy to drag, selected in its own window, in front
    static func show(
        _ reveal: Reveal, open: (URL) -> Void = { NSWorkspace.shared.open($0) },
        select: ([URL]) -> Void = { NSWorkspace.shared.activateFileViewerSelecting($0) }
    ) {
        open(reveal.applications)
        if let item = reveal.select { select([item]) }
    }
}
