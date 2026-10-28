using System.Collections.Concurrent;
using System.IO;
using System.Security.Cryptography;
using System.Text;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace SnipToss.App;

/// <summary>
/// Images WebView2 can't display itself (TIFF, HEIC / HEIF): converted to PNG with Windows' image decoding (WIC) into the local cache (LocalDir\cache\decoded), and the UI reads them through the virtual host Host.
/// Cache files are named from "full path + size + modification time", so the same file isn't converted twice; the file name carries the original image size (the image is downscaled if the decoded result is too large, and the UI records positions in the original size). The item itself is untouched.
/// For a multi-page TIFF the first page is used; TIFF is rotated upright per its recorded orientation (System.Photo.Orientation); the HEIF decoder already applies rotation and mirroring itself
/// </summary>
static class DecodedImages
{
    public const string Host = "decoded.sniptoss.example";

    static string dir = Path.Combine(AppPaths.LocalDir, "cache", "decoded");

    /// <summary>Tests swap in a temp directory</summary>
    internal static string Dir
    {
        get => dir;
        set => dir = value;
    }

    static readonly HashSet<string> Heif = new(StringComparer.OrdinalIgnoreCase) { ".heic", ".heif" };
    static readonly HashSet<string> Exts = new(StringComparer.OrdinalIgnoreCase) { ".tif", ".tiff", ".heic", ".heif" };

    /// <summary>Extensions that need the shell to convert them before they can be shown (the UI's DECODED_EXT in library.ts matches this list)</summary>
    public static bool Needs(string path) => Exts.Contains(Path.GetExtension(path));

    /// <summary>Largest decoded size: 16384 on a side, 64 million pixels in total (same limit as the UI's screenshot canvas). Anything bigger is scaled down proportionally, which is enough for display</summary>
    internal const int MaxSide = 16384;
    internal const long MaxPixels = 64L * 1024 * 1024;

    /// <summary>The cache takes at most this much; beyond it the least recently used files are deleted first; anything unused for 30 days is deleted too</summary>
    internal const long MaxBytes = 1024L * 1024 * 1024;
    static readonly TimeSpan MaxAge = TimeSpan.FromDays(30);

    /// <param name="File">The PNG in the cache (on success)</param>
    /// <param name="Width">Width and height of the original image (after rotating upright); the PNG may be downscaled</param>
    /// <param name="Problem">Why it wasn't converted: heif = the HEIF Image Extensions aren't installed; hevc = the HEIF extension is installed but no picture could be decoded (usually the HEVC Video Extensions are missing, or the file is corrupt); unreadable = the file is corrupt or not this format</param>
    public sealed record Result(string? File, int Width, int Height, string? Problem);

    static readonly ConcurrentDictionary<string, Lazy<Task<Result>>> Running = new(StringComparer.Ordinal);

    /// <summary>
    /// The converted PNG (used directly if it is in the cache). Several simultaneous requests for the same file convert it only once; conversion runs on a background thread.
    /// Failures are not remembered: after installing the extension or repairing the file, opening it converts it again
    /// </summary>
    public static Task<Result> GetAsync(string path)
    {
        var info = new FileInfo(path);
        if (!info.Exists) throw new FileNotFoundException($"File not found: {path}", path);
        var key = KeyOf(info);
        if (Cached(key) is { } hit) return Task.FromResult(hit);
        var running = Running.GetOrAdd(key, k => new Lazy<Task<Result>>(() => Task.Run(() => Convert(info.FullName, k))));
        var task = running.Value;
        task.ContinueWith(_ => Running.TryRemove(KeyValuePair.Create(key, running)), TaskScheduler.Default);
        return task;
    }

