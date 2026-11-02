SnipToss for Mac {version}

Install
1. Drag SnipToss onto the Applications folder on the right.
2. Always open it from Applications. Opened from this window or from Downloads, macOS treats it as being in a new location every time, so the system's screen capture confirmation keeps coming up. SnipToss reminds you about this when it is opened from such a place.

Opening it for the first time
SnipToss is not notarized by Apple, so macOS blocks it the first time:
1. Double-click SnipToss. When macOS says it can't verify it, click Done.
2. Open System Settings → Privacy & Security. Near the bottom, next to "SnipToss was blocked", click Open Anyway and enter your login password.
3. Open SnipToss again and click Open Anyway.
After that it opens normally. Each new version needs this once, the first time it opens.

Allowing screen capture
Screen Capture needs permission to record the screen:
1. Press ⌃⌥⌘A (Control + Option + Command + A), or click Capture in the title bar of the SnipToss window. With many menu bar icons, the SnipToss icon can end up hidden behind the notch; the shortcut and the button in the window always work.
2. When macOS asks, click Open System Settings, and turn on SnipToss under Privacy & Security → Screen & System Audio Recording (Screen Recording on macOS 14).
3. Click Quit & Reopen when asked.
A new version keeps the permission. From macOS 15 on, macOS asks again from time to time whether SnipToss may keep recording; click Allow.

Requirements
macOS 14 or later, on a Mac with Apple silicon or an Intel processor. The Intel version has not been tested on a real Intel Mac yet: if something goes wrong, please report it in Issues on the project page below.

Uninstall
Move SnipToss from Applications to the Trash. Its settings are in ~/Library/Application Support/SnipToss and its logs in ~/Library/Logs/SnipToss; delete them too if you no longer need them.
In System Settings → Privacy & Security → Screen & System Audio Recording, select SnipToss and click − to remove it.

Project page: https://github.com/Moy339339/SnipToss
