#if TEST_HOOKS
using System.IO;
using System.Runtime.CompilerServices;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using SnipToss.App.Capture;

namespace SnipToss.App;

/// <summary>
/// Test entry points for the shell tests (tests/shell) (ADR-0004 item 3): make the UI thread / a background thread / a background task throw, read the tray icon and menu, click the tray;
/// for Screen Capture: fake monitors, inject mouse and keyboard into the capture overlay, read the overlay and the finished result (tests/shell/capture.spec.ts); save the notice, error window and the image on the clipboard as PNG (screenshots per language, i18n-shots.spec.ts).
/// Compiled in only when npm run e2e:shell / perf builds to tests/shell/.app (SnipTossTestHooks in the csproj → TEST_HOOKS);
/// the formally installed build doesn't have this class (build-app.ps1 checks after compiling); even when compiled in it is honored only in a test instance (SNIPTOSS_SETTINGS).
/// Messages are always English: only tests see them, and they stay out of the i18n ratchet (scripts/check-i18n.mjs counts code lines containing Chinese)
/// </summary>
static class TestHooks
{
    static void Check()
    {
        if (!AppPaths.IsTestInstance) throw new InvalidOperationException("Unsupported");
    }

    /// <summary>ui = an uncaught exception on the UI thread (the error window); thread = a background thread crash (the process exits); task = an unhandled background task exception (only logged)</summary>
    public static object? Throw(MainWindow window, string where)
    {
        Check();
        switch (where)
        {
            case "ui":
                // BeginInvoke (not InvokeAsync): only then does the exception reach DispatcherUnhandledException, same as a real error
                window.Dispatcher.BeginInvoke(new Action(() => throw new InvalidOperationException("Test hook: UI thread error")));
                break;
            case "thread":
                new Thread(() => throw new InvalidOperationException("Test hook: background thread crash")) { IsBackground = true }.Start();
                break;
            case "task":
                _ = Task.Run(async () =>
                {
                    Unobserved();
                    await Task.Delay(300);
                    GC.Collect();
                    GC.WaitForPendingFinalizers();
                    GC.Collect();
                });
                break;
            default:
                throw new ArgumentException($"Unknown where: {where}");
        }
        return null;
    }

    /// <summary>The failing task keeps no reference (a separate method that isn't inlined), so it counts as "unhandled" at garbage collection</summary>
    [MethodImpl(MethodImplOptions.NoInlining)]
    static void Unobserved() => _ = Task.Run(Fail);

    static void Fail() => throw new InvalidOperationException("Test hook: unobserved task error");

    /// <summary>Whether the tray icon exists, the hover text, the menu items (the shortcut shown on the right is computed as when the menu opens)</summary>
    public static object TrayState(MainWindow window)
    {
        Check();
        return window.TrayIcon?.Describe() ?? new { present = false };
    }

    /// <summary>left = left-click the icon; otherwise = click the menu item whose text starts with it (the tests run the Chinese UI and pass 截图批注, 打开 or 退出)</summary>
    public static object? TrayAct(MainWindow window, string action)
    {
        Check();
        var tray = window.TrayIcon ?? throw new InvalidOperationException("No tray icon");
        tray.Act(action);
        return null;
    }

    // ---------- Screen Capture: fake monitors, injected mouse and keyboard, reading state, reading results ----------

    /// <summary>
    /// From now on, captures use fakes: monitors (monitors, in physical pixels; placed off-screen so the user can't see them; scale = scaling;
    /// image = a PNG file of exactly the monitor's size to show as its picture, otherwise a test pattern), windows (windows), the cursor position (cursor);
    /// the clipboard is replaced by a recorder (clipboardFailures = the first few attempts count as busy), and notices and the composed result are recorded; fail = throw while capturing the screen.
    /// Each call first closes any open capture and clears what was recorded last time; off = switch back to the real ones
    /// </summary>
    public static object? CaptureFake(JsonElement a)
    {
        Check();
        CaptureSession.Current?.Cancel();
        CaptureFakes.Reset();
        if (a.TryGetProperty("off", out var off) && off.GetBoolean()) return null;
        var specs = a.GetProperty("monitors").EnumerateArray().Select(m => (
            bounds: Rect(m),
            scale: m.TryGetProperty("scale", out var s) ? s.GetDouble() : 1,
            image: m.TryGetProperty("image", out var im) && im.ValueKind == JsonValueKind.String ? im.GetString() : null)).ToList();
        var fail = a.TryGetProperty("fail", out var f) && f.GetBoolean();
        CaptureFakes.Monitors = () => fail
            ? throw new InvalidOperationException("Test hook: screen capture failed")
            : specs.Select((m, i) => new MonitorShot(m.bounds, m.scale,
                m.image is null ? CaptureFakes.Pattern(m.bounds.Width, m.bounds.Height, i) : CaptureFakes.Picture(m.image, m.bounds.Width, m.bounds.Height))).ToList();
        CaptureFakes.Windows = a.TryGetProperty("windows", out var w) ? w.EnumerateArray().Select(Rect).ToList() : [];
        CaptureFakes.Cursor = a.TryGetProperty("cursor", out var c) && c.ValueKind == JsonValueKind.Array ? (c[0].GetInt32(), c[1].GetInt32()) : null;
        CaptureFakes.Primary = specs.Count > 0 ? specs[0].bounds : new Int32Rect(-20000, -20000, 1280, 720);
        CaptureFakes.ClipboardFailures = a.TryGetProperty("clipboardFailures", out var cf) ? cf.GetInt32() : 0;
        CaptureFakes.ToastFails = a.TryGetProperty("toastFails", out var tf) && tf.GetBoolean();
        CaptureFakes.Clipboard = CaptureFakes.Record;
        return null;
    }

