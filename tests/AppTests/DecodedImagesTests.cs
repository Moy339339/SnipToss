using System.IO;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using SnipToss.App;

namespace AppTests;

/// <summary>
/// Images the UI cannot display (TIFF, HEIC / HEIF) are converted to PNG by the shell (DecodedImages): first page, orientation,
/// downscaling of oversized images, caching, and the reason a conversion failed
/// </summary>
public sealed class DecodedImagesTests : IDisposable
{
    readonly string temp = Directory.CreateTempSubdirectory("sniptoss-decoded-").FullName;
    readonly string previousDir = DecodedImages.Dir;

    public DecodedImagesTests() => DecodedImages.Dir = Path.Combine(temp, "cache");

    public void Dispose()
    {
        DecodedImages.Dir = previousDir;
        Directory.Delete(temp, recursive: true);
    }

    static readonly Color Red = Color.FromRgb(220, 30, 30);
    static readonly Color Blue = Color.FromRgb(30, 30, 220);
    static readonly Color Green = Color.FromRgb(0, 200, 0);

    /// <summary>Left half red, right half blue, a green corner × corner block in the top-left (to tell the orientation)</summary>
    static BitmapSource Picture(int w, int h, int corner = 40, Color? left = null)
    {
        var px = new byte[w * h * 4];
        for (var y = 0; y < h; y++)
            for (var x = 0; x < w; x++)
            {
                var c = x < corner && y < corner ? Green : x < w / 2 ? left ?? Red : Blue;
                var i = (y * w + x) * 4;
                (px[i], px[i + 1], px[i + 2], px[i + 3]) = (c.B, c.G, c.R, 255);
            }
        return BitmapSource.Create(w, h, 96, 96, PixelFormats.Bgra32, null, px, w * 4);
    }

    string Tiff(string name, ushort orientation = 0, params BitmapSource[] pages)
    {
        var encoder = new TiffBitmapEncoder { Compression = TiffCompressOption.Lzw };
        foreach (var page in pages)
        {
            BitmapMetadata? meta = null;
            if (orientation != 0)
            {
                meta = new BitmapMetadata("tiff");
                meta.SetQuery("/ifd/{ushort=274}", orientation);
            }
            encoder.Frames.Add(BitmapFrame.Create(page, null, meta, null));
        }
        var path = Path.Combine(temp, name);
        using var s = File.Create(path);
        encoder.Save(s);
        return path;
    }

    /// <summary>The converted PNG: its size and the colors of the four corners (5 pixels in from the edge)</summary>
    static (int W, int H, Color TopLeft, Color TopRight, Color BottomLeft, Color BottomRight) Read(string png)
    {
        Assert.Equal("PNG"u8.ToArray(), File.ReadAllBytes(png)[1..4]);
        using var s = File.OpenRead(png);
        var frame = BitmapDecoder.Create(s, BitmapCreateOptions.None, BitmapCacheOption.OnLoad).Frames[0];
        var b = new FormatConvertedBitmap(frame, PixelFormats.Bgra32, null, 0);
        var (w, h) = (b.PixelWidth, b.PixelHeight);
        var px = new byte[w * h * 4];
        b.CopyPixels(px, w * 4, 0);
        Color At(int x, int y)
        {
            var i = (y * w + x) * 4;
            return Color.FromRgb(px[i + 2], px[i + 1], px[i]);
        }
        return (w, h, At(5, 5), At(w - 6, 5), At(5, h - 6), At(w - 6, h - 6));
    }

    static void Near(Color want, Color got) =>
        Assert.True(Math.Abs(want.R - got.R) + Math.Abs(want.G - got.G) + Math.Abs(want.B - got.B) <= 30, $"Wanted {want}, got {got}");

    [Fact]
    public async Task TIFF_converts_to_PNG_with_the_original_size_and_colors()
    {
        var r = await DecodedImages.GetAsync(Tiff("a.tif", 0, Picture(320, 240)));
        Assert.Null(r.Problem);
        Assert.Equal((320, 240), (r.Width, r.Height));
        Assert.StartsWith(DecodedImages.Dir, r.File);
        var png = Read(r.File!);
        Assert.Equal((320, 240), (png.W, png.H));
        Near(Green, png.TopLeft);
        Near(Blue, png.TopRight);
        Near(Red, png.BottomLeft);
    }

