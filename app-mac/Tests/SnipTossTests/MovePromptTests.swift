import AppKit
import XCTest

@testable import SnipToss

/// The prompt at startup to move the app into Applications (MovePrompt): what it says for each way of running from the wrong place, its
/// buttons, and what the main one shows in Finder
final class MovePromptTests: SnipTestCase {
    private let translocated = "/private/var/folders/n1/abc/T/AppTranslocation/0F1E2D3C-4B5A-6978-8796-A5B4C3D2E1F0/d/SnipToss.app"

    override func setUp() {
        super.setUp()
        // English, from the catalog when the resources are built and from the built-in text when not: the two must say the same
        _ = ShellLocale.use(pref: "en", system: "en-US")
    }

    override func tearDown() {
        ShellLocale.reset()
        super.tearDown()
    }

    func testFromATranslocatedCopyItSaysWhyTheConfirmationKeepsComingBack() {
        let texts = MovePrompt.texts(for: .translocated)
        XCTAssertEqual(texts.title, "Move SnipToss to the Applications folder")
        XCTAssertEqual(
            texts.body,
            "SnipToss was opened directly from Downloads or the disk image. When it's opened this way, macOS treats it as being in a new"
                + " location every time, so the system's screen capture confirmation keeps coming up.\n\n"
                + "After quitting, drag SnipToss to the Applications folder and open it from there from now on.")
        XCTAssertEqual(texts.buttons, ["Quit and Open Applications", "Not Now"])
    }

    func testStraightFromADiskImageItSaysTheAppGoesWithTheDiskImage() {
        let texts = MovePrompt.texts(for: .diskImage)
        XCTAssertEqual(texts.title, "Move SnipToss to the Applications folder")
        XCTAssertEqual(
            texts.body,
            "SnipToss was opened directly from the disk image, so it can't be opened once the disk image is ejected.\n\n"
                + "After quitting, drag SnipToss to the Applications folder and open it from there from now on.")
    }

    func testTheWordsFollowTheLanguageInUse() throws {
        let formatter = AppResources.directory()?.appendingPathComponent("shell-messages.js").path
        guard let formatter, FileManager.default.fileExists(atPath: formatter) else { throw XCTSkip("the shell's resources are not built") }
        _ = ShellLocale.use(pref: "zh-CN", system: "en-US")
        let texts = MovePrompt.texts(for: .translocated)
        XCTAssertEqual(texts.title, "请把超级批注移到「应用程序」文件夹")
        XCTAssertEqual(texts.body.components(separatedBy: "\n\n").count, 2, texts.body)
        XCTAssertEqual(texts.buttons, ["退出并打开「应用程序」", "这次仍从这里打开"])
    }

    /// The title and the body are as high as their text needs at the width they end up with: no empty line under a title that fits one
    /// line (NSAlert gave the Chinese title with the long body the height of two before the second layout)
    func testTheTextIsAsHighAsItNeedsNoEmptyLineUnderTheTitle() throws {
        let formatter = AppResources.directory()?.appendingPathComponent("shell-messages.js").path
        guard let formatter, FileManager.default.fileExists(atPath: formatter) else { throw XCTSkip("the shell's resources are not built") }
        for language in ["zh-CN", "en", "de", "ja"] {
            _ = ShellLocale.use(pref: language, system: "en-US")
            for problem in [AppLocation.Problem.translocated, .diskImage] {
                let alert = MovePrompt.alert(for: problem)
                let fields = alert.window.contentView?.subviews.compactMap { $0 as? NSTextField } ?? []
                XCTAssertEqual(fields.count, 2, "\(language) \(problem)")
                for field in fields {
                    let needed = field.sizeThatFits(NSSize(width: field.frame.width, height: .greatestFiniteMagnitude)).height
                    XCTAssertEqual(field.frame.height, needed, accuracy: 1, "\(language) \(problem): \(field.stringValue.prefix(20))")
                }
            }
        }
    }

    /// Return is the main button (quit and show Applications); Esc the other one, which goes on from here
    func testReturnQuitsAndEscGoesOn() {
        let alert = MovePrompt.alert(for: .translocated)
        XCTAssertEqual(alert.messageText, MovePrompt.texts(for: .translocated).title)
        XCTAssertEqual(alert.informativeText, MovePrompt.texts(for: .translocated).body)
        XCTAssertEqual(alert.buttons.map { $0.title }, ["Quit and Open Applications", "Not Now"])
        XCTAssertEqual(alert.buttons.map { $0.keyEquivalent }, ["\r", "\u{1B}"])
    }

    func testATranslocatedAppShowsTheCopyTheUserOpened() {
        let opened = "/Users/someone/Downloads/SnipToss.app"
        let copy = translocated
        let reveal = MovePrompt.reveal(for: .translocated, bundlePath: copy, originalPath: { $0 == copy ? opened : nil })
        XCTAssertEqual(reveal.applications.path, "/Applications")
        XCTAssertEqual(reveal.select?.path, opened)
    }

    /// Where it was opened from is unknown (the system's lookup is missing or says nothing): only Applications is shown, never the random
    /// copy, which the user cannot drag anywhere useful
    func testWhenTheSystemDoesNotSayOnlyApplicationsIsShown() {
        let reveal = MovePrompt.reveal(for: .translocated, bundlePath: translocated, originalPath: { _ in nil })
        XCTAssertEqual(reveal.applications.path, "/Applications")
        XCTAssertNil(reveal.select)
    }

    func testStraightFromADiskImageTheAppOnTheVolumeIsShown() {
        let onVolume = "/Volumes/SnipToss Beta 45/SnipToss.app"
        let reveal = MovePrompt.reveal(for: .diskImage, bundlePath: onVolume, originalPath: { _ in XCTFail("not asked"); return nil })
        XCTAssertEqual(reveal.select?.path, onVolume)
    }

    /// Applications opens first, then the copy to drag, selected, so its window is the one in front
    func testFinderOpensApplicationsThenSelectsTheCopy() {
        var done: [String] = []
        let copy = URL(fileURLWithPath: "/Users/someone/Downloads/SnipToss.app")
        MovePrompt.show(
            MovePrompt.Reveal(applications: URL(fileURLWithPath: "/Applications"), select: copy), open: { done.append("open " + $0.path) },
            select: { done.append("select " + $0.map { $0.path }.joined(separator: ",")) })
        XCTAssertEqual(done, ["open /Applications", "select /Users/someone/Downloads/SnipToss.app"])

        done = []
        MovePrompt.show(
            MovePrompt.Reveal(applications: URL(fileURLWithPath: "/Applications"), select: nil), open: { done.append("open " + $0.path) },
            select: { _ in done.append("select") })
        XCTAssertEqual(done, ["open /Applications"])
    }
}
