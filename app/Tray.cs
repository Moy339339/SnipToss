using System.Drawing;
using System.Drawing.Drawing2D;
using System.Windows;
using SnipToss.App.Capture;
using static SnipToss.App.Native;
using WinForms = System.Windows.Forms;

namespace SnipToss.App;

/// <summary>
/// The tray icon: after the window is closed the app stays here and the Screen Capture hotkey keeps working (Settings → General → "Keep running in the tray when the window is closed").
/// Left click = open the window; right-click menu: Capture Screen, Open, Exit. When a new version is out: a dot on the icon, the version in the hover text,
/// and Download / Skip This Version at the top of the menu (no balloon, nothing that interrupts)
/// </summary>
sealed class Tray : IDisposable
{
    readonly WinForms.NotifyIcon icon;
    readonly WinForms.ToolStripMenuItem captureItem;
    readonly Icon plain;
    Icon? dotted;

    public Tray(MainWindow window)
    {
        this.window = window;
#pragma warning disable WFO5001 // the tray menu follows the system dark mode
        WinForms.Application.SetColorMode(WinForms.SystemColorMode.System);
#pragma warning restore WFO5001
        using var stream = Application.GetResourceStream(new Uri("pack://application:,,,/SnipToss.ico")).Stream;
        plain = new Icon(stream, WinForms.SystemInformation.SmallIconSize);
        icon = new WinForms.NotifyIcon { Icon = plain };
        var menu = new WinForms.ContextMenuStrip();
        updateItem = new WinForms.ToolStripMenuItem("", null, (_, _) => window.OpenUpdate()) { Visible = false };
        skipItem = new WinForms.ToolStripMenuItem("", null, (_, _) => window.SkipUpdate()) { Visible = false };
        updateLine = new WinForms.ToolStripSeparator { Visible = false };
        menu.Items.Add(updateItem);
        menu.Items.Add(skipItem);
        menu.Items.Add(updateLine);
        captureItem = new WinForms.ToolStripMenuItem("", null, (_, _) => window.StartCapture(false, fromTray: true));
        menu.Items.Add(captureItem);
        menu.Items.Add(openItem = new WinForms.ToolStripMenuItem("", null, (_, _) => window.ShowFromTray()));
        menu.Items.Add(new WinForms.ToolStripSeparator());
        menu.Items.Add(exitItem = new WinForms.ToolStripMenuItem("", null, (_, _) => window.Quit()));
        Relabel();
        menu.Opening += (_, _) => RefreshShortcut();
        icon.ContextMenuStrip = menu;
        icon.BalloonTipClicked += (_, _) =>
        {
            var run = clicked;
            clicked = null;
            run?.Invoke();
        };
        icon.MouseClick += (_, e) =>
        {
            if (e.Button == WinForms.MouseButtons.Left) window.ShowFromTray();
        };
        icon.Visible = true;
    }

    readonly MainWindow window;
    readonly WinForms.ToolStripMenuItem openItem, exitItem, updateItem, skipItem;
    readonly WinForms.ToolStripSeparator updateLine;

    /// <summary>The new version being announced (null = none)</summary>
    Updates.Release? update;

    /// <summary>The hover text and menu items are written in the current UI language (when built, and when the language changes)</summary>
    public void Relabel()
    {
        // The hover text: the product name, and a second line for a new version (the system cuts it off at 127 characters)
        var text = update is { } u ? $"{MainWindow.AppName}\n{Locale.T("shell.tray.updateTip", ("version", Updates.Label(u.Version)))}" : MainWindow.AppName;
        icon.Text = text.Length > 127 ? text[..127] : text;
        captureItem.Text = Locale.T("shell.tray.capture");
        openItem.Text = Locale.T("shell.tray.open", ("app", MainWindow.AppName));
        exitItem.Text = Locale.T("shell.tray.exit");
        updateItem.Text = update is { } v ? Locale.T("shell.tray.updateDownload", ("version", Updates.Label(v.Version))) : "";
        skipItem.Text = Locale.T("shell.tray.updateSkip");
    }

