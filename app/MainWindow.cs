using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Media;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace SnipToss.App;

// The main window. It is split into several files: this one has construction and watching; MainWindow.WebView.cs the UI (WebView2, watchdog, notice page), MainWindow.Volumes.cs the drives of items mapped to virtual hosts,
// MainWindow.Opens.cs opening from outside, MainWindow.Background.cs the capture hotkey, tray and capture entry point, MainWindow.Chrome.cs position, the Window menu, the self-drawn title bar and the dark border.
// A WPF window is not IDisposable: the hotkey, tray and watchers are released in Closing, and the WebView2 control is destroyed with the window
[System.Diagnostics.CodeAnalysis.SuppressMessage("Design", "CA1001", Justification = "Released in Closing")]
sealed partial class MainWindow : Window
{
    // Must match --bg in packages/web/src/styles.css: the window, title bar, WebView2 background and page background are all the same color, so nothing flashes at startup
    static readonly Color Bg = Color.FromRgb(0x14, 0x14, 0x16);

    /// <summary>
    /// The product name "超级批注", following the UI language: message brand.name, which is 超级批注 in Chinese and the English name SnipToss in other languages (for a worldwide audience).
    /// The technical name is SnipToss (the .sniptoss folder, the sniptoss command, SnipToss.exe; renamed from pizhu, docs/adr/0007-rename.md)
    /// </summary>
    public static string AppName => Locale.T("brand.name");

    public const string AppHost = "app.sniptoss.example";

    readonly WebView2 web;
    readonly Settings settings = Settings.Load();
    public Settings Settings => settings;
    readonly Stopwatch sinceStart = Stopwatch.StartNew();
    // WebView2 processes start up as soon as the window is constructed, in parallel with showing the window, saving one or two hundred milliseconds
    // Autoplay restriction is turned off: pressing Space in a desktop app should make sound, without the browser's "needs a user gesture first" rule
    readonly Task<CoreWebView2Environment> envTask = CreateEnvironment();
    bool readyLogged;

    /// <summary>
    /// Create the data directory ourselves first: when WebView2 can't create it (a same-named file in the way, no write permission) it shows its own English error box,
    /// the window stays black and the log has nothing. If it can't be created the exception is handed to InitWebViewAsync, which switches to the notice page
    /// </summary>
    static Task<CoreWebView2Environment> CreateEnvironment()
    {
        try
        {
            Directory.CreateDirectory(Path.Combine(AppPaths.WebViewDataDir, "EBWebView"));
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return Task.FromException<CoreWebView2Environment>(ex);
        }
        return CoreWebView2Environment.CreateAsync(null, AppPaths.WebViewDataDir, new CoreWebView2EnvironmentOptions("--autoplay-policy=no-user-gesture-required"));
    }

    /// <summary>
    /// Passed in on the command line, from the context menu, or by dropping on a shortcut (already added to the list): when the UI can't hear, they wait, and are taken when the UI reads the item list: locate it, explain what wasn't added
    /// (the explanations on these paths used to be lost, so the user didn't know why something wasn't added), and any recognized moved items
    /// </summary>
    public PendingOpens Pending { get; } = new();

    /// <summary>The paths passed in on the command line, the half that checks the disk in the background (Library.Probe); taken in InitWebViewAsync and added to the list</summary>
    Task<Library.Probed>? startupProbe;