    static Int32Rect Rect(JsonElement r) => new(r.GetProperty("x").GetInt32(), r.GetProperty("y").GetInt32(), r.GetProperty("width").GetInt32(), r.GetProperty("height").GetInt32());

    /// <summary>
    /// Performs ops in turn (each step is described at CaptureOverlay.TestInput); monitor = which monitor's layer (each step may carry its own monitor).
    /// After each step the UI thread finishes its queued work (positioning, repainting). Returns each step's result and the state afterwards
    /// </summary>
    public static async Task<object> CaptureDo(JsonElement a)
    {
        Check();
        var index = a.TryGetProperty("monitor", out var m) ? m.GetInt32() : 0;
        var results = new List<object?>();
        foreach (var op in a.GetProperty("ops").EnumerateArray())
        {
            var i = op.TryGetProperty("monitor", out var om) ? om.GetInt32() : index;
            var layers = CaptureSession.Current?.Overlays ?? throw new InvalidOperationException("No capture is open");
            if (i >= layers.Count) throw new ArgumentException($"No layer {i}");
            results.Add(layers[i].TestInput(op));
            await Dispatcher.Yield(DispatcherPriority.ContextIdle);
            Trace(op, results[^1]);
        }
        return new { results, state = CaptureState() };
    }

    /// <summary>
    /// SNIPTOSS_TEST_CAPTURE_TRACE = file: the state after each step is recorded as a line (JSON Lines). When changing the capture overlay's internals run capture.spec.ts (--workers=1) before and after,
    /// and only if the two are identical line by line has nothing been broken
    /// </summary>
    static void Trace(JsonElement op, object? result)
    {
        if (Environment.GetEnvironmentVariable("SNIPTOSS_TEST_CAPTURE_TRACE") is not { Length: > 0 } file) return;
        File.AppendAllText(file, JsonSerializer.Serialize(new { op, result, state = CaptureState() }) + "\n");
    }

    /// <summary>Whether a capture is open, and what each layer looks like (CaptureOverlay.Describe)</summary>
    public static object CaptureState()
    {
        Check();
        var s = CaptureSession.Current;
        return new { open = s is not null, overlays = s?.Overlays.Select(o => o.Describe()).ToList() ?? [] };
    }

    /// <summary>The latest finished result: what was put on the clipboard, how many attempts, notices shown, the archive file, the composed image (pixels = points to sample colors from, physical pixels)</summary>
    public static object CaptureResult(JsonElement a)
    {
        Check();
        var image = CaptureFakes.Composed;
        var pixels = image is not null && a.ValueKind == JsonValueKind.Object && a.TryGetProperty("pixels", out var px)
            ? px.EnumerateArray().Select(p => Pixel(image, p[0].GetInt32(), p[1].GetInt32())).ToList()
            : null;
        return new
        {
            clipboard = CaptureFakes.LastClipboard,
            clipboardAttempts = CaptureFakes.ClipboardAttempts,
            shown = CaptureFakes.Shown.ToList(),
            saved = CaptureFakes.Saved,
            image = image is null ? null : new { width = image.PixelWidth, height = image.PixelHeight },
            pixels,
            // Notice windows still open; excluded = they can't be captured by a screen grab (WDA_EXCLUDEFROMCAPTURE), so in consecutive captures they aren't captured into the next one
            windows = Toast.Open.Select(t => new { kind = t.Kind, excluded = GetWindowDisplayAffinity(new WindowInteropHelper(t.Window).Handle, out var a) && a == 0x11 }).ToList(),
        };
    }

