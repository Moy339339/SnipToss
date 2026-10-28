using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using static SnipToss.App.Native;

namespace SnipToss.App.Capture;

/// <summary>
/// One Screen Capture session: one <see cref="CaptureOverlay"/> covers each display, and the selection can be on only one of them (<see cref="Owner"/>).
/// On finish it composites the image (screenshot + marks + numbers; with notes, a notes area is added below), saves it as a file,
/// and puts both the image and the text for the AI on the clipboard (the note text + the screenshot file path)
/// </summary>
sealed class CaptureSession
{
    public static CaptureSession? Current { get; private set; }

    readonly Settings settings;
    Action? done;
    readonly List<CaptureOverlay> overlays = [];

    public CaptureOverlay? Owner { get; private set; }

    /// <summary>The overlay on the display the mouse is on</summary>
    CaptureOverlay? OverlayUnderCursor() => Screens.Cursor() is { } c ? overlays.FirstOrDefault(o => Contains(o.Monitor, c)) : null;

    internal static bool Contains(Int32Rect b, (int X, int Y) p) => p.X >= b.X && p.X < b.X + b.Width && p.Y >= b.Y && p.Y < b.Y + b.Height;

#if TEST_HOOKS
    /// <summary>Test entry point (TestHooks): the overlay of each display, in the same order as the screen grabs (the order of the fake displays)</summary>
    internal IReadOnlyList<CaptureOverlay> Overlays => overlays;
#endif

    CaptureSession(Settings settings, Action? done)
    {
        this.settings = settings;
        this.done = done;
    }

    static bool warmed;

    /// <summary>
    /// Builds one overlay, lays it out once and closes it (never shown, never registered as a capture in progress): it pays up front the roughly 50 ms that building the layer, applying control templates and loading fonts would cost on the first shortcut press,
    /// so even the first press after startup stays within the "shortcut press to overlay visible ≤ 200 ms" budget. Runs once; skipped while a capture is in progress; on failure it only logs (the next press builds the layer as usual)
    /// </summary>
    public static void WarmUp(Settings settings)
    {
        if (warmed || Current is not null) return;
        warmed = true;
        try
        {
            const int Side = 64;
            var blank = BitmapSource.Create(Side, Side, 96, 96, PixelFormats.Bgra32, null, new byte[Side * Side * 4], Side * 4);
            blank.Freeze();
            var color = ParseColor(settings.MarkColor) ?? ToolPrefs.Colors[0];
            var overlay = new CaptureOverlay(new CaptureSession(settings, null), new MonitorShot(new Int32Rect(0, 0, Side, Side), 1, blank), [], color, settings.DefaultCategory);
            if (overlay.Content is UIElement content)
            {
                content.Measure(new Size(Side, Side));
                content.Arrange(new Rect(0, 0, Side, Side));
                // Render once (in software, into memory): glyphs, brushes and other things prepared on first use get prepared now
                new RenderTargetBitmap(Side, Side, 96, 96, PixelFormats.Pbgra32).Render(content);
            }
            // A window that was never shown is still in Application.Windows: close it rather than leave it
            overlay.Close();
        }
        catch (Exception ex) when (ex is InvalidOperationException or ArgumentException or NotSupportedException or COMException or IOException)
        {
            Log.Info($"Capture warm-up skipped: {ex.Message}");
        }
    }

    /// <summary>Starts a capture. If one is already running, brings that overlay to the front</summary>
    /// <param name="done">What to do after the overlays close (finished or cancelled), such as bringing back the main window that was hidden</param>
    public static void Start(Settings settings, Action? done = null)
    {
        if (Current is { } running)
        {
            // Already capturing (for example the shortcut was pressed during the 180 ms the button entry waits after hiding the window): chain this call's cleanup after the running one's, so it is not lost.
            // It used to be dropped, which left the main window hidden by the button entry hidden for good
            running.done += done;
            // Bring to the front the overlay being selected on, else the one on the display under the mouse (it used to always be the first display)
            (running.Owner ?? running.OverlayUnderCursor() ?? running.overlays.FirstOrDefault())?.Activate();
            return;
        }
        Toast.CloseError(); // an error notice left from last time: what it said is in the past once another capture starts
        var session = new CaptureSession(settings, done);
        var clock = System.Diagnostics.Stopwatch.StartNew();
        try
        {
            var shots = Screens.CaptureAll();
            if (shots.Count == 0)
            {
                Log.Warn("Screen Capture: no display could be grabbed");
                done?.Invoke();
                return;
            }
            // Passing 0 = do not skip this app's windows: when capturing with the shortcut the main window may be open, and it can be hovered and selected too (so SnipToss can annotate itself)
            var windows = Screens.WindowRects(0);
            // Register first: Show() runs the message loop, and a shortcut press during that time must land on "already capturing" instead of starting a second set.
            // Any failure below is undone in the catch, otherwise Current would stay set, later presses would only "activate that overlay",
            // and Screen Capture could never open again
            Current = session;
            var markColor = ParseColor(settings.MarkColor) ?? ToolPrefs.Colors[0];
            var cursor = Screens.Cursor();
            CaptureOverlay? active = null;
            foreach (var shot in shots)
            {
                var overlay = new CaptureOverlay(session, shot, windows, markColor, settings.DefaultCategory, selectHint: !settings.Capture.SelectHintDone);
                session.overlays.Add(overlay);
                // Performance budget (1.0 exit criterion: shortcut press to overlay visible ≤ 200 ms): record when the first layer has rendered
                if (session.overlays.Count == 1) overlay.ContentRendered += (_, _) => Perf.Record($"Hotkey → capture overlay shown {clock.ElapsedMilliseconds} ms");
                overlay.Show();
                if (cursor is { } c && Contains(shot.Bounds, c)) active = overlay;
            }
            (active ?? session.overlays[0]).Activate();
        }
        catch (Exception ex)
        {
            Log.Error("Screen Capture could not open", ex);
            session.closing = true; // closing the layers below must not go through the OverlayClosed cleanup (it is done here)
            foreach (var o in session.overlays)
            {
                try
                {
                    o.Close();
                }
                catch
                {
                    // A layer that is already broken
                }
            }
            session.overlays.Clear();
            if (Current == session) Current = null;
            done?.Invoke();
            // Otherwise only the log knew: pressing the shortcut showed nothing and the user could not tell why. The error notice stays on screen
            ShowError(null, Locale.T("capture.error.start"), Locale.T("capture.error.startBody", ("app", MainWindow.AppName)), error: ex.Message);
        }
    }

