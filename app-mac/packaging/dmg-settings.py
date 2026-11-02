# The disk image for the Mac package (dmgbuild -s app-mac/packaging/dmg-settings.py, called by app-mac/scripts/package-dmg.mjs): the app
# and a link to Applications side by side over a background with an arrow between them, the two read-me files below. dmgbuild writes the
# Finder window's layout itself (.DS_Store), without scripting Finder.
# Defines (-D name=value): app = the .app, readme_en / readme_zh = the read-me files with the version filled in, background = the
# background (a TIFF with the 1x and 2x pictures), icon = the volume's icon (.icns)
import os.path

application = defines["app"]
app_name = os.path.basename(application)

files = [application, (defines["readme_zh"], "先读我.txt"), (defines["readme_en"], "Read Me.txt")]
symlinks = {"Applications": "/Applications"}
icon = defines["icon"]

# LZMA: the smallest, and readable on every macOS the app runs on (14 and later)
format = "ULMO"
filesystem = "HFS+"

# The window: 640 × 400 points of content, the design of the background; no toolbar, sidebar, path or status bar. Finder counts the
# title bar in this size (about 30 points on macOS 26, 28 before), so the height is 400 plus a title bar; the background is 440 high, so a
# content area a few points taller than 400 is still covered
background = defines["background"]
window_rect = ((200, 120), (640, 432))
default_view = "icon-view"
show_status_bar = False
show_tab_view = False
show_toolbar = False
show_pathbar = False
show_sidebar = False
include_icon_view_settings = True
icon_size = 112
text_size = 12
arrange_by = None
# Centers of the icons, in points from the top-left corner of the content; the arrow on the background runs between the first two
icon_locations = {
    app_name: (170, 150),
    "Applications": (470, 150),
    "先读我.txt": (270, 300),
    "Read Me.txt": (370, 300),
}
