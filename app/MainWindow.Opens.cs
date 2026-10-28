using Microsoft.Web.WebView2.Core;

namespace SnipToss.App;

// Opening from outside (part of MainWindow): paths from the context menu, the command line or a second process are added to the list; if the UI is listening it is notified, otherwise they wait (PendingOpens)
sealed partial class MainWindow
{
    /// <summary>
    /// The app is already running and something is opened again from the context menu / command line: the other process hands the path over (see SingleInstance),
    /// it is added to the list, the UI is told to locate it, and the window is brought to the front
    /// </summary>
    public async void OpenFromOutside(string[] args)
    {
        ShowFromTray(); // may be hiding in the tray; bring it to the front first, since the disk check may take a while (ten-odd seconds when the path is on a disconnected network drive, see Volumes)
        Opened(await Library.AddAsync(settings, args));
    }

    /// <summary>Passed in on the command line and not yet checked when the UI came up (slow network drive): added once checked, same as opening from outside</summary>
    async void AddWhenProbed(Task<Library.Probed> probe) => Opened(Library.Add(settings, await probe));

    /// <summary>Opened from outside and already added to the list: if the UI is listening it is told to locate it and explain what wasn't added, otherwise they wait</summary>
    void Opened(Library.AddResult result)
    {
        if (web.CoreWebView2 is null || !Pending.Listening)
        {
            // The UI isn't up yet (the window was never shown after an autostart) or is loading (the listener isn't attached yet, so a push would be lost): remember it, and the UI takes it along when it reads the list
            // (the first case used to map virtual hosts directly and crash with a null reference; in the second, the location and the explanations were lost)
            Pending.Stash(result);
            if (web.CoreWebView2 is not null) ReloadIfNewVolume(result.Added, null);
            return;
        }
        // Include the recognized moved ones too: the UI says "recognized" (before, only drag-in and the file picker said so; ones opened from the context menu were silently swapped, and it looked like one more entry had appeared)
        if (!ReloadIfNewVolume(result.Added, result))
            Post(new
            {
                @event = "libraryChanged",
                focus = result.Focus,
                skipped = result.Skipped,
                relocated = (result.Relocated ?? []).Select(x => new { from = x.From, to = x.To }),
            });
    }
}