    /// <summary>Selecting has started on a display: the other displays go back to fully dark. A selection that already has drawings cannot be taken over</summary>
    public bool Claim(CaptureOverlay overlay)
    {
        if (Owner == overlay) return true;
        if (Owner is { HasSelection: true } other)
        {
            if (other.IsLocked) return false;
            other.Idle();
        }
        Owner = overlay;
        foreach (var o in overlays)
            if (o != overlay) o.Idle();
        return true;
    }

    public void Release(CaptureOverlay overlay)
    {
        if (Owner != overlay) return;
        Owner = null;
        foreach (var o in overlays) o.Idle();
    }

    public void Cancel() => Close();

    /// <summary>Gives the keyboard back to the overlay with the drawings (with several displays, clicking or right-clicking another one moves focus there)</summary>
    public void FocusOwner()
    {
        if (!closing && Owner is { IsVisible: true } owner) owner.Activate();
    }

    /// <summary>Esc and the × on the toolbar: if notes have been written, warn once instead of discarding everything at once (see CaptureOverlay.GuardCancel)</summary>
    public void RequestCancel()
    {
        if (Owner?.GuardCancel() == true) return;
        Close();
    }

    public void Finish()
    {
        if (Owner is not { HasSelection: true } owner) return;
        var result = owner.Result();
        Close();
        Output output;
        try
        {
            output = Compose(result, settings.Capture.NotesInImage, settings.PromptExtra);
        }
        catch (Exception ex)
        {
            Log.Error("Screen Capture: compositing the image failed", ex);
            ShowError(result.Monitor, Locale.T("capture.error.compose"), Locale.T("capture.error.composeBody"), error: ex.Message);
            return;
        }
#if TEST_HOOKS
        CaptureFakes.Composed = output.Image;
#endif
        var notes = result.Marks.Where(m => m.HasNote).ToList();
        // If saving the file fails (disk full, the chosen folder is gone) the clipboard still gets the image: saving and copying used to be one step, so a failed save gave no image at all and everything drawn was lost
        string? file = null;
        string? saveError = null;
        try
        {
            file = Save(output.Png);
        }
        catch (Exception ex)
        {
            Log.Error("Screen Capture: saving the file failed", ex);
            saveError = ex.Message;
        }
#if TEST_HOOKS
        CaptureFakes.Saved = file;
#endif
        // When the notes are drawn into the image, put only the image on the clipboard: with both an image and text, each app picks one; some web-based AI pages take the text and lose the image, chat apps take the image.
        // With only the image, it is the same picture wherever it is pasted. Text is added only when the notes are not drawn into the image (turned off in Settings), or the notes would be lost
        var hasNotes = notes.Count > 0 || result.Overall.Length > 0;
        var text = hasNotes && !settings.Capture.NotesInImage ? HandoffText(result, notes, file, output.Size, settings.PromptExtra) : null;
        try
        {
            PutOnClipboard(output.Image, output.Png, text);
        }
        catch (Exception ex)
        {
            Log.Error("Screen Capture: copying to the clipboard failed", ex);
            // If it was saved, show the path; clicking it selects the file in File Explorer (the path used to appear in text that flashed past and could not even be selected)
            ShowError(result.Monitor, Locale.T("capture.error.clipboard"), Locale.T(file is null ? "capture.error.clipboardNoFile" : "capture.error.clipboardSaved"), file, ex.Message);
            return;
        }
        // Finished once: the first-use hint below the magnifier is not shown any more
        if (!settings.Capture.SelectHintDone) settings.Update(s => s.Capture.SelectHintDone = true);
        (string, object)[] what = [("what", notes.Count > 0 ? "notes" : result.Overall.Length > 0 ? "overall" : "image"), ("count", notes.Count)];
        // Some AI agent apps take only the image on paste (Ctrl+V in a terminal agent pastes the image), so the notes must come from the notes area below the image
        var how = Locale.T(!hasNotes ? "capture.how.plain" : settings.Capture.NotesInImage ? "capture.how.inImage" : "capture.how.notInImage");
        // The clipboard is set and only the save to the archive folder failed: that is an error too, kept on screen to be seen (click to open the folder if it exists)
        var folder = settings.Capture.FolderOrDefault;
        // The finish notice just says "copied to clipboard"; only when the notes are not drawn into the image (turned off in Settings) a line is added: pasting into an agent app would lose the notes
        var warning = hasNotes && !settings.Capture.NotesInImage ? how : "";
        if (saveError is null) ShowToast(result.Monitor, Locale.T("capture.copied", what), warning);
        else ShowError(result.Monitor, Locale.T("capture.copiedNotSaved", what), Locale.T("capture.saveFailedHint", ("how", how)), Directory.Exists(folder) ? folder : null, saveError);
    }

