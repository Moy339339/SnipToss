using System.IO;
using System.Windows;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using SnipToss.App;

namespace AppTests;

/// <summary>
/// The main app's Copy as Images (app/HandoffImages.cs): how the image is composed and what goes on the clipboard.
/// Does not touch the system clipboard (only Prepare is tested)
/// </summary>
public class HandoffImagesTests
{
    static readonly Color Orange = Color.FromRgb(0xff, 0x6a, 0x3d);

    /// <summary>A solid-color PNG standing in for a screenshot</summary>
    static string Shot(TempDir dir, string name, int w, int h, Color color)
    {
        var visual = new DrawingVisual();
        using (var dc = visual.RenderOpen()) dc.DrawRectangle(new SolidColorBrush(color), null, new Rect(0, 0, w, h));
        var bmp = new RenderTargetBitmap(w, h, 96, 96, PixelFormats.Pbgra32);
        bmp.Render(visual);
        var enc = new PngBitmapEncoder();
        enc.Frames.Add(BitmapFrame.Create(bmp));
        var path = dir.File(name);
        using var fs = File.Create(path);
        enc.Save(fs);
        return path;
    }

    static HandoffImages.Item Item(string? shot, string name = "hero.png 第1条", string body = "标题字太细了，换成粗一点的黑体") =>
        new(shot, "示例项目 / assets/hero.png", 1, "change", "区域 画面左上（横 12%–52%、纵 8%–18%）", body, Orange, name);

    static Color Pixel(BitmapSource image, int x, int y)
    {
        var px = new byte[4];
        new FormatConvertedBitmap(image, PixelFormats.Bgra32, null, 0).CopyPixels(new Int32Rect(x, y, 1, 1), px, 4, 0);
        return Color.FromRgb(px[2], px[1], px[0]);
    }

    [Fact]
    public void A_note_with_a_screenshot_is_title_then_the_screenshot_unscaled_then_the_notes_area_top_to_bottom()
    {
        CaptureTests.OnSta(() =>
        {
            using var dir = new TempDir();
            var green = Color.FromRgb(0x20, 0xc0, 0x60);
            var (image, png) = HandoffImages.Render(Item(Shot(dir, "a.png", 1200, 600, green)), null);
            // the screenshot is wider than the minimum width: the image is as wide as the screenshot, which is not scaled
            Assert.Equal(1200, image.PixelWidth);
            Assert.True(image.PixelHeight > 600 + 40, $"Height {image.PixelHeight}: the title and notes block were not added");
            // The screenshot sits under the title, unchanged (the middle point has the screenshot's color); the top strip is the title's background
            Assert.Equal(green, Pixel(image, 600, image.PixelHeight / 2 - 50));
            Assert.NotEqual(green, Pixel(image, 2, 2));
            Assert.True(png.Length > 1000);
        });
    }

    [Fact]
    public void Without_a_screenshot_there_is_only_a_title_and_notes_area_at_least_720_wide()
    {
        CaptureTests.OnSta(() =>
        {
            var (image, _) = HandoffImages.Render(Item(null), null);
            Assert.Equal(720, image.PixelWidth);
            Assert.InRange(image.PixelHeight, 60, 400);
        });
    }

    [Fact]
    public void Unreadable_screenshot_is_treated_as_none_without_throwing()
    {
        CaptureTests.OnSta(() =>
        {
            using var dir = new TempDir();
            File.WriteAllText(dir.File("bad.png"), "不是图片");
            var (image, _) = HandoffImages.Render(Item(dir.File("bad.png")), null);
            Assert.Equal(720, image.PixelWidth);
        });
    }

    [Fact]
    public void A_wide_screenshot_scales_the_text_up_and_a_long_note_is_not_truncated()
    {
        CaptureTests.OnSta(() =>
        {
            using var dir = new TempDir();
            var shot = Shot(dir, "wide.png", 1600, 900, Colors.Gray);
            var shortOne = HandoffImages.Render(Item(shot), null).Image.PixelHeight - 900;
            var longOne = HandoffImages.Render(Item(shot, body: string.Concat(Enumerable.Repeat("这里的字要换成粗黑体，颜色再深一点。", 20))), null).Image.PixelHeight - 900;
            Assert.True(longOne > shortOne + 60, $"The notes block of the long note ({longOne}) is not taller than the short one ({shortOne}): no line wrapping");
            var narrow = HandoffImages.Render(Item(Shot(dir, "narrow.png", 800, 450, Colors.Gray)), null).Image.PixelHeight - 450;
            Assert.True(shortOne > narrow, $"The notes block of the wide image ({shortOne}) is not taller than the narrow one ({narrow}): the text was not scaled up");
        });
    }

    [Fact]
    public void Clipboard_with_one_note_holds_only_an_image_and_no_text()
    {
        CaptureTests.OnSta(() =>
        {
            using var dir = new TempDir();
            var (data, count) = HandoffImages.Prepare([Item(Shot(dir, "a.png", 800, 400, Colors.Gray))], "改完重新导出一版");
            Assert.Equal(1, count);
            Assert.True(data.GetDataPresent(DataFormats.Bitmap));
            Assert.True(data.GetDataPresent("PNG"));
            Assert.False(data.GetDataPresent(DataFormats.UnicodeText), "Text is included: some web chat apps then take only the text and drop the images");
            Assert.False(data.GetDataPresent(DataFormats.FileDrop));
        });
    }

    [Fact]
    public void Clipboard_with_several_notes_holds_image_files_numbered_in_order_and_no_text()
    {
        CaptureTests.OnSta(() =>
        {
            using var dir = new TempDir();
            var old = HandoffImages.Folder;
            HandoffImages.Folder = Path.Combine(dir.Path, "handoff");
            try
            {
                var shot = Shot(dir, "a.png", 800, 400, Colors.Gray);
                var (data, count) = HandoffImages.Prepare([Item(shot, "hero.png 第1条"), Item(null, "整个文件夹 第1条"), Item(shot, "clip.mp4 第3条")], null);
                Assert.Equal(3, count);
                var files = (string[])data.GetData(DataFormats.FileDrop)!;
                Assert.Equal(["01 hero.png 第1条.png", "02 整个文件夹 第1条.png", "03 clip.mp4 第3条.png"], files.Select(Path.GetFileName));
                Assert.All(files, f => Assert.True(new FileInfo(f).Length > 1000));
                Assert.StartsWith(HandoffImages.Folder, files[0], StringComparison.OrdinalIgnoreCase);
                Assert.False(data.GetDataPresent(DataFormats.UnicodeText));
                Assert.False(data.GetDataPresent(DataFormats.Bitmap));
            }
            finally
            {
                HandoffImages.Folder = old;
            }
        });
    }

    [Fact]
    public void File_name_drops_unusable_characters_and_truncates_when_too_long()
    {
        Assert.Equal("01 a_b_c__.png", HandoffImages.FileName(1, "a/b:c*?"));
        Assert.Equal(83 + 4, HandoffImages.FileName(12, new string('长', 200)).Length);
        Assert.Equal("02 结尾的点.png", HandoffImages.FileName(2, "结尾的点..."));
    }
}