    /// <summary>Full path (case-insensitive) + size + modification time → 32 hex characters</summary>
    internal static string KeyOf(FileInfo f) =>
        System.Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes($"{f.FullName.ToUpperInvariant()}|{f.Length}|{f.LastWriteTimeUtc.Ticks}")))[..32].ToLowerInvariant();

    /// <summary>The converted file in the cache: key-WIDTHxHEIGHT.png. A file that is used gets its modification time touched; cleanup treats that as its last use</summary>
    static Result? Cached(string key)
    {
        if (!Directory.Exists(Dir)) return null;
        foreach (var file in Directory.EnumerateFiles(Dir, key + "-*.png"))
        {
            var size = Path.GetFileNameWithoutExtension(file)[(key.Length + 1)..].Split('x');
            if (size.Length != 2 || !int.TryParse(size[0], out var w) || !int.TryParse(size[1], out var h)) continue;
            try
            {
                File.SetLastWriteTimeUtc(file, DateTime.UtcNow);
            }
            catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
            {
                // Failing to touch it is harmless; it only affects the order of cleanup
            }
            return new Result(file, w, h, null);
        }
        return null;
    }

    static Result Convert(string path, string key)
    {
        var heif = Heif.Contains(Path.GetExtension(path));
        try
        {
            using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            var (image, w, h) = Decode(stream, heif);
            Directory.CreateDirectory(Dir);
            var target = Path.Combine(Dir, string.Create(System.Globalization.CultureInfo.InvariantCulture, $"{key}-{w}x{h}.png"));
            var temp = target + "." + Guid.NewGuid().ToString("N")[..8] + ".tmp";
            try
            {
                var encoder = new PngBitmapEncoder();
                encoder.Frames.Add(BitmapFrame.Create(image));
                using (var output = File.Create(temp)) encoder.Save(output);
                File.Move(temp, target, overwrite: true);
            }
            finally
            {
                if (File.Exists(temp)) File.Delete(temp);
            }
            return new Result(target, w, h, null);
        }
        // Don't catch failures to read the file or write the cache (IOException and the like): that isn't a problem with the image, so report it as usual
        catch (Exception ex) when (ex is NotSupportedException or FileFormatException or ArgumentException or InvalidOperationException or OverflowException or System.Runtime.InteropServices.COMException)
        {
            var problem = Classify(ex, heif, LooksLikeHeif(path));
            Log.Info($"Image not decoded ({problem}): {path}: {ex.Message}");
            return new Result(null, 0, 0, problem);
        }
    }

    /// <summary>
    /// Decodes the first page, rotates it upright, shrinks it if too big, converts the colors to sRGB and the pixel format to one PNG can store. Returns the width and height of the original (after rotating upright)
    /// </summary>
    internal static (BitmapSource Image, int Width, int Height) Decode(Stream stream, bool heif)
    {
        // Not read into memory whole (None): a large image is pulled through the scaling and rotation and only decoded when the PNG is saved. The stream stays open until saving is done (the caller's responsibility)
        var decoder = BitmapDecoder.Create(stream, BitmapCreateOptions.PreservePixelFormat | BitmapCreateOptions.IgnoreColorProfile, BitmapCacheOption.None);
        BitmapSource image = decoder.Frames[0];
        image = ToSrgb(decoder.Frames[0], image);
        if (!heif) image = Orient(image, OrientationOf(decoder.Frames[0]));
        var (w, h) = (image.PixelWidth, image.PixelHeight);
        var k = ScaleFor(w, h);
        if (k < 1) image = new TransformedBitmap(image, new ScaleTransform(k, k));
        if (image.Format != PixelFormats.Bgra32 && image.Format != PixelFormats.Bgr32 && image.Format != PixelFormats.Rgb24 && image.Format != PixelFormats.Gray8)
            image = new FormatConvertedBitmap(image, PixelFormats.Bgra32, null, 0);
        image.Freeze();
        return (image, w, h);
    }

    /// <summary>The scale that fits within MaxSide and MaxPixels (never enlarges)</summary>
    internal static double ScaleFor(int w, int h) => Math.Min(1, Math.Min((double)MaxSide / Math.Max(w, h), Math.Sqrt((double)MaxPixels / ((double)w * h))));

    /// <summary>With a color profile (camera or print TIFFs, Display P3 HEIC): convert to sRGB, otherwise the colors look gray or shifted. If it can't be converted, keep the image as is</summary>
    static BitmapSource ToSrgb(BitmapFrame frame, BitmapSource image)
    {
        try
        {
            if (frame.ColorContexts is not { Count: > 0 } contexts) return image;
            var converted = new ColorConvertedBitmap(image, contexts[0], new ColorContext(PixelFormats.Bgra32), PixelFormats.Bgra32);
            // The conversion happens only when pixels are read: read one pixel first, so an image that can't be converted (non-ICC profiles such as HEIF's nclx) falls back to the original here instead of failing the whole image when saving the PNG
            converted.CopyPixels(new System.Windows.Int32Rect(0, 0, 1, 1), new byte[4], 4, 0);
            return converted;
        }
        catch (Exception ex) when (ex is NotSupportedException or ArgumentException or InvalidOperationException or System.Runtime.InteropServices.COMException or FileFormatException)
        {
            return image;
        }
    }

    /// <summary>EXIF / TIFF orientation (1–8); 1 if not recorded</summary>
    static int OrientationOf(BitmapFrame frame)
    {
        try
        {
            return frame.Metadata is BitmapMetadata m && m.GetQuery("System.Photo.Orientation") is ushort o and >= 1 and <= 8 ? o : 1;
        }
        catch (Exception ex) when (ex is NotSupportedException or ArgumentException or InvalidOperationException or System.Runtime.InteropServices.COMException)
        {
            return 1;
        }
    }

    /// <summary>Rotates upright by orientation: 2 mirror horizontally, 3 rotate 180°, 4 mirror vertically, 5 mirror horizontally then rotate 90° counter-clockwise, 6 rotate 90° clockwise, 7 mirror horizontally then rotate 90° clockwise, 8 rotate 90° counter-clockwise</summary>
    internal static BitmapSource Orient(BitmapSource image, int orientation)
    {
        var (mirror, angle) = orientation switch
        {
            2 => (true, 0),
            3 => (false, 180),
            4 => (true, 180),
            5 => (true, 270),
            6 => (false, 90),
            7 => (true, 90),
            8 => (false, 270),
            _ => (false, 0),
        };
        if (!mirror && angle == 0) return image;
        var t = new TransformGroup();
        if (mirror) t.Children.Add(new ScaleTransform(-1, 1));
        if (angle != 0) t.Children.Add(new RotateTransform(angle));
        return new TransformedBitmap(image, t);
    }

    /// <summary>The file starts with an ISO media ftyp box (the HEIF container): if it is HEIF and Windows doesn't recognize it, say the extension is missing; otherwise the file is corrupt</summary>
    internal static bool LooksLikeHeif(string path)
    {
        try
        {
            using var s = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            Span<byte> head = stackalloc byte[12];
            return s.ReadAtLeast(head, head.Length, throwOnEndOfStream: false) == head.Length && head[4..8].SequenceEqual("ftyp"u8);
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    /// <summary>
    /// Why it wasn't converted. HEIF: Windows has no decoder that recognizes it (WINCODEC_ERR_COMPONENTNOTFOUND) = the HEIF Image Extensions aren't installed;
    /// recognized but no picture decoded = usually the HEVC Video Extensions are missing (the picture in a HEIC is HEVC-encoded), or the file may be corrupt. Everything else counts as a corrupt file
    /// </summary>
    internal static string Classify(Exception ex, bool heif, bool heifContainer)
    {
        if (!heif || !heifContainer) return "unreadable";
        for (var e = ex; e is not null; e = e.InnerException)
            if (e.HResult == unchecked((int)0x88982F50)) return "heif";
        return "hevc";
    }

    /// <summary>Cleaned once in the background after startup: files unused for 30 days, those beyond MaxBytes (least recently used first), and temp files left by an interrupted conversion</summary>
    public static void Prune()
    {
        try
        {
            if (!Directory.Exists(Dir)) return;
            var now = DateTime.UtcNow;
            var files = new DirectoryInfo(Dir).GetFiles().OrderByDescending(f => f.LastWriteTimeUtc).ToList();
            long total = 0;
            foreach (var f in files)
            {
                var stale = f.Extension.Equals(".tmp", StringComparison.OrdinalIgnoreCase) ? now - f.LastWriteTimeUtc > TimeSpan.FromDays(1) : now - f.LastWriteTimeUtc > MaxAge;
                total += f.Length;
                if (!stale && total <= MaxBytes) continue;
                try
                {
                    f.Delete();
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
                {
                    // Being read by the UI: delete it next time
                }
            }
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException)
        {
            Log.Info($"Decoded image cache not pruned: {ex.Message}");
        }
    }
}