    /// <param name="args">Command-line arguments: files or folders, added to the library and the first one located</param>
    public MainWindow(string[] args)
    {
        settings.Migrate(System.Globalization.CultureInfo.CurrentUICulture.Name);
        Locale.Use(settings.Language);
        Locale.Changed += ApplyLanguage;
        Title = AppName;
        Icon = System.Windows.Media.Imaging.BitmapFrame.Create(new Uri("pack://application:,,,/SnipToss.ico"));
        Background = new SolidColorBrush(Bg);
        MinWidth = WindowPlacement.MinDip.Width;
        MinHeight = WindowPlacement.MinDip.Height;
        // Work out where the window goes first (physical pixels); position it when the window is created but not yet shown (SourceInitialized): WPF converts the position using the system scaling when creating the window,
        // which isn't necessarily that of the screen the window lands on (two screens with different scaling, or scaling changed without signing out). A rough position here keeps it from landing on another screen at creation
        var (startAt, startMaximized) = settings.Placement.Target(Displays.All(), Displays.AtCursor(), WindowPlacement.MinDip);
        WindowStartupLocation = WindowStartupLocation.Manual;
        (Left, Top, Width, Height) = (startAt.X, startAt.Y, startAt.Width, startAt.Height);
        // Record it once when opened maximized: otherwise after minimizing to the taskbar the maximize button shows "Maximize", and quitting while minimized would save it as not maximized
        maximizedBeforeMinimize = startMaximized;
        Topmost = settings.Topmost;
        // Which drives the items in the list and on the command line are on: start checking now in the background, in parallel with starting WebView2 (a disconnected network drive takes ten-odd seconds to query, see Volumes).
        // The command-line ones are also checked in the background and added to the list before the UI loads (InitWebViewAsync); it used to be checked here, so the window was slow to appear when a path was on a disconnected network drive
        var listed = settings.Library.Select(e => e.Path).ToList();
        _ = Volumes.WaitAsync(listed, TimeSpan.Zero);
        if (args.Length > 0) startupProbe = Task.Run(() => Library.Probe(listed, args));

        web = new WebView2 { DefaultBackgroundColor = System.Drawing.Color.FromArgb(Bg.R, Bg.G, Bg.B) };
        Content = web;

        SourceInitialized += (_, _) =>
        {
            DarkChrome.Apply(this, Bg);
            DropSystemTitleBar();
            WindowPlacement.Place(this, startAt, startMaximized);
            StartBackground();
        };
        // Moved to another screen, or scaling changed: the minimum size follows that screen (so that maximize and full screen don't extend past a screen smaller than it)
        DpiChanged += (_, _) => WindowPlacement.FitMinSize(this);
        Loaded += async (_, _) => await InitWebViewAsync();
        Closing += (_, e) =>
        {
            if (!quitting && settings.Capture.KeepInTray)
            {
                e.Cancel = true;
                HideToTray();
                return;
            }
            if (fullscreen is not null) ExitFullscreen(); // what's recorded is the position and size from before full screen
            SavePlacement();
            ReleaseBackground();
        };
        StateChanged += (_, _) =>
        {
            if (WindowState != WindowState.Minimized) maximizedBeforeMinimize = WindowState == WindowState.Maximized;
            SavePlacementSoon();
        };
        LocationChanged += (_, _) =>
        {
            WindowPlacement.FitMinSize(this);
            SavePlacementSoon();
        };
        SizeChanged += (_, _) => SavePlacementSoon();
        // When the window is hidden (tray, during capture) tell WebView2 it isn't visible (controller.IsVisible = false, WebView2's recommendation: no rendering, saves CPU and memory).
        // Before, after hiding to the tray the controller stayed "visible"; the page's own visibilityState did follow the window to hidden (Playwright's connection makes it look always visible, which is an artifact)
        IsVisibleChanged += (_, _) =>
        {
            web.Visibility = IsVisible ? Visibility.Visible : Visibility.Hidden;
            // Don't poll items or notes folders while hidden (it stays in the tray for weeks, so don't keep waking network drives); check right away when shown
            materials?.Pause(!IsVisible);
            annotationWatch?.Pause(!IsVisible);
            // If hidden before the UI said "ready" and called back later: wait the full 30 seconds again, rather than swapping in the notice page the moment it is shown
            if (IsVisible && readyWatch?.IsEnabled == true)
            {
                readyWatch.Stop();
                readyWatch.Start();
            }
        };
        // The error window's Exit / Restart end the process directly, not through Closing: save the position and release the tray icon first (otherwise a ghost icon stays in the tray)
        Crash.BeforeExit = () =>
        {
            SavePlacement();
            ReleaseBackground();
        };
    }

    // ---------- Changed externally: notes, items: a periodic look (ChangeWatch.cs; FileSystemWatcher isn't used, it makes the folder impossible to rename) ----------

    AnnotationWatcher? annotationWatch;

    /// <summary>Starts watching this notes folder: when an agent writes back with sniptoss resolve, or notes are changed elsewhere, the UI syncs within a second</summary>
    public void Watch(string home)
    {
        if (annotationWatch is null)
        {
            annotationWatch = new AnnotationWatcher(Dispatcher, (h, files, seq) => Post(new { @event = "annotationsChanged", home = h, seq, annotations = files }));
            if (!IsVisible) annotationWatch.Pause(true);
        }
        annotationWatch.Watch(home);
    }
}