    /// <summary>A failure of the finish notice does not affect the clipboard that is already set (it used to share a try with the clipboard step, so a notice failure reported "copy failed")</summary>
    static void ShowToast(MonitorShot? monitor, string title, string detail)
    {
#if TEST_HOOKS
        CaptureFakes.Shown.Add(new("toast", title, detail, null, null));
#endif
        SafeShow(title, detail, () => Toast.Show(monitor ?? PrimaryMonitor(), title, detail));
    }

    /// <summary>The error notice: stays on screen, the path can be clicked open, and the original error text can be selected (<see cref="Toast.ShowError"/>)</summary>
    static void ShowError(MonitorShot? monitor, string title, string detail, string? path = null, string? error = null)
    {
#if TEST_HOOKS
        CaptureFakes.Shown.Add(new("error", title, detail, path, error));
#endif
        SafeShow(title, detail, () => Toast.ShowError(monitor ?? PrimaryMonitor(), title, detail, path, error));
    }

    static void SafeShow(string title, string detail, Action show)
    {
        try
        {
#if TEST_HOOKS
            if (CaptureFakes.ToastFails) throw new InvalidOperationException("Test hook: toast window failed");
#endif
            show();
        }
        catch (Exception ex)
        {
            // The title may contain a line break (Chinese is split over two lines); the log keeps one entry per line
            Log.Error($"Screen Capture: the notice could not be shown ({title.Replace('\n', ' ')}: {detail})", ex);
        }
    }

    /// <summary>When the overlay was never built (it could not open) the notice goes on the primary display: only the position is needed, with no real screen grab</summary>
    static MonitorShot PrimaryMonitor()
    {
        var b = System.Windows.Forms.Screen.PrimaryScreen!.Bounds;
#if TEST_HOOKS
        if (CaptureFakes.Primary is { } fake) b = new System.Drawing.Rectangle(fake.X, fake.Y, fake.Width, fake.Height); // the notice goes off screen too
#endif
        // Use the primary display's real scale (it used to be fixed at 1: on a 150% display the notice sat a bit too close to the bottom edge)
        return new MonitorShot(new Int32Rect(b.X, b.Y, b.Width, b.Height), Screens.ScaleAt(b.X, b.Y), BitmapSource.Create(1, 1, 96, 96, PixelFormats.Bgra32, null, new byte[4], 4));
    }

    bool closing;

    /// <summary>
    /// An overlay was closed, but not by the session itself (the system or another program sent a close): wind down the whole capture.
    /// Nobody used to handle this, so Current stayed set, later shortcut presses only "activated" that overlay, and Screen Capture could never open again
    /// </summary>
    public void OverlayClosed(CaptureOverlay overlay)
    {
        if (closing || !overlays.Remove(overlay)) return;
        Log.Warn("Screen Capture: an overlay was closed from outside, winding down the whole capture");
        Close();
    }

    void Close()
    {
        if (closing) return;
        closing = true;
        foreach (var o in overlays.ToList()) o.Close();
        overlays.Clear();
        if (Current == this) Current = null;
        done?.Invoke();
    }

    // ---------- Compositing the image ----------

    internal sealed record Output(BitmapSource Image, byte[] Png, (int w, int h) Size);

