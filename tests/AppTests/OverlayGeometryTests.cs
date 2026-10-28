using System.Windows;
using SnipToss.App.Capture;
using Xunit;

namespace AppTests;

/// <summary>
/// Geometry of the capture overlay (OverlayGeometry, split out of CaptureOverlay). How it feels with a real mouse and real
/// multiple screens is covered by tests/shell/capture.spec.ts and manual testing
/// </summary>
public class OverlayGeometryTests
{
    static readonly Rect Screen = new(0, 0, 1920, 1080);
    static readonly Rect Sel = new(100, 100, 400, 300);

    [Fact]
    public void Handles_are_the_four_corners_and_four_edge_midpoints_clockwise_from_the_top_left()
    {
        var pts = OverlayGeometry.HandlePoints(Sel);
        Assert.Equal([new(100, 100), new(300, 100), new(500, 100), new(500, 250), new(500, 400), new(300, 400), new(100, 400), new(100, 250)], pts);
    }

    [Theory]
    [InlineData(104, 96, 0)] // within 6 of the top-left corner square
    [InlineData(506, 406, 4)] // bottom-right corner
    [InlineData(300, 103, 1)] // middle of the top edge
    [InlineData(200, 98, 1)] // anywhere along the top edge (within 4 of it) is also the top edge
    [InlineData(200, 404, 5)] // bottom edge
    [InlineData(97, 180, 7)] // left edge
    [InlineData(503, 330, 3)] // right edge
    [InlineData(200, 94, -1)] // 6 from the top edge: no hit
    [InlineData(300, 250, -1)] // middle of the selection
    [InlineData(600, 100, -1)] // on the extension of the top edge but outside the selection: no hit
    public void Which_handle_is_under_the_point(double x, double y, int handle) => Assert.Equal(handle, OverlayGeometry.HitHandle(Sel, new Point(x, y)));

    [Fact]
    public void Dragging_a_handle_moves_only_that_edge_and_dragging_past_the_opposite_edge_flips()
    {
        Assert.Equal(new Rect(100, 50, 400, 350), OverlayGeometry.Resized(Sel, 1, new Point(999, 50)));
        Assert.Equal(new Rect(100, 100, 500, 300), OverlayGeometry.Resized(Sel, 3, new Point(600, 999)));
        Assert.Equal(new Rect(50, 100, 50, 300), OverlayGeometry.Resized(Sel, 3, new Point(50, 0))); // the right edge dragged past the left edge
        Assert.Equal(new Rect(20, 30, 480, 370), OverlayGeometry.Resized(Sel, 0, new Point(20, 30)));
    }

    [Fact]
    public void Snapping_to_physical_pixels_on_a_150_percent_screen_gives_whole_multiples_of_two_thirds_of_a_DIP()
    {
        var p = OverlayGeometry.Snap(new Point(10.4, 10.2), 1.5);
        Assert.Equal(16, p.X * 1.5, 9); // 10.4 DIP = 15.6 physical pixels → 16
        Assert.Equal(15, p.Y * 1.5, 9);
        Assert.Equal(new Point(0, 1080), OverlayGeometry.Clamp(new Point(-5, 2000), Screen));
    }

    [Fact]
    public void Nudging_the_selection_moves_by_physical_pixels_and_keeps_the_whole_selection_on_screen()
    {
        Assert.Equal(new Rect(100 + 3 / 1.5, 100, 400, 300), OverlayGeometry.Nudge(Sel, 3, 0, 1.5, Screen));
        Assert.Equal(new Rect(0, 100, 400, 300), OverlayGeometry.Nudge(Sel, -1000, 0, 1, Screen));
        Assert.Equal(new Rect(100, 780, 400, 300), OverlayGeometry.Nudge(Sel, 0, 5000, 1, Screen));
    }

    [Fact]
    public void Toolbar_is_right_aligned_below_the_selection_goes_above_if_there_is_no_room_below_and_inside_the_bottom_if_neither_fits()
    {
        var bar = new Size(300, 36);
        var (at, _) = OverlayGeometry.ToolbarAt(Sel, bar, default, Screen);
        Assert.Equal(new Point(200, 408), at);
        // Selection touching the bottom of the screen: placed above
        (at, _) = OverlayGeometry.ToolbarAt(new Rect(100, 700, 400, 370), bar, default, Screen);
        Assert.Equal(new Point(200, 656), at);
        // Selection fills the whole screen: placed inside it, at the bottom
        (at, _) = OverlayGeometry.ToolbarAt(Screen, bar, default, Screen);
        Assert.Equal(new Point(1616, 1036), at);
        // Narrow selection at the left: the toolbar does not leave the left edge of the screen
        (at, _) = OverlayGeometry.ToolbarAt(new Rect(0, 100, 50, 50), bar, default, Screen);
        Assert.Equal(4, at.X);
    }

    [Fact]
    public void Sub_toolbar_goes_on_the_outer_side_of_the_toolbar_below_when_it_is_below_and_above_when_it_is_above()
    {
        var bar = new Size(300, 36);
        var sub = new Size(200, 30);
        var (at, s) = OverlayGeometry.ToolbarAt(Sel, bar, sub, Screen);
        Assert.Equal(new Point(200, 408 + 36 + 6), s);
        (at, s) = OverlayGeometry.ToolbarAt(new Rect(100, 700, 400, 370), bar, sub, Screen);
        Assert.Equal(700 - 8 - 36, at.Y);
        Assert.Equal(new Point(200, at.Y - 6 - 30), s);
    }

    [Fact]
    public void Note_box_goes_right_first_then_left_then_below_and_is_always_kept_on_screen()
    {
        var box = new Size(320, 160);
        Assert.Equal(new Point(508, 100), OverlayGeometry.NoteAt(Sel, box, Screen));
        // Near the right edge: placed on the left
        Assert.Equal(new Point(1500 - 8 - 320, 100), OverlayGeometry.NoteAt(new Rect(1500, 100, 400, 300), box, Screen));
        // No room on either side (full width): placed below
        Assert.Equal(new Point(8, 408), OverlayGeometry.NoteAt(new Rect(0, 100, 1920, 300), box, Screen));
        // No room below either: placed above
        Assert.Equal(new Point(8, 700 - 8 - 160), OverlayGeometry.NoteAt(new Rect(0, 700, 1920, 300), box, Screen));
        // At the top: does not leave the top edge of the screen
        Assert.Equal(8, OverlayGeometry.NoteAt(new Rect(0, 0, 1920, 1080), box, Screen).Y);
    }
}
