using System.Collections.Specialized;
using System.IO;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using SnipToss.App.Capture;

namespace SnipToss.App;

/// <summary>
/// The main app's "Copy as Images" (for people using web-based AI or chat apps: those can't read local paths, they need images).
/// One image per page: a header line "project / file" on top, the picture in the middle, and below it a notes area in the same style as Screen Capture (NotesBlock), one entry per note.
/// The picture is drawn by the UI (the frame with the marks of all its notes and their numbers, or several frames in a grid; stashed here before the copy, see Stash),
/// or it is a note's stored snapshot (the one in .sniptoss/snapshots, marks already drawn). Pages without a picture (folder comments, snapshot not generated) have only the two text blocks.
///
/// Clipboard: one image goes on as an image (bitmap + PNG), so pasting anywhere gives that image; several are saved as image files and put on the clipboard as a file list (as if several files were copied in File Explorer),
/// so a browser can take several at once (pasting in Edge hands the page two File objects), and chat apps accept files too. Neither carries text:
/// when both image and text are present, each program picks one on its own (some web-based AI pages pick the text and the image is lost; browsers simply drop the text when files are present)
/// </summary>
static class HandoffImages
{
    /// <summary>
    /// One image. Picture is the stashed picture's PNG bytes (null if none), Snapshot the full path of a stored snapshot (null if none; used when there is no Picture);
    /// Title is the header line (empty = none); Name is the file name when saved as a file (no extension)
    /// </summary>
    public sealed record Page(byte[]? Picture, string? Snapshot, string Title, IReadOnlyList<NoteEntry> Notes, string Name);

    /// <summary>The pictures the UI handed over for the copy in progress (one batch at a time: a new batch id drops the earlier ones)</summary>
    static readonly Dictionary<string, byte[]> Stashed = [];
    static string? stashBatch;

    /// <summary>Keeps a picture drawn by the UI until the copy that uses it; returns the id a page refers to it by</summary>
    public static string Stash(string batch, byte[] png)
    {
        lock (Stashed)
        {
            if (stashBatch != batch)
            {
                Stashed.Clear();
                stashBatch = batch;
            }
            var id = $"{batch}/{Stashed.Count + 1}";
            Stashed[id] = png;
            return id;
        }
    }

    /// <summary>The stashed picture with this id; null when it is unknown (dropped by a newer batch)</summary>
    public static byte[]? StashedPicture(string id)
    {
        lock (Stashed) return Stashed.GetValueOrDefault(id);
    }

    /// <summary>The copy is done (or failed for good): let go of the pictures</summary>
    public static void DropStash()
    {
        lock (Stashed)
        {
            Stashed.Clear();
            stashBatch = null;
        }
    }

    /// <summary>Where several images are saved; the files in it are what goes on the clipboard. Kept for 7 days, so a copy pasted days later can still be found. Tests swap in a temp directory</summary>
    internal static string Folder { get; set; } = Path.Combine(AppPaths.LocalDir, "handoff");

    static readonly TimeSpan Keep = TimeSpan.FromDays(7);

    /// <summary>Draws the images and puts them on the clipboard; returns how many</summary>
    public static int Copy(IReadOnlyList<Page> pages, string? extra)
    {
        var (data, count) = Prepare(pages, extra);
        ClipboardWriter.Put(data); // when another program holds the clipboard, retries a few times, then throws (the UI says the clipboard is in use)
        return count;
    }

    /// <summary>What goes on the clipboard (for several images the files are already saved). Split out so tests don't touch the system clipboard</summary>
    internal static (DataObject Data, int Count) Prepare(IReadOnlyList<Page> pages, string? extra)
    {
        if (pages.Count == 0) throw new ArgumentException("Nothing to copy");
        // The closing paragraph ("Extra instructions") is said once, at the end of the last image
        var images = pages.Select((p, k) => Render(p, k == pages.Count - 1 ? extra : null)).ToList();
        var data = new DataObject();
        if (images.Count == 1)
        {
            data.SetImage(new FormatConvertedBitmap(images[0].Image, PixelFormats.Bgr32, null, 0));
            data.SetData("PNG", new MemoryStream(images[0].Png), false);
        }
        else
        {
            Cleanup();
            var dir = Path.Combine(Folder, DateTime.Now.ToString("yyyyMMdd-HHmmss-fff", System.Globalization.CultureInfo.InvariantCulture));
            Directory.CreateDirectory(dir);
            var files = new StringCollection();
            for (var k = 0; k < images.Count; k++)
            {
                var path = Path.Combine(dir, FileName(k + 1, pages[k].Name));
                File.WriteAllBytes(path, images[k].Png);
                files.Add(path);
            }
            data.SetFileDropList(files);
        }
        return (data, images.Count);
    }