    /// <summary>
    /// The screenshot (the selection, in physical pixels) + marks + numbers; with notes, and when the setting is on, a notes area is added below:
    /// some AI desktop apps paste only the image when the clipboard holds both an image and text, so writing the notes into the image keeps them (openai/codex#15436)
    /// </summary>
    /// <param name="notesInImage">The setting "Include notes in the image"</param>
    /// <param name="promptExtra">The "Extra instructions" setting</param>
    internal static Output Compose(CaptureResult r, bool notesInImage, string promptExtra)
    {
        var scale = r.Monitor.Scale;
        var sel = r.Selection;
        var x = (int)Math.Round(sel.X * scale);
        var y = (int)Math.Round(sel.Y * scale);
        var w = Math.Clamp((int)Math.Round(sel.Width * scale), 1, r.Monitor.Shot.PixelWidth - x);
        var h = Math.Clamp((int)Math.Round(sel.Height * scale), 1, r.Monitor.Shot.PixelHeight - y);
        var notes = r.Marks.Where(m => m.HasNote).ToList();
        var withPanel = notesInImage && (notes.Count > 0 || r.Overall.Length > 0);
        // A very small selection with a notes area below: enlarge the screenshot by a whole factor to nearly the notes area's width and center it (it used to sit in the top-left corner of a large dark canvas)
        var k = withPanel ? Zoom(w, (int)Math.Ceiling(NotesBlock.MinWidth * scale)) : 1;
        var (zw, zh) = (w * k, h * k);
        var panel = withPanel ? NotesPanel(r, notes, zw, zh, scale, k, promptExtra) : null;
        var width = Math.Max(zw, panel?.Width ?? 0);
        var left = Math.Floor((width - zw) / 2.0);
        var height = zh + (panel?.Height ?? 0);

        var visual = new DrawingVisual();
        using (var dc = visual.RenderOpen())
        {
            dc.DrawRectangle(new SolidColorBrush(Color.FromRgb(0x14, 0x14, 0x16)), null, new Rect(0, 0, width, height));
            var shot = new CroppedBitmap(r.Monitor.Shot, new Int32Rect(x, y, w, h));
            dc.DrawImage(k == 1 ? shot : Enlarge(shot, k), new Rect(left, 0, zw, zh));
            // Mark coordinates are DIPs in the overlay: shift them to the selection's top-left and scale up to physical pixels (times the enlargement factor)
            // When the screenshot is enlarged, take only the selection's part of the pixelated version too and enlarge it with nearest-neighbor: enlarging the whole-screen image directly smears it into a gradient instead of blocks
            var (pixelated, pixelatedAt) = k > 1 && r.Pixelated is BitmapSource whole
                ? ((ImageSource)Enlarge(new CroppedBitmap(whole, new Int32Rect(x, y, w, h)), k), new Rect(x / scale, y / scale, w / scale, h / scale))
                : (r.Pixelated, r.Full);
            dc.PushClip(new RectangleGeometry(new Rect(left, 0, zw, zh)));
            dc.PushTransform(new MatrixTransform(scale * k, 0, 0, scale * k, left - sel.X * scale * k, -sel.Y * scale * k));
            foreach (var m in r.Marks) MarkPainter.Draw(dc, m, pixelated, pixelatedAt, sel, 1, k);
            dc.Pop();
            dc.Pop();
            if (panel is not null)
            {
                dc.PushTransform(new TranslateTransform(0, zh));
                panel.Draw(dc, width);
                dc.Pop();
            }
        }
        var bitmap = new RenderTargetBitmap(width, height, 96, 96, PixelFormats.Pbgra32);
        bitmap.Render(visual);
        bitmap.Freeze();
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using var ms = new MemoryStream();
        encoder.Save(ms);
        return new Output(bitmap, ms.ToArray(), (width, height));
    }

    /// <summary>How many times to enlarge the selection (imageWidth physical pixels wide) to get close to the notes area's width: a whole factor, at most 4; one that is wide enough already is not enlarged</summary>
    internal static int Zoom(int imageWidth, int panelWidth) => imageWidth <= 0 ? 1 : Math.Clamp(panelWidth / imageWidth, 1, 4);

    /// <summary>Enlarges pixel by pixel by a factor of k (nearest-neighbor): RenderTargetBitmap does not do nearest-neighbor when drawing, so stretching directly gives a blur (the same trap as Pixelate in Marks.cs)</summary>
    internal static BitmapSource Enlarge(BitmapSource source, int k)
    {
        var src = new FormatConvertedBitmap(source, PixelFormats.Bgra32, null, 0);
        int w = src.PixelWidth, h = src.PixelHeight;
        var px = new byte[w * h * 4];
        src.CopyPixels(px, w * 4, 0);
        var big = new byte[w * k * h * k * 4];
        for (var y = 0; y < h * k; y++)
            for (var x = 0; x < w * k; x++)
                Buffer.BlockCopy(px, ((y / k * w) + (x / k)) * 4, big, ((y * w * k) + x) * 4, 4);
        var result = BitmapSource.Create(w * k, h * k, 96, 96, PixelFormats.Bgra32, null, big, w * k * 4);
        result.Freeze();
        return result;
    }

    /// <summary>
    /// The notes area below the image, using the same wording as the copied text (category, position, pixel coordinates, original text):
    /// even when only the image is pasted (some AI desktop apps) the exact position is available (the coordinates are written too, which is more precise than a rough direction).
    /// extraText: the "Extra instructions" setting, drawn last (only the image goes on the clipboard, so anything not drawn in would be lost). The drawing code is in NotesBlock, which the main app's Copy as Images uses too
    /// </summary>
    internal static NotesBlock NotesPanel(CaptureResult r, List<Mark> notes, int imageWidth, int imageHeight, double s, int k, string extraText)
    {
        return NotesBlock.Build(
            NoteEntries(r, notes, (imageWidth, imageHeight)),
            r.Overall.Length > 0 ? new NoteEntry(0, default, r.OverallCategory, Locale.T("capture.note.overall"), r.Overall) : null,
            NotesTitle(notes.Count > 0),
            extraText,
            imageWidth,
            s,
            imageHeight);
    }