    [Fact]
    public async Task Multi_page_TIFF_uses_the_first_page()
    {
        var r = await DecodedImages.GetAsync(Tiff("pages.tiff", 0, Picture(320, 240), Picture(320, 240, 0, Color.FromRgb(240, 200, 0))));
        var png = Read(r.File!);
        Near(Green, png.TopLeft);
        Near(Red, png.BottomLeft);
    }

    [Fact]
    public async Task TIFF_with_an_orientation_tag_is_turned_upright_and_reports_the_turned_size()
    {
        // Orientation 6: stored landscape, displayed rotated 90° clockwise. The green block moves from the top-left to the top-right
        var r = await DecodedImages.GetAsync(Tiff("rotated.tif", 6, Picture(320, 240)));
        Assert.Equal((240, 320), (r.Width, r.Height));
        var png = Read(r.File!);
        Assert.Equal((240, 320), (png.W, png.H));
        Near(Green, png.TopRight);
        Near(Red, png.TopLeft);
        Near(Blue, png.BottomLeft);
    }

    [Theory]
    [InlineData(1, 3, 2, 0, 0)]
    [InlineData(2, 3, 2, 2, 0)]
    [InlineData(3, 3, 2, 2, 1)]
    [InlineData(4, 3, 2, 0, 1)]
    [InlineData(5, 2, 3, 0, 0)]
    [InlineData(6, 2, 3, 1, 0)]
    [InlineData(7, 2, 3, 1, 2)]
    [InlineData(8, 2, 3, 0, 2)]
    public void Eight_orientations_where_the_top_left_pixel_ends_up(int orientation, int w, int h, int x, int y)
    {
        // A 3 × 2 image where only the top-left pixel is white
        var px = new byte[3 * 2 * 4];
        (px[0], px[1], px[2], px[3]) = (255, 255, 255, 255);
        var src = BitmapSource.Create(3, 2, 96, 96, PixelFormats.Bgra32, null, px, 12);
        var turned = new FormatConvertedBitmap(DecodedImages.Orient(src, orientation), PixelFormats.Bgra32, null, 0);
        Assert.Equal((w, h), (turned.PixelWidth, turned.PixelHeight));
        var outPx = new byte[w * h * 4];
        turned.CopyPixels(outPx, w * 4, 0);
        var white = Enumerable.Range(0, w * h).Single(i => outPx[i * 4] == 255);
        Assert.Equal((x, y), (white % w, white / w));
    }

    [Fact]
    public async Task Oversized_images_are_downscaled_and_the_original_size_is_reported()
    {
        var r = await DecodedImages.GetAsync(Tiff("wide.tif", 0, Picture(20000, 60)));
        Assert.Equal((20000, 60), (r.Width, r.Height));
        var png = Read(r.File!);
        Assert.Equal(DecodedImages.MaxSide, png.W);
        Assert.True(png.H is >= 48 and <= 50, $"Height {png.H}");
        Assert.True(DecodedImages.ScaleFor(9000, 9000) < 1); // 81 million pixels exceeds 64 million
        Assert.Equal(1, DecodedImages.ScaleFor(8000, 8000));
    }

    [Fact]
    public async Task Same_file_uses_the_cache_the_second_time_and_is_converted_again_when_it_changes()
    {
        var path = Tiff("a.tif", 0, Picture(320, 240));
        var first = await DecodedImages.GetAsync(path);
        File.SetLastWriteTimeUtc(first.File!, DateTime.UtcNow.AddDays(-3));
        var again = await DecodedImages.GetAsync(path);
        Assert.Equal(first.File, again.File);
        // Touched on use, so pruning counts it as recently used
        Assert.True(File.GetLastWriteTimeUtc(again.File!) > DateTime.UtcNow.AddMinutes(-1));

        // Replaced by another image (size and modified time both changed): a new cache entry is made
        Tiff("a.tif", 6, Picture(320, 240));
        File.SetLastWriteTimeUtc(path, DateTime.UtcNow.AddMinutes(1));
        var changed = await DecodedImages.GetAsync(path);
        Assert.NotEqual(first.File, changed.File);
        Assert.Equal((240, 320), (changed.Width, changed.Height));
    }

    [Fact]
    public async Task Several_simultaneous_requests_convert_only_once()
    {
        var path = Tiff("a.tif", 0, Picture(2000, 1500));
        var all = await Task.WhenAll(Enumerable.Range(0, 6).Select(_ => Task.Run(() => DecodedImages.GetAsync(path))));
        Assert.All(all, r => Assert.Equal(all[0].File, r.File));
        Assert.Single(Directory.GetFiles(DecodedImages.Dir));
    }