    /// <summary>Presses a key (Escape etc.) on the error notice: same as the user having clicked it (activated) and then pressing the key. Returns whether it is still open afterwards</summary>
    public static object CaptureErrorKey(JsonElement a)
    {
        Check();
        var window = Toast.Error ?? throw new InvalidOperationException("No error toast");
        var key = Enum.Parse<System.Windows.Input.Key>(a.GetProperty("key").GetString()!, ignoreCase: true);
        var source = PresentationSource.FromVisual(window) ?? throw new InvalidOperationException("Error toast has no window");
        window.RaiseEvent(new System.Windows.Input.KeyEventArgs(System.Windows.Input.Keyboard.PrimaryDevice, source, Environment.TickCount, key) { RoutedEvent = System.Windows.Input.Keyboard.PreviewKeyDownEvent });
        return new { open = Toast.Error is not null };
    }

    /// <summary>
    /// Renders one of this process's windows to PNG (path), for looking at each language (tests/shell/i18n-shots.spec.ts): toast / error = the Screen Capture finish / error notice
    /// (placed next to the off-screen fake monitor, so a screen grab can't capture it), crash = the error window, main = the main window (the notice page when the UI can't start; the web part can't be drawn into it).
    /// Draws only the inside of the window, not the title bar and frame drawn by the system. Returns the size of the image (physical pixels)
    /// </summary>
    public static object WindowShot(MainWindow main, JsonElement a)
    {
        Check();
        var which = a.GetProperty("which").GetString();
        var window = which switch
        {
            "toast" or "error" => Toast.Open.LastOrDefault(t => t.Kind == which).Window,
            "crash" => Application.Current.Windows.OfType<CrashDialog>().LastOrDefault(),
            "main" => main,
            _ => throw new ArgumentException($"Unknown window: {which}"),
        } ?? throw new InvalidOperationException($"No {which} window is open");
        if (window.Content is not FrameworkElement root) throw new InvalidOperationException("The window has no content");
        root.UpdateLayout();
        // Draw the whole window (its own background and the content's outer margin included); the size is the part inside the window (without the frame the system draws)
        var width = root.ActualWidth + root.Margin.Left + root.Margin.Right;
        var height = root.ActualHeight + root.Margin.Top + root.Margin.Bottom;
        var dpi = VisualTreeHelper.GetDpi(window);
        var bitmap = new RenderTargetBitmap(
            (int)Math.Ceiling(width * dpi.DpiScaleX),
            (int)Math.Ceiling(height * dpi.DpiScaleY),
            dpi.PixelsPerInchX,
            dpi.PixelsPerInchY,
            PixelFormats.Pbgra32);
        bitmap.Render(window);
        var png = new PngBitmapEncoder();
        png.Frames.Add(BitmapFrame.Create(bitmap));
        using (var file = File.Create(a.GetProperty("path").GetString()!)) png.Save(file);
        return new { width = bitmap.PixelWidth, height = bitmap.PixelHeight };
    }

    /// <summary>Saves the PNG most recently put on the clipboard to path (exists only after the clipboard is replaced by a recorder, see CaptureFake); throws if there is none</summary>
    public static object? ClipboardPng(JsonElement a)
    {
        Check();
        File.WriteAllBytes(a.GetProperty("path").GetString()!, CaptureFakes.LastPng ?? throw new InvalidOperationException("No PNG was put on the clipboard"));
        return null;
    }

    [DllImport("user32.dll")]
    static extern bool GetWindowDisplayAffinity(IntPtr hwnd, out uint affinity);

    static string Pixel(BitmapSource image, int x, int y)
    {
        var px = new byte[4];
        image.CopyPixels(new Int32Rect(x, y, 1, 1), px, 4, 0);
        return $"{px[2]:x2}{px[1]:x2}{px[0]:x2}";
    }

    /// <summary>Sends WM_HOTKEY to the hotkey's invisible window (same as pressing the capture hotkey, without a real key press)</summary>
    public static object? Hotkey(MainWindow window)
    {
        Check();
        (window.HotKey ?? throw new InvalidOperationException("No hotkey")).PostPressed();
        return null;
    }

    /// <summary>
    /// A disconnected network drive (SNIPTOSS_TEST_DEAD_SHARE, such as \\192.0.2.1\share): when Volumes checks it, it answers "not there" after a fixed 3 seconds; a real check waits 10–40 seconds (different each time),
    /// which tests can't afford. Code elsewhere that bypasses Volumes and checks this path directly still hits the real timeout, and the tests still catch it
    /// </summary>
    public static bool DeadShare(string root)
    {
        if (!AppPaths.IsTestInstance || Environment.GetEnvironmentVariable("SNIPTOSS_TEST_DEAD_SHARE") is not { Length: > 0 } dead) return false;
        if (!string.Equals(root.TrimEnd('\\'), dead.TrimEnd('\\'), StringComparison.OrdinalIgnoreCase)) return false;
        Thread.Sleep(3000);
        return true;
    }
}