    /// <summary>
    /// The notes one by one: number, category, position, original text. Both the notes area below the image and the text given to the AI come from here, so the two cannot disagree.
    /// Positions are computed for the image that is handed over: if the notes area sits below an enlarged screenshot, the enlarged size is used
    /// </summary>
    internal static List<NoteEntry> NoteEntries(CaptureResult r, IEnumerable<Mark> notes, (int w, int h) size) =>
        notes.Select(m => new NoteEntry(m.Number, m.Color, m.Category, m.WhereAll(r.Marks, r.Selection, size), m.Note)).ToList();

    /// <summary>The notes area's title: with only an overall comment the image has no numbers, so it must not say "the numbers correspond one to one"</summary>
    internal static string NotesTitle(bool numbered) =>
        Locale.T(numbered ? "ai.capture.blockNumbered" : "ai.capture.blockOverall");

    // ---------- Saving the file, the clipboard, the text for the AI ----------

    string Save(byte[] png)
    {
        var dir = settings.Capture.FolderOrDefault;
        Directory.CreateDirectory(dir);
        CleanOld(dir);
        var now = DateTime.Now;
        var path = Path.Combine(dir, FileName(now, 1));
        for (var i = 2; File.Exists(path); i++) path = Path.Combine(dir, FileName(now, i));
        File.WriteAllBytes(path, png);
        return path;
    }

    /// <summary>
    /// "capture-2026-10-22_14-03-05.png", with "-n" added for the nth image within the same second. The file name carries no language and has no spaces (the path is handed to AI agents and command lines, ADR-0001 item 8;
    /// before Beta 55 it was "截图批注 2026-10-22 14-03-05.png" with the Chinese feature name, which cleanup still recognizes). The date always uses the Gregorian calendar in a fixed format: it used to follow the system region,
    /// and a Thai region wrote the Buddhist-era year 2569; the time is read only once, since reading it again on a name clash could cross a second boundary and no longer match the first image
    /// </summary>
    internal static string FileName(DateTime at, int n) =>
        "capture-" + at.ToString("yyyy-MM-dd_HH-mm-ss", CultureInfo.InvariantCulture) + (n > 1 ? "-" + n.ToString(CultureInfo.InvariantCulture) : "") + ".png";

    /// <summary>The file names cleanup recognizes: the current ones, and the pre-Beta 55 "截图批注 *.png" (written as escapes: it is not UI text, so scripts/check-i18n.mjs must not count it)</summary>
    static readonly string[] OwnFiles = ["capture-*.png", "\u622a\u56fe\u6279\u6ce8 *.png"];

    /// <summary>The default location is on the system drive, and 30 days is enough (an AI reads the file as soon as it is pasted). A folder the user chose is never cleaned</summary>
    void CleanOld(string dir)
    {
        if (!string.IsNullOrWhiteSpace(settings.Capture.Folder)) return;
        var limit = DateTime.Now.AddDays(-30);
        try
        {
            foreach (var f in OwnFiles.SelectMany(pattern => Directory.EnumerateFiles(dir, pattern)))
            {
                try
                {
                    if (File.GetLastWriteTime(f) < limit) File.Delete(f);
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    // In use or read-only: leave it for next time and carry on with the rest (one failed delete used to stop the whole pass)
                }
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
        }
    }

    internal static string HandoffText(CaptureResult r, List<Mark> notes, string? file, (int w, int h) size, string promptExtra)
    {
        var sb = new StringBuilder();
        sb.AppendLine(Locale.T(notes.Count > 0 ? "ai.capture.introNumbered" : "ai.capture.introOverall"));
        // When some note marks several places: say that the comment applies to every place (same as the main app's Copy as Text, ADR-0009)
        if (r.Marks.Any(m => m.Lead is not null)) sb.AppendLine(Locale.T("ai.manyHint"));
        // "1. Change · Region: top left of the frame (x 10%–40%, y 5%–25%), x=100 y=50 w=300 h=200 px: ...", with the category and position worded the same as the main app's copied text
        // Numbers are always written in a fixed format (not following the system region: some regions use a comma as the decimal point and have thousands separators, which would make the AI misread the coordinates)
        foreach (var e in NoteEntries(r, notes, size))
            sb.AppendLine(Locale.T("ai.capture.line", ("n", e.Number), ("category", Categories.Label(e.Category)), ("where", e.Where), ("note", e.Body)));
        if (r.Overall.Length > 0) sb.AppendLine(Locale.T("ai.capture.overallLine", ("category", Categories.Label(r.OverallCategory)), ("note", r.Overall)));
        sb.AppendLine();
        // When the file was not saved, do not write a path (the AI would go looking for a file that does not exist)
        // This text is only put on the clipboard when the notes are not drawn into the image (Finish), so it does not mention "below the image"
        sb.AppendLine(file is null ? Locale.T("ai.capture.image", ("w", size.w), ("h", size.h)) : Locale.T("ai.capture.file", ("file", file), ("w", size.w), ("h", size.h)));
        if (promptExtra.Length > 0)
        {
            sb.AppendLine();
            sb.AppendLine(promptExtra);
        }
        return sb.ToString().TrimEnd();
    }

    /// <summary>The clipboard gets all of: a bitmap (CF_DIB), a PNG (programs built on a browser engine read it first), and text (when there are notes)</summary>
    static void PutOnClipboard(BitmapSource image, byte[] png, string? text)
    {
        var data = new DataObject();
        data.SetImage(new FormatConvertedBitmap(image, PixelFormats.Bgr32, null, 0));
        data.SetData("PNG", new MemoryStream(png), false);
        if (text is not null) data.SetText(text, TextDataFormat.UnicodeText);
        ClipboardWriter.Put(data);
    }

    static Color? ParseColor(string hex)
    {
        try
        {
            return (Color)ColorConverter.ConvertFromString(hex);
        }
        catch (FormatException)
        {
            return null;
        }
    }

}

/// <summary>A one-line notice in the middle of the screen after finishing: appears at once and disappears at once after 1.5 seconds; an opaque medium-dark gray background; takes no focus (the user is about to paste into another app)</summary>
static class Toast
{
#if TEST_HOOKS
    static readonly List<Window> shown = [];