    /// <summary>A new version to announce (null = none any more): the dot on the icon, the hover text and the two menu items at the top</summary>
    public void ShowUpdate(Updates.Release? newer)
    {
        update = newer;
        updateItem.Visible = skipItem.Visible = updateLine.Visible = newer is not null;
        icon.Icon = newer is null ? plain : dotted ??= WithDot(plain);
        Relabel();
    }

    /// <summary>
    /// The icon with a dot in the bottom-right corner, in the accent color the title bar uses for "Update Available" (--accent in styles.css),
    /// with a dark ring so it stands apart from the icon's own blue corner on light and dark taskbars alike
    /// </summary>
    static Icon WithDot(Icon from)
    {
        using var bitmap = from.ToBitmap();
        using (var g = Graphics.FromImage(bitmap))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            var size = Math.Max(6f, bitmap.Width * 0.46f);
            var dot = new RectangleF(bitmap.Width - size, bitmap.Height - size, size, size);
            using var ring = new SolidBrush(Color.FromArgb(0x0a, 0x0a, 0x0c));
            using var fill = new SolidBrush(Color.FromArgb(0x5b, 0x8c, 0xff));
            g.FillEllipse(ring, dot);
            var inner = Math.Max(1f, size * 0.16f);
            dot.Inflate(-inner, -inner);
            g.FillEllipse(fill, dot);
        }
        // GetHicon's handle isn't owned by any Icon: a copy that owns its own handle is kept, and this one is destroyed
        var handle = bitmap.GetHicon();
        try
        {
            using var borrowed = Icon.FromHandle(handle);
            return (Icon)borrowed.Clone();
        }
        finally
        {
            DestroyIcon(handle);
        }
    }

    /// <summary>Shows the hotkey that is actually in effect to the right of "Capture Screen" (nothing if it failed to register or isn't set)</summary>
    void RefreshShortcut() => captureItem.ShortcutKeyDisplayString = window.ActiveHotkey is { } k ? GlobalHotKey.Pretty(k) : "";

#if TEST_HOOKS
    /// <summary>Test entry point (TestHooks): the icon, hover text and menu items</summary>
    public object Describe()
    {
        RefreshShortcut();
        var items = icon.ContextMenuStrip!.Items.Cast<WinForms.ToolStripItem>()
            .Where(i => i.Available)
            .Select(i => i is WinForms.ToolStripMenuItem m ? new { text = m.Text ?? "", shortcut = m.ShortcutKeyDisplayString ?? "" } : new { text = "-", shortcut = "" });
        return new
        {
            present = icon.Visible,
            text = icon.Text,
            items,
            said = said is { } s ? new { title = s.Title, text = s.Text } : null,
            update = update?.Version,
            dot = icon.Icon != plain,
        };
    }

    /// <summary>Test entry point: left = left-click the icon (same as that branch in MouseClick); anything else = click the menu item whose text starts with it</summary>
    public void Act(string action)
    {
        if (action == "left")
        {
            window.ShowFromTray();
            return;
        }
        if (action == "balloon")
        {
            var run = clicked;
            clicked = null;
            run?.Invoke();
            return;
        }
        var item = icon.ContextMenuStrip!.Items.OfType<WinForms.ToolStripMenuItem>().FirstOrDefault(m => m.Text?.StartsWith(action, StringComparison.Ordinal) == true)
            ?? throw new ArgumentException($"No tray menu item: {action}");
        item.PerformClick();
    }
#endif

    /// <summary>Shows a sentence from the tray (the first time the window is closed, it explains that the app is still running in the background)</summary>
    public void Say(string title, string text, Action? onClick = null)
    {
        clicked = onClick;
#if TEST_HOOKS
        said = (title, text);
#endif
        icon.ShowBalloonTip(6000, title, text, WinForms.ToolTipIcon.None);
    }

    /// <summary>What clicking the sentence that just appeared does (cleared after one click; replaced when the next sentence appears)</summary>
    Action? clicked;

#if TEST_HOOKS
    /// <summary>The last sentence shown (read by the shell tests' test hooks)</summary>
    (string Title, string Text)? said;
#endif

    public void Dispose()
    {
        icon.Visible = false;
        icon.Dispose();
        plain.Dispose();
        dotted?.Dispose();
    }
}