    [Fact]
    public async Task Broken_file_reports_unreadable_without_throwing()
    {
        var tif = Path.Combine(temp, "broken.tif");
        File.WriteAllBytes(tif, [0x49, 0x49, 0x2A, 0, .. Enumerable.Range(1, 100).Select(i => (byte)i)]);
        Assert.Equal("unreadable", (await DecodedImages.GetAsync(tif)).Problem);
        // A .heic that is not a HEIF container: the file is broken, so do not report a missing extension
        var heic = Path.Combine(temp, "broken.heic");
        File.WriteAllBytes(heic, [.. Enumerable.Range(1, 200).Select(i => (byte)i)]);
        Assert.Equal("unreadable", (await DecodedImages.GetAsync(heic)).Problem);
        // Failed conversions are not cached
        Assert.False(Directory.Exists(DecodedImages.Dir) && Directory.EnumerateFiles(DecodedImages.Dir).Any());
        await Assert.ThrowsAsync<FileNotFoundException>(() => DecodedImages.GetAsync(Path.Combine(temp, "none.tif")));
    }

    [Fact]
    public void Failure_reason_unrecognised_HEIF_means_missing_HEIF_extension_recognised_but_undecodable_usually_means_missing_HEVC()
    {
        var notFound = new NotSupportedException("No imaging component", new IOException("x", unchecked((int)0x88982F50)));
        Assert.Equal("heif", DecodedImages.Classify(notFound, heif: true, heifContainer: true));
        Assert.Equal("hevc", DecodedImages.Classify(new IOException("x", unchecked((int)0xC00D5212)), heif: true, heifContainer: true));
        Assert.Equal("unreadable", DecodedImages.Classify(notFound, heif: true, heifContainer: false));
        Assert.Equal("unreadable", DecodedImages.Classify(notFound, heif: false, heifContainer: false));
    }

    static string Fixture(string name)
    {
        for (var d = new DirectoryInfo(AppContext.BaseDirectory); d is not null; d = d.Parent)
        {
            var f = Path.Combine(d.FullName, "tests", "e2e", "fixtures", "formats", name);
            if (File.Exists(f)) return f;
        }
        throw new InvalidOperationException($"tests/e2e/fixtures/formats/{name} not found");
    }

    [Fact]
    public async Task HEIC_converts_when_the_extension_is_installed_the_decoder_rotates_and_it_is_not_rotated_twice()
    {
        // photo.heic and photo.tif are the same picture; rotated.heic carries irot (90° counter-clockwise),
        // moving the green block from top-left to bottom-left
        var photo = await DecodedImages.GetAsync(CopyIn("photo.heic"));
        // The HEIF Image Extensions are not installed on the machine running the tests: reporting the missing extension is correct
        if (photo.Problem == "heif") return;
        Assert.Null(photo.Problem);
        var png = Read(photo.File!);
        Assert.Equal((320, 240), (png.W, png.H));
        Near(Green, png.TopLeft);
        Near(Red, png.BottomLeft);

        var turned = await DecodedImages.GetAsync(CopyIn("rotated.heic"));
        Assert.Equal((240, 320), (turned.Width, turned.Height));
        png = Read(turned.File!);
        Near(Green, png.BottomLeft);
        Near(Blue, png.TopLeft);
    }

    string CopyIn(string name)
    {
        var to = Path.Combine(temp, name);
        File.Copy(Fixture(name), to, overwrite: true);
        return to;
    }

    [Fact]
    public void Pruning_deletes_entries_unused_for_30_days_and_over_the_limit_oldest_first_keeping_the_recent()
    {
        Directory.CreateDirectory(DecodedImages.Dir);
        string Put(string name, int daysAgo, int bytes = 10)
        {
            var f = Path.Combine(DecodedImages.Dir, name);
            File.WriteAllBytes(f, new byte[bytes]);
            File.SetLastWriteTimeUtc(f, DateTime.UtcNow.AddDays(-daysAgo));
            return f;
        }
        var fresh = Put("a-1x1.png", 1);
        var old = Put("b-1x1.png", 40);
        var leftover = Put("c-1x1.png.1234.tmp", 2);
        var writing = Put("d-1x1.png.5678.tmp", 0);
        DecodedImages.Prune();
        Assert.True(File.Exists(fresh));
        Assert.False(File.Exists(old));
        Assert.False(File.Exists(leftover));
        Assert.True(File.Exists(writing)); // a conversion in progress is not deleted
    }
}