    /// <summary>Test entry point: the notice windows that are open (toast = finish notice, error = error notice)</summary>
    internal static IEnumerable<(string Kind, Window Window)> Open
    {
        get
        {
            foreach (var w in shown) yield return ("toast", w);
            if (errorWindow is { } e) yield return ("error", e);
        }
    }

    internal static Window? Error => errorWindow;
#endif

    /// <param name="detail">The second line, normally empty (only when the notes are not drawn into the image, it warns that the notes would be lost)</param>
    public static void Show(MonitorShot monitor, string title, string detail)
    {
        // A roughly square notice in the middle of the screen (like the system's volume or brightness popup): a large "clipboard with a check mark" icon on top, one sentence below
        var stack = new StackPanel { VerticalAlignment = VerticalAlignment.Center };
        stack.Children.Add(CopiedIcon());
        stack.Children.Add(new TextBlock
        {
            Text = KeepWords.Of(title),
            FontSize = 15, // --fs-title
            LineHeight = 22,
            FontWeight = FontWeights.Bold, // not SemiBold: fonts without a semibold weight (such as Microsoft JhengHei) fall back to regular, so the weight would differ between scripts
            Foreground = NativeUi.Text,
            FontFamily = MarkPainter.Font,
            TextWrapping = TextWrapping.Wrap,
            TextAlignment = TextAlignment.Center,
            Margin = new Thickness(0, 12, 0, 0),
        });
        // The second line uses the primary text color too (not Text2): the background is translucent, and gray text has too little contrast over a white backdrop; hierarchy comes from size and weight
        if (detail.Length > 0)
            stack.Children.Add(new TextBlock { Text = KeepWords.Of(detail), FontSize = 12, LineHeight = 18, Foreground = NativeUi.Text, FontFamily = MarkPainter.Font, TextWrapping = TextWrapping.Wrap, TextAlignment = TextAlignment.Center, Margin = new Thickness(0, 6, 0, 0) });
        var content = Translucent(new Border
        {
            Width = 196, // one Chinese sentence (15 pt) fits on a line; longer languages wrap to two or three lines and still come out roughly square
            MinHeight = 152,
            Background = NativeUi.ToastSurface,
            BorderBrush = NativeUi.ToastBorder,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(12), // --r-dialog
            Padding = new Thickness(14, 18, 14, 18),
            Margin = new Thickness(ShadowRoom),
            Child = stack,
        });
        var window = new Window
        {
            WindowStyle = WindowStyle.None,
            AllowsTransparency = true,
            Background = Brushes.Transparent,
            ShowInTaskbar = false,
            Topmost = true,
            ShowActivated = false,
            SizeToContent = SizeToContent.WidthAndHeight,
            Focusable = false,
            Content = content,
        };
        window.SourceInitialized += (_, _) =>
        {
            var hwnd = new WindowInteropHelper(window).Handle;
            // Takes no focus and cannot be clicked (the mouse passes through)
            _ = SetWindowLong(hwnd, -20, GetWindowLong(hwnd, -20) | 0x08000000 /* NOACTIVATE */ | 0x00000080 /* TOOLWINDOW */ | 0x00000020 /* TRANSPARENT */);
            ExcludeFromCapture(hwnd);
        };
        window.Loaded += (_, _) =>
        {
            PlaceOn(window, monitor);
            // Appears at once and disappears at once after 1.5 seconds (no fading: seen at a glance, then out of the way)
            var life = new System.Windows.Threading.DispatcherTimer(TimeSpan.FromMilliseconds(1500), System.Windows.Threading.DispatcherPriority.Normal, (s, _) =>
            {
                ((System.Windows.Threading.DispatcherTimer)s!).Stop();
                window.Close();
            }, window.Dispatcher);
            life.Start();
        };
#if TEST_HOOKS
        shown.Add(window);
        window.Closed += (_, _) => shown.Remove(window);
#endif
        window.Show();
    }