/// <summary>Stand-ins for the capture overlay (exist only in the shell-test build, see TestHooks.CaptureFake)</summary>
static class CaptureFakes
{
    public static Func<List<MonitorShot>>? Monitors;
    public static List<Int32Rect>? Windows;
    public static (int X, int Y)? Cursor;
    /// <summary>Where the notice goes before the capture overlay has been built (off-screen, like Monitors)</summary>
    public static Int32Rect? Primary;
    public static Action<DataObject>? Clipboard;
    public static int ClipboardFailures;
    public static int ClipboardAttempts;
    /// <summary>The finish notice / error notice window throws as soon as it is created</summary>
    public static bool ToastFails;
    public static object? LastClipboard;
    /// <summary>The PNG most recently put on the clipboard (to see how "Copy as Images" draws, TestHooks.ClipboardPng)</summary>
    public static byte[]? LastPng;
    public static readonly List<ShownToast> Shown = [];
    public static BitmapSource? Composed;
    public static string? Saved;

    public static void Reset()
    {
        Monitors = null;
        Windows = null;
        Cursor = null;
        Primary = null;
        Clipboard = null;
        ClipboardFailures = ClipboardAttempts = 0;
        ToastFails = false;
        LastClipboard = null;
        LastPng = null;
        Shown.Clear();
        Composed = null;
        Saved = null;
        Toast.CloseError();
    }

    /// <summary>A fake picture: each physical pixel's color is computed from its coordinates (B = low 8 bits of x, G = low 8 bits of y, R = high bits of x and y + which monitor), and tests compute the expected value from the same formula</summary>
    public static BitmapSource Pattern(int width, int height, int index)
    {
        var px = new byte[width * height * 4];
        for (var y = 0; y < height; y++)
            for (var x = 0; x < width; x++)
            {
                var i = (y * width + x) * 4;
                px[i] = (byte)x;
                px[i + 1] = (byte)y;
                px[i + 2] = (byte)((x >> 8) + (y >> 8) * 16 + index * 64);
                px[i + 3] = 255;
            }
        var bitmap = BitmapSource.Create(width, height, 96, 96, PixelFormats.Bgra32, null, px, width * 4);
        bitmap.Freeze();
        return bitmap;
    }

    /// <summary>A fake picture read from a PNG file (monitors[].image): it must be exactly the monitor's size in physical pixels; the pixels are copied into a 96-dpi bitmap like Pattern's</summary>
    public static BitmapSource Picture(string path, int width, int height)
    {
        var decoder = BitmapDecoder.Create(new Uri(path), BitmapCreateOptions.None, BitmapCacheOption.OnLoad);
        var frame = new FormatConvertedBitmap(decoder.Frames[0], PixelFormats.Bgra32, null, 0);
        if (frame.PixelWidth != width || frame.PixelHeight != height)
            throw new InvalidOperationException($"Test hook: {path} is {frame.PixelWidth}×{frame.PixelHeight}, the monitor is {width}×{height}");
        var px = new byte[width * height * 4];
        frame.CopyPixels(px, width * 4, 0);
        var bitmap = BitmapSource.Create(width, height, 96, 96, PixelFormats.Bgra32, null, px, width * 4);
        bitmap.Freeze();
        return bitmap;
    }

    /// <summary>Clipboard recorder: records which formats, the text, the PNG and bitmap sizes were put; the first ClipboardFailures attempts count as held by another program</summary>
    public static void Record(DataObject data)
    {
        ClipboardAttempts++;
        if (ClipboardFailures > 0)
        {
            ClipboardFailures--;
            // The same exception WPF throws when another program holds the clipboard (what ClipboardWriter retries)
#pragma warning disable CA2201
            throw new COMException("Test hook: clipboard is busy", unchecked((int)0x800401D0) /* CLIPBRD_E_CANT_OPEN */);
#pragma warning restore CA2201
        }
        var png = (data.GetData("PNG", false) as MemoryStream)?.ToArray();
        LastPng = png;
        var bitmap = data.GetData(DataFormats.Bitmap, false) as BitmapSource;
        LastClipboard = new
        {
            formats = data.GetFormats(false),
            text = data.GetData(DataFormats.UnicodeText, false) as string,
            png = png is null ? null : new { bytes = png.Length, signature = png.Length > 8 && png[1] == 'P' && png[2] == 'N' && png[3] == 'G', width = BigEndian(png, 16), height = BigEndian(png, 20) },
            bitmap = bitmap is null ? null : new { width = bitmap.PixelWidth, height = bitmap.PixelHeight, format = bitmap.Format.ToString() },
        };
    }

    static int BigEndian(byte[] b, int at) => b.Length < at + 4 ? 0 : (b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3];
}

/// <summary>Notices shown: toast = the finish notice (fades out), error = the error notice (stays)</summary>
sealed record ShownToast(string Kind, string Title, string Detail, string? Path, string? Error);
#endif