    /// <summary>
    /// One image: title, picture, notes area. Font sizes scale with the image width (1x up to 800 wide, at most 2.5x): AI shrinks large images, and small text becomes unreadable.
    /// When the notes in one column are taller than the picture and the image is wide enough, they are laid out in two columns (several notes on one image must not make it endlessly tall)
    /// </summary>
    internal static (BitmapSource Image, byte[] Png) Render(Page page, string? extra)
    {
        var shot = Decode(page.Picture) ?? Load(page.Snapshot);
        var width = Math.Max(shot?.PixelWidth ?? 0, 720);
        var s = Math.Clamp(width / 800.0, 1, 2.5);
        var shotHeight = shot?.PixelHeight ?? 0;
        var notes = NotesBlock.Build(page.Notes, null, null, extra, width, s, shot is null ? int.MaxValue : shotHeight);
        width = Math.Max(width, notes.Width);

        var pad = 14 * s;
        var title = page.Title.Length == 0 ? null : MarkPainter.Text(page.Title, 13 * s, new SolidColorBrush(Color.FromRgb(0xb4, 0xb4, 0xbc)), 1);
        if (title is not null)
        {
            title.MaxTextWidth = Math.Max(40, width - pad * 2);
            title.MaxLineCount = 1;
            title.Trimming = TextTrimming.CharacterEllipsis;
        }
        var headHeight = title is null ? 0 : (int)Math.Ceiling(title.Height + pad * 2);
        var height = headHeight + shotHeight + notes.Height;

        var visual = new DrawingVisual();
        using (var dc = visual.RenderOpen())
        {
            dc.DrawRectangle(new SolidColorBrush(Color.FromRgb(0x14, 0x14, 0x16)), null, new Rect(0, 0, width, height));
            if (title is not null) dc.DrawText(title, new Point(pad, pad));
            // Draw the snapshot by pixels (its own recorded DPI isn't necessarily 96)
            if (shot is not null) dc.DrawImage(shot, new Rect(Math.Floor((width - shot.PixelWidth) / 2.0), headHeight, shot.PixelWidth, shot.PixelHeight));
            dc.PushTransform(new TranslateTransform(0, headHeight + shotHeight));
            notes.Draw(dc, width);
            dc.Pop();
        }
        var bitmap = new RenderTargetBitmap(width, height, 96, 96, PixelFormats.Pbgra32);
        bitmap.Render(visual);
        bitmap.Freeze();
        var encoder = new PngBitmapEncoder();
        encoder.Frames.Add(BitmapFrame.Create(bitmap));
        using var ms = new MemoryStream();
        encoder.Save(ms);
        return (bitmap, ms.ToArray());
    }

    /// <summary>The picture the UI drew (PNG bytes); null if there is none or it cannot be decoded (the page then falls back to its snapshot, or to text only)</summary>
    static BitmapSource? Decode(byte[]? png)
    {
        if (png is null) return null;
        try
        {
            var image = new BitmapImage();
            image.BeginInit();
            image.CacheOption = BitmapCacheOption.OnLoad;
            image.StreamSource = new MemoryStream(png);
            image.EndInit();
            image.Freeze();
            return image;
        }
        catch (Exception ex) when (ex is NotSupportedException or FileFormatException or IOException)
        {
            Log.Warn($"Copy as images: the picture from the UI cannot be decoded ({ex.Message})");
            return null;
        }
    }

    /// <summary>Reads the snapshot; absent or unreadable counts as none (this item is text only). Reading allows others to write and delete at the same time (an agent may be working in .sniptoss)</summary>
    static BitmapSource? Load(string? path)
    {
        if (path is null || !File.Exists(path)) return null;
        try
        {
            using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            var image = new BitmapImage();
            image.BeginInit();
            image.CacheOption = BitmapCacheOption.OnLoad;
            image.StreamSource = fs;
            image.EndInit();
            image.Freeze();
            return image;
        }
        catch (Exception ex) when (ex is IOException or NotSupportedException or UnauthorizedAccessException or FileFormatException)
        {
            Log.Warn($"Copy as images: snapshot unreadable, text only: {path} ({ex.Message})");
            return null;
        }
    }

    /// <summary>"01 hero.png note 3.png": that is the name the attachment shows on a web page, so both AI and people can tell which note it is. Characters not allowed in file names are removed, and long names are truncated</summary>
    internal static string FileName(int seq, string name)
    {
        var bad = Path.GetInvalidFileNameChars();
        var clean = new string(name.Select(c => bad.Contains(c) ? '_' : c).ToArray()).Trim().TrimEnd('.');
        if (clean.Length > 80) clean = clean[..80];
        return $"{seq:00} {clean}.png";
    }

    /// <summary>Deletes the image folders left by copies made more than 7 days ago</summary>
    static void Cleanup()
    {
        if (!Directory.Exists(Folder)) return;
        foreach (var dir in Directory.EnumerateDirectories(Folder))
        {
            try
            {
                if (DateTime.Now - Directory.GetCreationTime(dir) > Keep) Directory.Delete(dir, recursive: true);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                // In use (a browser is still reading it): delete it next time
            }
        }
    }
}