    /// <summary>
    /// The "copied to clipboard" icon: a clipboard with a check mark. Drawn like the UI's line icons (a 16-unit grid, round caps and joins, icons.tsx) and enlarged to 36;
    /// the board uses the text color and the check mark the accent color
    /// </summary>
    static FrameworkElement CopiedIcon()
    {
        System.Windows.Shapes.Path Line(string data, Brush stroke) => new()
        {
            Data = Geometry.Parse(data),
            Stroke = stroke,
            StrokeThickness = 1.05, // about 2.4 after enlarging
            StrokeStartLineCap = PenLineCap.Round,
            StrokeEndLineCap = PenLineCap.Round,
            StrokeLineJoin = PenLineJoin.Round,
        };
        var icon = new Grid { Width = 16, Height = 16, HorizontalAlignment = HorizontalAlignment.Center, LayoutTransform = new ScaleTransform(2.25, 2.25) };
        icon.Children.Add(Line("M5.5 3H4.5A1.5 1.5 0 0 0 3 4.5V13A1.5 1.5 0 0 0 4.5 14.5H11.5A1.5 1.5 0 0 0 13 13V4.5A1.5 1.5 0 0 0 11.5 3H10.5", NativeUi.Text));
        icon.Children.Add(Line("M6.5 1.75H9.5A1 1 0 0 1 10.5 2.75V3.25A1 1 0 0 1 9.5 4.25H6.5A1 1 0 0 1 5.5 3.25V2.75A1 1 0 0 1 6.5 1.75Z", NativeUi.Text));
        icon.Children.Add(Line("M5.6 9.1L7.2 10.7L10.4 7.3", NativeUi.Accent));
        return icon;
    }

    /// <summary>The space left around the card for the shadow (DIP): the window is this much larger than the card on each side</summary>
    const double ShadowRoom = 24;

    /// <summary>
    /// A translucent card with a shadow: the shadow is drawn as a separate layer with the part under the card cut out. Adding a DropShadowEffect to the card directly would draw the shadow underneath it,
    /// showing through lighter at the top and darker at the bottom (CSS box-shadow does not paint under the element, and the zoom bar in the UI is even)
    /// </summary>
    static FrameworkElement Translucent(Border card)
    {
        var shadow = new Border
        {
            Background = Brushes.Black,
            CornerRadius = card.CornerRadius,
            Margin = card.Margin,
            Effect = new System.Windows.Media.Effects.DropShadowEffect { BlurRadius = 24, ShadowDepth = 8, Direction = 270, Opacity = 0.45 },
        };
        var shade = new Grid { Children = { shadow } };
        var root = new Grid { Children = { shade, card } };
        root.SizeChanged += (_, e) =>
        {
            var m = card.Margin;
            var hole = new Rect(m.Left, m.Top, Math.Max(0, e.NewSize.Width - m.Left - m.Right), Math.Max(0, e.NewSize.Height - m.Top - m.Bottom));
            shade.Clip = new CombinedGeometry(GeometryCombineMode.Exclude, new RectangleGeometry(new Rect(e.NewSize)), new RectangleGeometry(hole, card.CornerRadius.TopLeft, card.CornerRadius.TopLeft));
        };
        return root;
    }

    /// <summary>Puts the notice on the display that was captured (<see cref="Place"/>)</summary>
    static void PlaceOn(Window window, MonitorShot monitor)
    {
        var hwnd = new WindowInteropHelper(window).Handle;
        GetWindowRect(hwnd, out var r);
        var (x, y) = Place(WorkArea(monitor.Bounds), r.Right - r.Left, r.Bottom - r.Top);
        SetWindowPos(hwnd, new IntPtr(-1), x, y, 0, 0, 0x0001 /* NOSIZE */ | 0x0010 /* NOACTIVATE */);
    }

    /// <summary>
    /// The notice window's top-left corner (physical pixels): in the middle of the work area (without the taskbar) — after capturing, the eye is still on the middle of the screen and does not have to look down for it.
    /// The space left around the card for the shadow is equal on all sides, so centering the window centers the card. When the window is larger than the work area it sits at the work area's top-left
    /// </summary>
    internal static (int X, int Y) Place(Int32Rect work, int width, int height) =>
        (work.X + Math.Max(0, (work.Width - width) / 2), work.Y + Math.Max(0, (work.Height - height) / 2));

    /// <summary>This display's work area (physical pixels); if the system does not have this display (a fake one in tests) the whole display is used</summary>
    static Int32Rect WorkArea(Int32Rect bounds)
    {
        foreach (var s in System.Windows.Forms.Screen.AllScreens)
        {
            if (s.Bounds.X == bounds.X && s.Bounds.Y == bounds.Y && s.Bounds.Width == bounds.Width && s.Bounds.Height == bounds.Height)
                return new Int32Rect(s.WorkingArea.X, s.WorkingArea.Y, s.WorkingArea.Width, s.WorkingArea.Height);
        }
        return bounds;
    }

    static Window? errorWindow;

    /// <summary>When another capture starts, closes the error notice left from last time (what it says is in the past)</summary>
    public static void CloseError()
    {
        errorWindow?.Close();
        errorWindow = null;
    }

