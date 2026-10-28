using System.Windows;
using SnipToss.App.Capture;
using WinForms = System.Windows.Forms;

namespace SnipToss.App;

/// <summary>
/// The tray icon: after the window is closed the app stays here and the Screen Capture hotkey keeps working (Settings → General → "Keep running in the tray when the window is closed").
/// Left click = open the window; right-click menu: Capture Screen, Open, Exit
/// </summary>
sealed class Tray : IDisposable
{
    readonly WinForms.NotifyIcon icon;
    readonly WinForms.ToolStripMenuItem captureItem;

    public Tray(MainWindow window)
    {
        this.window = window;
#pragma warning disable WFO5001 // the tray menu follows the system dark mode
        WinForms.Application.SetColorMode(WinForms.SystemColorMode.System);
#pragma warning restore WFO5001
        using var stream = Application.GetResourceStream(new Uri("pack://application:,,,/SnipToss.ico")).Stream;
        icon = new WinForms.NotifyIcon { Icon = new System.Drawing.Icon(stream, WinForms.SystemInformation.SmallIconSize) };
        var menu = new WinForms.ContextMenuStrip();
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
    readonly WinForms.ToolStripMenuItem openItem, exitItem;

    /// <summary>The hover text and menu items are written in the current UI language (when built, and when the language changes)</summary>
    public void Relabel()
    {
        icon.Text = MainWindow.AppName;
        captureItem.Text = Locale.T("shell.tray.capture");
        openItem.Text = Locale.T("shell.tray.open", ("app", MainWindow.AppName));
        exitItem.Text = Locale.T("shell.tray.exit");
    }

    /// <summary>Shows the hotkey that is actually in effect to the right of "Capture Screen" (nothing if it failed to register or isn't set)</summary>
    void RefreshShortcut() => captureItem.ShortcutKeyDisplayString = window.ActiveHotkey is { } k ? GlobalHotKey.Pretty(k) : "";

#if TEST_HOOKS
    /// <summary>Test entry point (TestHooks): the icon, hover text and menu items</summary>
    public object Describe()
    {
        RefreshShortcut();
        var items = icon.ContextMenuStrip!.Items.Cast<WinForms.ToolStripItem>()
            .Select(i => i is WinForms.ToolStripMenuItem m ? new { text = m.Text ?? "", shortcut = m.ShortcutKeyDisplayString ?? "" } : new { text = "-", shortcut = "" });
        return new { present = icon.Visible, text = icon.Text, items, said = said is { } s ? new { title = s.Title, text = s.Text } : null };
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
    }
}
