using System.IO;
using System.Text.Json.Nodes;
using SnipToss.App;
using SnipToss.App.Capture;
using Xunit;

namespace AppTests;

/// <summary>
/// The position wording given to AI: runs the same golden file as describeShape in the main app's core
/// (tests/golden/where.zh-CN.json)
/// </summary>
public class ShapeTextTests
{
    static string Golden() => Path.Combine(RepoRoot(), "tests", "golden", "where.zh-CN.json");

    static string RepoRoot()
    {
        for (var d = new DirectoryInfo(AppContext.BaseDirectory); d is not null; d = d.Parent)
            if (File.Exists(Path.Combine(d.FullName, "tests", "golden", "where.zh-CN.json"))) return d.FullName;
        throw new InvalidOperationException("找不到项目根目录");
    }

    static ShapeText.Shape ShapeOf(JsonNode s)
    {
        double D(JsonNode? n) => (double)n!;
        return (string)s["type"]! switch
        {
            "rect" => new ShapeText.Region(D(s["x"]), D(s["y"]), D(s["w"]), D(s["h"])),
            "point" => new ShapeText.Spot(D(s["x"]), D(s["y"])),
            "arrow" => new ShapeText.Arrow(D(s["from"]![0]), D(s["from"]![1]), D(s["to"]![0]), D(s["to"]![1])),
            "path" => new ShapeText.Path(s["points"]!.AsArray().Select(p => (D(p![0]), D(p[1]))).ToList()),
            var t => throw new ArgumentException(t),
        };
    }

    [Fact]
    public void Every_golden_case_matches_the_main_app_character_for_character()
    {
        var cases = JsonNode.Parse(File.ReadAllText(Golden()))!.AsArray();
        Assert.NotEmpty(cases);
        foreach (var c in cases)
        {
            var size = c!["size"] is JsonObject z ? ((int)z["width"]!, (int)z["height"]!) : ((int, int)?)null;
            Assert.True((string)c["text"]! == ShapeText.Describe(ShapeOf(c["shape"]!), size), $"{(string)c["name"]!}: {ShapeText.Describe(ShapeOf(c["shape"]!), size)}");
        }
    }

    [Fact]
    public void Capture_overlay_marks_describe_their_position_relative_to_the_selection_with_pixels_in_screenshot_size()
    {
        // The selection starts at (100, 50) on the screen and is 400 × 200 DIP; on a 150% screen the screenshot is 600 × 300 pixels
        var sel = new System.Windows.Rect(100, 50, 400, 200);
        var rect = new Mark { Kind = Tool.Rect, Points = [new(140, 70), new(300, 90)] };
        Assert.Equal("区域 画面左上（横 10%–50%、纵 10%–20%），x=60 y=30 宽=240 高=30 px", rect.Where(sel, (600, 300)));
        var pin = new Mark { Kind = Tool.Note, Points = [new(300, 150)] };
        Assert.Equal("位置 画面中央（横 50%、纵 50%），x=300 y=150 px", pin.Where(sel, (600, 300)));
        var arrow = new Mark { Kind = Tool.Arrow, Points = [new(100, 250), new(300, 150)] };
        Assert.Equal("箭头 从画面左下（横 0%、纵 100%）指向画面中央（横 50%、纵 50%），从 (0, 300) 到 (300, 150) px", arrow.Where(sel, (600, 300)));
    }
}