    /// <summary>
    /// The error notice (it used to fade out after two and a half seconds like a success notice, could not be clicked, and its archive path could not be selected):
    /// it stays until closed with the × at the top right or Esc; detail says what to do; path: where the image or folder is, and clicking it selects it in File Explorer;
    /// error: the system's original text, selectable for copying; "Open Log" at the bottom right. It takes no focus when it appears (ShowActivated = false) and is activated by a click, which is what makes the original text selectable
    /// </summary>
    public static void ShowError(MonitorShot monitor, string title, string detail, string? path = null, string? error = null)
    {
        CloseError();
        Window window = null!; // the close button closes this very window
        window = new Window
        {
            WindowStyle = WindowStyle.None,
            AllowsTransparency = true,
            Background = Brushes.Transparent,
            ShowInTaskbar = false,
            Topmost = true,
            ShowActivated = false,
            SizeToContent = SizeToContent.WidthAndHeight,
            FontFamily = MarkPainter.Font,
            Content = ErrorContent(title, detail, path, error, () => window.Close()),
        };
        window.SourceInitialized += (_, _) =>
        {
            var hwnd = new WindowInteropHelper(window).Handle;
            // Stays out of Alt+Tab (tool window); it can be clicked and its text selected, so NOACTIVATE / TRANSPARENT are not added
            _ = SetWindowLong(hwnd, -20, GetWindowLong(hwnd, -20) | 0x00000080 /* TOOLWINDOW */);
            ExcludeFromCapture(hwnd);
        };
        // Once it has been clicked (activated), Esc closes it too (the comment always said so, but it used to be only the ×)
        window.PreviewKeyDown += (_, e) =>
        {
            if (e.Key != Key.Escape) return;
            e.Handled = true;
            window.Close();
        };
        window.Loaded += (_, _) => PlaceOn(window, monitor);
        window.Closed += (_, _) =>
        {
            if (errorWindow == window) errorWindow = null;
        };
        errorWindow = window;
        window.Show();
    }

    /// <summary>The contents of the error notice: title + ×, what to do, the path link, the original-text box, "Open Log" (split out so unit tests can check it without opening a window)</summary>
    internal static FrameworkElement ErrorContent(string title, string detail, string? path, string? error, Action close)
    {
        var closeButton = NativeUi.CloseButton(close);
        DockPanel.SetDock(closeButton, Dock.Right);
        var head = new DockPanel { Margin = new Thickness(0, 0, -8, 0) };
        head.Children.Add(closeButton);
        // The title wraps: it used to be a single line, and a long one ran under the × and was cut off (English overflowed); the × is aligned with the first line
        closeButton.VerticalAlignment = VerticalAlignment.Top;
        head.Children.Add(new TextBlock { Text = KeepWords.Of(title), FontSize = 13, LineHeight = 20, FontWeight = FontWeights.SemiBold, Foreground = NativeUi.Text, TextWrapping = TextWrapping.Wrap, VerticalAlignment = VerticalAlignment.Center, Margin = new Thickness(0, 2, 8, 2) });
        var stack = new StackPanel { Width = 480 };
        stack.Children.Add(head);
        stack.Children.Add(new TextBlock { Text = KeepWords.Of(detail), FontSize = 12, LineHeight = 18, Foreground = NativeUi.Text2, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 4, 0, 0) });
        if (path is not null)
        {
            var link = new System.Windows.Documents.Hyperlink(new System.Windows.Documents.Run(path)) { Foreground = NativeUi.Accent };
            link.Click += (_, _) => Reveal(path);
            stack.Children.Add(new TextBlock(link) { FontSize = 12, LineHeight = 18, TextWrapping = TextWrapping.Wrap, Margin = new Thickness(0, 8, 0, 0), Cursor = Cursors.Hand, ToolTip = path });
        }
        if (error is not null)
        {
            var box = NativeUi.Detail(error);
            box.Margin = new Thickness(0, 12, 0, 0);
            stack.Children.Add(box);
        }
        var buttons = new ButtonRow { Margin = new Thickness(0, 12, 0, 0) };
        buttons.Children.Add(NativeUi.MakeButton(Locale.T("app.error.openLog"), false, _ => Reveal(Log.Dir), Dock.Right));
        stack.Children.Add(buttons);
        return new Border
        {
            Background = NativeUi.Surface2,
            BorderBrush = NativeUi.Border,
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(10),
            Padding = new Thickness(16, 12, 16, 16),
            Margin = new Thickness(ShadowRoom),
            Child = stack,
            Effect = new System.Windows.Media.Effects.DropShadowEffect { BlurRadius = 24, ShadowDepth = 8, Direction = 270, Opacity = 0.45 },
        };
    }

    /// <summary>Selects it in File Explorer; if it is gone already, so be it (the notice stays and the original text has the path)</summary>
    static void Reveal(string path)
    {
        try
        {
            Shell.Reveal(path);
        }
        catch (Exception ex)
        {
            Log.Warn($"Reveal {path}", ex);
        }
    }

    /// <summary>
    /// Keeps this notice out of screen grabs: when another capture is made within a couple of seconds of finishing, the previous notice (a layered window, which CAPTUREBLT would include) does not show up in the new frozen picture.
    /// Available since Windows 10 2004; on earlier systems this step fails and the notice is shown as usual
    /// </summary>
    static void ExcludeFromCapture(IntPtr hwnd)
    {
        if (!SetWindowDisplayAffinity(hwnd, 0x11 /* WDA_EXCLUDEFROMCAPTURE */)) Log.Info($"The notice window could not be excluded from screen grabs (error code {Marshal.GetLastPInvokeError()})");
    }

}
