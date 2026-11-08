using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using SnipToss.App.Capture;
using Xunit;

namespace AppTests;

/// <summary>
/// The capture overlay's state machine (OverlayStateMachine, split out of CaptureOverlay): uses a fake window and a fake session,
/// and never opens the overlay.
/// It targets the ordering and priorities that are easiest to break; how it looks when drawn and the routing of the real mouse
/// are covered by tests/shell/capture.spec.ts
/// </summary>
public class OverlayStateMachineTests
{
    static readonly Rect Screen = new(0, 0, 1280, 720);
    static readonly Rect Window = new(100, 100, 300, 200);
    static readonly Rect Sel = new(200, 200, 400, 300);

    /// <summary>
    /// A fake capture overlay window: records what was called; the text in the two input boxes is filled in by the test itself
    /// (as if the user typed it)
    /// </summary>
    sealed class FakeView : IOverlayView
    {
        public OverlayStateMachine State = null!;
        public readonly List<string> Log = [];
        public bool Captured;
        public Point? Cursor;

        public void Refresh() => Log.Add("Refresh");

        public void RedrawMarks() => Log.Add("RedrawMarks");

        public void SetCursor(CursorKind cursor) => LastCursor = cursor;

        public CursorKind? LastCursor;

        public void OpenNoteBox(string text)
        {
            Log.Add("OpenNoteBox");
            NoteDraft = text;
        }

        public void CloseNoteBox() => Log.Add("CloseNoteBox");

        public void PaintNote() => Log.Add("PaintNote");

        public void ShowNotePlaces() => Log.Add("ShowNotePlaces");

        public string NoteDraft { get; set; } = "";

        public void OpenTextBox()
        {
            Log.Add("OpenTextBox");
            TextDraft = "";
        }

        public void CloseTextBox() => Log.Add("CloseTextBox");

        public void RestyleText() => Log.Add("RestyleText");

        public string TextDraft { get; set; } = "";

        public Point TextOrigin => State.TextAt;

        public void Activate() => Log.Add("Activate");

        public void FocusSelf() => Log.Add("FocusSelf");

        /// <summary>As in the real one: when the mouse is released the window receives LostMouseCapture and calls EndOp again</summary>
        public void ReleaseMouse()
        {
            if (!Captured) return;
            Captured = false;
            State.EndOp();
        }

        public Point? CursorPosition => Cursor;

        /// <summary>The marks announced as kept drawings (the overlay shows its one-time hint next to the first)</summary>
        public readonly List<Mark> Kept = [];

        public void DrawingsKept(Mark first) => Kept.Add(first);
    }

    /// <summary>
    /// A fake session (with just this one layer): Claim / Release follow CaptureSession's rules,
    /// and on Release every layer (this one included) goes back to Idle
    /// </summary>
    sealed class FakeHost : IOverlayHost
    {
        public OverlayStateMachine State = null!;
        public readonly List<string> Log = [];
        /// <summary>Something was drawn on another screen: this layer may not take ownership</summary>
        public bool Refuse;
        /// <summary>Another screen is selecting</summary>
        public bool OtherOwner;

        public bool IsOwner { get; private set; }

        public bool HasOwner => IsOwner || OtherOwner;

        public bool Claim()
        {
            if (Refuse) return false;
            IsOwner = true;
            OtherOwner = false;
            return true;
        }

        public void Release()
        {
            if (!IsOwner) return;
            IsOwner = false;
            Log.Add("Release");
            State.Idle();
        }

        public void FocusOwner() => Log.Add("FocusOwner");

        public void RequestCancel() => Log.Add("RequestCancel");

        public void Finish() => Log.Add("Finish");
    }

    sealed class Layer
    {
        public readonly FakeView View = new();
        public readonly FakeHost Host = new();
        public readonly OverlayStateMachine State;

        public Layer(params Rect[] windows)
        {
            State = new OverlayStateMachine(View, Host, 1, Screen, [.. windows], ToolPrefs.Colors[0], "change", new ToolPrefs());
            View.State = State;
            Host.State = State;
        }

        /// <summary>As the window does: the mouse is captured only when the state machine says it is a drag</summary>
        public bool Down(double x, double y, int clicks = 1)
        {
            var drag = State.Down(new Point(x, y), clicks);
            if (drag) View.Captured = true;
            return drag;
        }

        public void Up() => State.EndOp();

        public void Drag((double X, double Y) from, (double X, double Y) to)
        {
            Down(from.X, from.Y);
            for (var i = 1; i <= 4; i++) State.MoveTo(new Point(from.X + (to.X - from.X) * i / 4, from.Y + (to.Y - from.Y) * i / 4), false);
            Up();
        }

        public void Click(double x, double y)
        {
            Down(x, y);
            Up();
        }

        public Layer Selected()
        {
            Drag((200, 200), (600, 500));
            return this;
        }

        public bool Press(Key key, ModifierKeys mods = ModifierKeys.None) => State.Press(key, mods);
    }

    [Fact]
    public void A_click_selects_the_hovered_window_or_the_whole_screen_when_there_is_no_window()
    {
        var a = new Layer(Window);
        a.State.MoveTo(new Point(150, 150), false);
        Assert.Equal(Window, a.State.Hover);
        Assert.Equal(CursorKind.Arrow, a.View.LastCursor);
        a.Click(150, 150);
        Assert.Equal(Window, a.State.Sel);

        var b = new Layer(Window);
        b.State.MoveTo(new Point(800, 600), false);
        b.Click(800, 600);
        Assert.Equal(Screen, b.State.Sel);
    }

    [Fact]
    public void Dragging_out_a_selection_a_too_small_one_falls_back()
    {
        var a = new Layer().Selected();
        Assert.Equal(Sel, a.State.Sel);
        Assert.True(a.State.HandlesVisible);
        Assert.True(a.State.ToolbarVisible);

        var b = new Layer();
        b.Drag((10, 10), (12, 40)); // it was dragged (more than 3) but is only 2 wide
        Assert.Equal(Screen, b.State.Sel);
    }

    [Fact]
    public void Dragging_the_selection_moves_it_dragging_a_handle_resizes_it_and_the_toolbar_hides_while_dragging()
    {
        var a = new Layer().Selected();
        Assert.True(a.Down(400, 350));
        Assert.Equal(DragOp.Move, a.State.Op);
        a.State.MoveTo(new Point(410, 360), false);
        Assert.False(a.State.ToolbarVisible);
        a.Up();
        Assert.Equal(new Rect(210, 210, 400, 300), a.State.Sel);
        Assert.True(a.Down(610, 510)); // the bottom-right handle
        Assert.Equal(DragOp.Resize, a.State.Op);
        Assert.True(a.State.MagnifierVisible);
        a.State.MoveTo(new Point(700, 600), false);
        a.Up();
        Assert.Equal(new Rect(210, 210, 490, 390), a.State.Sel);
    }

    [Fact]
    public void Clicks_that_just_open_an_input_box_do_not_capture_the_mouse_only_drags_that_draw_do()
    {
        // A number mark used to capture the mouse and nobody released it, so later clicks on the toolbar and on Finish were swallowed
        // by this layer, leaving only Esc, which lost all notes
        var a = new Layer().Selected();
        a.State.ChooseTool(Tool.Note);
        Assert.False(a.Down(300, 300));
        Assert.True(a.State.NoteOpen);
        Assert.Equal(1, a.State.Marks.Single().PendingNumber);
        a.State.CancelNote();
        Assert.Empty(a.State.Marks);

        a.State.ChooseTool(Tool.Text);
        Assert.False(a.Down(300, 300));
        Assert.True(a.State.TextOpen);
        a.View.TextDraft = "字";
        Assert.True(a.State.TextKey(Key.Escape)); // Esc means done writing
        Assert.Equal("字", a.State.Marks.Single().Text);

        a.State.ChooseTool(Tool.Rect);
        Assert.False(a.Down(305, 305)); // a click on the text just written: selects it (to change its color), no drawing
        Assert.Same(a.State.Marks.Single(), a.State.Picked);
        Assert.True(a.Down(400, 400));
        Assert.Equal(DragOp.Draw, a.State.Op);
    }

    [Fact]
    public void Clicking_a_number_edits_that_note_without_capturing_the_mouse()
    {
        var a = new Layer().Selected();
        a.State.ChooseTool(Tool.Rect);
        a.Drag((250, 250), (300, 300));
        a.View.NoteDraft = "改大";
        a.State.CommitNote();
        var rect = a.State.Marks.Single();
        Assert.Equal(1, rect.Number);
        Assert.Equal(CursorKind.Hand, CursorAt(a, 250, 250));
        Assert.False(a.Down(250, 250)); // the number is drawn at the top-left corner
        Assert.Same(rect, a.State.NoteFor);
        Assert.Equal("改大", a.View.NoteDraft);
    }

    static CursorKind? CursorAt(Layer a, double x, double y)
    {
        a.State.MoveTo(new Point(x, y), false);
        return a.View.LastCursor;
    }

    [Fact]
    public void On_release_the_drag_is_finished_before_the_mouse_is_released_and_the_reentry_on_release_does_not_finish_it_twice()
    {
        var a = new Layer().Selected();
        a.State.ChooseTool(Tool.Rect);
        Assert.True(a.Down(250, 250));
        a.State.MoveTo(new Point(350, 350), false);
        a.View.Log.Clear();
        a.Up();
        Assert.False(a.View.Captured);
        Assert.Equal(DragOp.None, a.State.Op);
        Assert.Single(a.State.Marks);
        Assert.Equal(["OpenNoteBox", "Activate"], a.View.Log.Where(x => x is "OpenNoteBox" or "Activate"));
    }

    [Fact]
    public void Undo_order_note_box_then_text_box_then_the_last_mark_then_the_overall_comment()
    {
        var a = new Layer().Selected();
        a.State.ChooseTool(Tool.Rect);
        a.Drag((250, 250), (300, 300));
        a.View.NoteDraft = "一";
        a.State.CommitNote();
        a.Drag((350, 350), (400, 400));
        Assert.True(a.State.NoteOpen); // the note box pops up after drawing
        a.State.Undo();
        Assert.False(a.State.NoteOpen);
        Assert.Single(a.State.Marks); // the note box was cancelled together with the rectangle that opened it; the note written before stays

        a.State.ChooseTool(Tool.Text);
        a.Click(400, 400);
        a.View.TextDraft = "不要了";
        a.State.Undo();
        Assert.False(a.State.TextOpen);
        Assert.Single(a.State.Marks); // what was undone is this piece of text

        a.State.Undo();
        Assert.Empty(a.State.Marks);

        Assert.True(a.Press(Key.N));
        a.View.NoteDraft = "整体";
        Assert.True(a.State.NoteKey(Key.Enter, ModifierKeys.None));
        Assert.Equal("整体", a.State.Overall);
        a.State.Undo();
        Assert.Equal("", a.State.Overall);
    }

    [Fact]
    public void Right_click_order_ignored_while_dragging_then_discards_note_box_finishes_text_box_nothing_when_locked_reselects_or_cancels()
    {
        var a = new Layer(Window).Selected();
        Assert.True(a.Down(400, 350));
        a.State.Right();
        Assert.Equal(DragOp.Move, a.State.Op);
        a.Up();

        a.Press(Key.N);
        a.View.NoteDraft = "不写了";
        a.State.Right();
        Assert.False(a.State.NoteOpen);
        Assert.Equal("", a.State.Overall);

        a.State.ChooseTool(Tool.Text);
        a.Click(400, 400);
        a.View.TextDraft = "写好";
        a.State.Right();
        Assert.Equal("写好", a.State.Marks.Single().Text);

        a.State.Right(); // something is drawn: the selection is locked and right-click does nothing
        Assert.Equal(Sel, a.State.Sel);
        Assert.Empty(a.Host.Log);

        a.State.Undo();
        a.View.Cursor = new Point(150, 150);
        a.State.Right();
        Assert.Null(a.State.Sel);
        Assert.Equal(Tool.None, a.State.Tool);
        Assert.Equal(["Release"], a.Host.Log);
        Assert.Equal(Window, a.State.Hover); // the window under the pointer is highlighted at once, even if the mouse does not move

        a.State.Right();
        Assert.Equal(["Release", "RequestCancel", "FocusOwner"], a.Host.Log);
    }

    [Fact]
    public void Unsaved_text_in_an_input_box_also_locks_the_selection_but_only_spaces_do_not()
    {
        var a = new Layer().Selected();
        a.Press(Key.N);
        Assert.False(a.State.Locked);
        a.View.NoteDraft = "  ";
        Assert.False(a.State.Locked);
        a.View.NoteDraft = "还没保存";
        Assert.True(a.State.Locked);
        Assert.True(a.State.HasNotes);
        Assert.False(a.State.HandlesVisible);
        a.State.CancelNote();
        Assert.False(a.State.Locked);

        a.State.ChooseTool(Tool.Text);
        a.Click(300, 300);
        a.View.TextDraft = " ";
        Assert.False(a.State.Locked);
        a.View.TextDraft = "还没写好";
        Assert.True(a.State.Locked);
    }

    [Fact]
    public void When_locked_a_click_outside_the_box_does_nothing_and_a_screen_with_drawings_cannot_be_taken_over_and_the_keyboard_goes_back_to_that_layer()
    {
        var a = new Layer().Selected();
        a.State.ChooseTool(Tool.Rect);
        a.Drag((250, 250), (300, 300));
        a.View.NoteDraft = "框";
        a.State.CommitNote();
        a.State.ChooseTool(Tool.Rect); // put the tool down
        Assert.False(a.Down(700, 600));
        Assert.Equal(Sel, a.State.Sel);

        var b = new Layer();
        b.Host.Refuse = true;
        Assert.False(b.Down(100, 100));
        Assert.Null(b.State.Sel);
        Assert.Equal(["FocusOwner"], b.Host.Log);
    }

    [Fact]
    public void When_another_screen_is_selecting_this_one_shows_no_highlight_and_no_magnifier()
    {
        var a = new Layer(Window);
        a.State.MoveTo(new Point(150, 150), false);
        Assert.Equal(Window, a.State.Shown);
        Assert.True(a.State.MagnifierVisible);
        a.Host.OtherOwner = true;
        Assert.Null(a.State.Shown);
        Assert.False(a.State.MagnifierVisible);
    }

    [Fact]
    public void While_an_input_box_is_open_the_overlays_keys_go_to_the_box_with_Alt_F4_as_the_exception()
    {
        var a = new Layer().Selected();
        a.Press(Key.N);
        Assert.False(a.Press(Key.R));
        Assert.Equal(Tool.None, a.State.Tool);
        Assert.False(a.Press(Key.Escape));
        Assert.True(a.Press(Key.F4, ModifierKeys.Alt));
        Assert.Equal(["RequestCancel"], a.Host.Log);
    }

    [Fact]
    public void Ctrl_Shift_Z_is_not_undo()
    {
        var a = new Layer().Selected();
        a.State.ChooseTool(Tool.Rect);
        a.Drag((250, 250), (300, 300));
        a.View.NoteDraft = "框";
        a.State.CommitNote();
        Assert.False(a.Press(Key.Z, ModifierKeys.Control | ModifierKeys.Shift));
        Assert.Single(a.State.Marks);
        Assert.True(a.Press(Key.Z, ModifierKeys.Control));
        Assert.Empty(a.State.Marks);
    }

    [Fact]
    public void Cancel_warns_first_only_when_notes_were_written_and_a_second_press_within_3_seconds_really_cancels()
    {
        var a = new Layer().Selected();
        var t = new DateTime(2026, 10, 22, 12, 0, 0);
        Assert.False(a.State.ArmCancel(t)); // no notes written: cancels straight away
        a.Press(Key.N);
        a.View.NoteDraft = "意见";
        Assert.True(a.State.ArmCancel(t));
        Assert.False(a.State.ArmCancel(t.AddSeconds(2.9)));
        Assert.True(a.State.ArmCancel(t.AddSeconds(5)));
    }

    [Fact]
    public void Double_clicking_to_finish_inside_the_box_discards_the_empty_number_pin_the_first_click_just_placed()
    {
        var a = new Layer().Selected();
        a.State.ChooseTool(Tool.Note);
        Assert.False(a.Down(300, 300, 1));
        Assert.Single(a.State.Marks);
        Assert.False(a.Down(300, 300, 2));
        Assert.Empty(a.State.Marks);
        Assert.Equal(["Finish"], a.Host.Log);
    }

    [Fact]
    public void Double_clicking_to_finish_with_the_note_box_open_saves_the_written_text_as_usual_and_removes_the_number_pin_the_first_click_added()
    {
        // The second click of a double-click used to mean "cancel": with the box open, the first click added another place
        // (or selected one) without closing the box, and the second click threw away the written text together with the note
        var a = new Layer().Selected();
        a.State.ChooseTool(Tool.Note);
        a.Click(300, 300);
        a.View.NoteDraft = "改成圆角";
        a.Click(400, 300);
        Assert.Equal(2, a.State.NotePlaces);
        Assert.False(a.Down(500, 400, 1)); // the first click of the double-click: adds another place
        Assert.Equal(3, a.State.NotePlaces);
        Assert.False(a.Down(500, 400, 2));
        Assert.Equal(["Finish"], a.Host.Log);
        Assert.Equal(2, a.State.Marks.Count);
        Assert.Equal("改成圆角", a.State.Marks[0].Note);
        Assert.Equal(1, a.State.Marks[0].Number);
    }

    [Fact]
    public void Numbers_follow_the_order_written_are_renumbered_when_text_is_deleted_and_the_next_note_starts_with_the_previous_notes_category()
    {
        var a = new Layer().Selected();
        a.State.ChooseTool(Tool.Rect);
        a.Drag((250, 250), (300, 300));
        Assert.Equal("change", a.State.NoteCategory); // the default category
        a.View.NoteDraft = "一";
        Assert.True(a.State.NoteKey(Key.D2, ModifierKeys.Alt));
        a.State.CommitNote();
        a.Drag((350, 350), (400, 400));
        Assert.Equal("remove", a.State.NoteCategory);
        Assert.Equal(2, a.State.NoteFor!.PendingNumber);
        a.View.NoteDraft = "二";
        a.State.CommitNote();
        Assert.Equal([1, 2], a.State.Marks.Select(m => m.Number));

        a.Down(250, 250); // click the number of note 1 and delete all its text: the note goes, together with its rectangle
        a.View.NoteDraft = "";
        a.State.CommitNote();
        Assert.Equal([1], a.State.Marks.Select(m => m.Number));
        Assert.Equal("二", a.State.Marks.Single().Note);
        a.State.Undo(); // it comes back with its number
        Assert.Equal([1, 2], a.State.Marks.Select(m => m.Number));
        Assert.Equal("一", a.State.Marks[0].Note);
    }

    [Fact]
    public void Changing_color_or_size_while_typing_updates_the_input_box_and_the_finished_text_keeps_the_values_at_that_time()
    {
        var a = new Layer().Selected();
        a.State.ChooseTool(Tool.Text);
        a.Click(300, 300);
        Assert.Equal(18, a.State.TextSize); // the text size defaults to the middle step
        a.View.Log.Clear();
        a.State.SetSize(2);
        a.State.SetColor(ToolPrefs.Colors[3]);
        Assert.Equal(2, a.View.Log.Count(x => x == "RestyleText"));
        a.View.TextDraft = "绿字";
        a.State.Right();
        var m = a.State.Marks.Single();
        Assert.Equal(24, m.Size);
        Assert.Equal(ToolPrefs.Colors[3], m.Color);
    }

    [Fact]
    public void Color_chosen_once_is_remembered_and_a_changed_setting_wins()
    {
        var prefs = new ToolPrefs();
        var orange = ToolPrefs.Colors[0];
        var blue = ToolPrefs.Colors[4];
        prefs.Start(orange);
        prefs.Choose(ToolPrefs.Colors[3], orange);
        prefs.Start(orange); // the next capture, settings unchanged
        Assert.Equal(ToolPrefs.Colors[3], prefs.Color);
        prefs.Start(blue); // the setting was changed to blue
        Assert.Equal(blue, prefs.Color);
        Assert.Equal(Color.FromRgb(0x5b, 0x8c, 0xff), blue);
    }

    [Fact]
    public void Idle_closes_open_boxes_and_drawings_without_taking_focus()
    {
        var a = new Layer().Selected();
        a.Press(Key.N);
        a.View.Log.Clear();
        a.State.Idle();
        Assert.False(a.State.NoteOpen);
        Assert.Null(a.State.Sel);
        Assert.DoesNotContain("FocusSelf", a.View.Log); // the user is selecting on another screen at this moment
        Assert.Contains("CloseNoteBox", a.View.Log);
    }

    // ---------- One note with several places (docs/adr/0009-several-places.md) ----------

    [Fact]
    public void With_the_note_box_open_more_Pin_clicks_add_places_under_the_same_number_the_box_stays_open_and_repeated_clicks_on_one_place_do_not_stack()
    {
        var a = new Layer().Selected();
        a.State.ChooseTool(Tool.Note);
        a.Click(300, 300);
        var lead = a.State.NoteFor!;
        a.View.NoteDraft = "这几个按钮都改圆角";
        a.View.Log.Clear();
        Assert.False(a.Down(400, 300)); // a plain click does not capture the mouse
        a.Click(500, 300);
        a.Click(501, 301); // almost the same point as the previous place: does not stack
        Assert.True(a.State.NoteOpen);
        Assert.Same(lead, a.State.NoteFor);
        Assert.Equal(3, a.State.NotePlaces);
        Assert.Equal(3, a.State.Marks.Count);
        Assert.All(a.State.Marks.Skip(1), m => Assert.Same(lead, m.Lead));
        Assert.Equal(2, a.View.Log.Count(x => x == "ShowNotePlaces"));
        Assert.DoesNotContain("CloseNoteBox", a.View.Log);
        Assert.Equal("这几个按钮都改圆角", a.View.NoteDraft);

        Assert.True(a.State.NoteKey(Key.Enter, ModifierKeys.None));
        Assert.Equal([1, 0, 0], a.State.Marks.Select(m => m.Number));
        Assert.All(a.State.Marks, m => Assert.Equal(1, m.Head.Number)); // all are drawn as 1
        Assert.Equal("这几个按钮都改圆角", lead.Note);
    }

    [Fact]
    public void With_the_box_open_a_rectangle_drawn_after_switching_tool_belongs_to_the_note_and_a_click_outside_or_without_a_drag_finishes_it()
    {
        var a = new Layer().Selected();
        a.State.ChooseTool(Tool.Note);
        a.Click(300, 300);
        a.View.NoteDraft = "一样的意见";
        a.State.ChooseTool(Tool.Rect); // switch to Rectangle: the box stays open
        Assert.True(a.State.NoteOpen);
        Assert.True(a.Down(350, 350));
        a.State.MoveTo(new Point(420, 420), false);
        a.Up();
        Assert.Equal(2, a.State.NotePlaces);
        Assert.True(a.State.NoteOpen);
        // With Rectangle selected, a click inside the selection without a drag: as before, clicking elsewhere means done writing
        a.Click(450, 450);
        Assert.False(a.State.NoteOpen);
        Assert.Equal(1, a.State.Marks[0].Number);
        Assert.Same(a.State.Marks[0], a.State.Marks[1].Lead);

        // Pixelate does not mark a position: switching to it finishes the note first (as before)
        a.Click(a.State.Marks[0].Points[0].X, a.State.Marks[0].Points[0].Y); // click the number: edits this note
        Assert.True(a.State.NoteOpen);
        a.State.ChooseTool(Tool.Mosaic);
        Assert.False(a.State.NoteOpen);

        // A click outside the selection: done writing, no extra place
        a.State.ChooseTool(Tool.Note);
        a.Click(560, 460);
        a.View.NoteDraft = "第二条";
        a.Click(700, 600);
        Assert.False(a.State.NoteOpen);
        Assert.Equal([1, 0, 2], a.State.Marks.Select(m => m.Number));
    }

    [Fact]
    public void Undo_and_Alt_Z_remove_the_last_added_place_and_only_undo_cancels_the_note_once_none_are_left_while_Alt_Z_then_does_nothing()
    {
        var a = new Layer().Selected();
        a.State.ChooseTool(Tool.Note);
        a.Click(300, 300);
        a.Click(400, 300);
        a.Click(500, 300);
        Assert.True(a.State.NoteKey(Key.Z, ModifierKeys.Alt));
        Assert.Equal(2, a.State.NotePlaces);
        a.State.Undo();
        Assert.Equal(1, a.State.NotePlaces);
        Assert.True(a.State.NoteKey(Key.Z, ModifierKeys.Alt)); // only the first place is left: the key is swallowed and nothing is cancelled
        Assert.True(a.State.NoteOpen);
        a.State.Undo(); // undo again: cancels the note (the new number pin is removed)
        Assert.False(a.State.NoteOpen);
        Assert.Empty(a.State.Marks);
    }

    [Fact]
    public void Esc_removes_the_places_added_while_editing_and_saving_a_saved_note_empty_deletes_it_with_all_its_places_until_undone()
    {
        var a = new Layer().Selected();
        a.State.ChooseTool(Tool.Rect);
        a.Drag((250, 250), (300, 300));
        a.State.ChooseTool(Tool.Note);
        a.Click(400, 300);
        a.View.NoteDraft = "两处";
        a.State.CommitNote();
        Assert.Equal(2, a.State.Marks.Count);
        var rect = a.State.Marks[0];

        // Edit this note: click one more place, then Esc: what was added now is removed, the original two places remain and the text is unchanged
        a.Click(MarkPainter.BadgeCenter(rect, a.State.Keep).X, MarkPainter.BadgeCenter(rect, a.State.Keep).Y);
        Assert.Same(rect, a.State.NoteFor);
        a.Click(500, 400);
        Assert.Equal(3, a.State.NotePlaces);
        Assert.True(a.State.NoteKey(Key.Escape, ModifierKeys.None));
        Assert.Equal(2, a.State.Marks.Count);
        Assert.Equal("两处", rect.Note);

        // Click the number of the place that was added afterwards: that edits this note too
        var pin = a.State.Marks[1];
        a.Click(MarkPainter.BadgeCenter(pin, a.State.Keep).X, MarkPainter.BadgeCenter(pin, a.State.Keep).Y);
        Assert.Same(rect, a.State.NoteFor);
        Assert.Equal(2, a.State.NotePlaces);

        // Deleting all the text and saving means dropping the note: the rectangle and the number pin go with it (nothing is left behind on the screenshot)
        a.View.NoteDraft = "";
        a.State.CommitNote();
        Assert.Empty(a.State.Marks);
        Assert.False(a.State.Locked);
        // One undo brings back the whole note
        a.State.Undo();
        Assert.Equal(2, a.State.Marks.Count);
        Assert.Equal("两处", rect.Note);
        Assert.Equal(1, rect.Number);
    }

    // ---------- A new note left without a word: its lines and boxes stay as drawings without a number; Esc / Cancel / right-click take them away ----------

    public static TheoryData<string> WaysToKeep => ["click outside", "click inside", "Enter", "switch to Pixelate", "overall comment", "double-click to finish"];
    public static TheoryData<string> WaysToDrop => ["Esc", "Cancel", "right-click"];

    static void Leave(Layer a, string how)
    {
        switch (how)
        {
            case "click outside": a.Click(700, 600); break;
            case "click inside": a.Click(450, 450); break;
            case "Esc": Assert.True(a.State.NoteKey(Key.Escape, ModifierKeys.None)); break;
            case "Cancel": a.State.CancelNote(); break;
            case "right-click": a.State.Right(); break;
            case "Enter": Assert.True(a.State.NoteKey(Key.Enter, ModifierKeys.None)); break;
            case "switch to Pixelate": a.State.ChooseTool(Tool.Mosaic); break;
            case "overall comment": a.State.ToggleOverall(); break;
            case "double-click to finish": a.Down(450, 450, 2); break;
        }
    }

    [Theory]
    [MemberData(nameof(WaysToKeep))]
    public void Leaving_a_new_marks_note_box_without_writing_keeps_the_mark_as_a_drawing_without_a_number(string how)
    {
        foreach (var tool in new[] { Tool.Rect, Tool.Ellipse, Tool.Arrow, Tool.Pen })
        {
            var a = new Layer().Selected();
            a.State.ChooseTool(tool);
            a.Drag((250, 250), (330, 320));
            Assert.True(a.State.NoteOpen);
            a.View.NoteDraft = "  "; // only spaces count as nothing written
            Leave(a, how);
            var m = Assert.Single(a.State.Marks);
            Assert.Equal(tool, m.Kind);
            Assert.False(m.HasNote);
            Assert.Equal(0, m.Number);
            Assert.Equal(0, m.PendingNumber);
            Assert.Null(m.Lead);
            Assert.Null(a.State.NoteFor);
            // Announced for the one-time hint next to it, except when the capture is being finished (the overlay closes at once)
            if (how == "double-click to finish") Assert.Empty(a.View.Kept);
            else Assert.Same(m, Assert.Single(a.View.Kept));
        }
    }

    [Fact]
    public void Finishing_with_an_empty_note_box_open_keeps_its_drawing_without_announcing_it()
    {
        var a = new Layer().Selected();
        a.State.ChooseTool(Tool.Rect);
        a.Drag((250, 250), (330, 320));
        a.State.CommitOpenEdits();
        Assert.False(Assert.Single(a.State.Marks).HasNote);
        Assert.Empty(a.View.Kept);
    }

    [Theory]
    [MemberData(nameof(WaysToDrop))]
    public void Esc_Cancel_or_right_click_on_a_new_marks_note_box_takes_the_mark_away(string how)
    {
        foreach (var tool in new[] { Tool.Rect, Tool.Ellipse, Tool.Arrow, Tool.Pen })
        {
            var a = new Layer().Selected();
            a.State.ChooseTool(tool);
            a.Drag((250, 250), (330, 320));
            Leave(a, how);
            Assert.Empty(a.State.Marks);
            Assert.Null(a.State.NoteFor);
        }
    }

    [Fact]
    public void A_new_note_with_two_places_left_unwritten_leaves_two_drawings_each_on_its_own()
    {
        var a = new Layer().Selected();
        a.State.ChooseTool(Tool.Rect);
        a.Drag((250, 250), (300, 300));
        a.Drag((350, 350), (420, 420)); // the box is still open: another place of the same note
        Assert.Equal(2, a.State.NotePlaces);
        a.Click(700, 600);
        Assert.Equal(2, a.State.Marks.Count);
        Assert.All(a.State.Marks, m =>
        {
            Assert.Null(m.Lead);
            Assert.False(m.HasNote);
        });
        Assert.Same(a.State.Marks[0], Assert.Single(a.View.Kept)); // announced once, at the first of them
        // Each one is picked and deleted on its own
        a.Click(250, 275);
        Assert.Same(a.State.Marks[0], a.State.Picked);
        a.State.DeletePicked();
        Assert.Single(a.State.Marks, m => !m.Removed);
    }

    [Fact]
    public void A_numbered_dot_left_without_words_still_goes_away()
    {
        var a = new Layer().Selected();
        a.State.ChooseTool(Tool.Note);
        a.Click(300, 300);
        Assert.True(a.State.NoteOpen);
        a.Click(700, 600);
        Assert.Empty(a.State.Marks);
        Assert.Empty(a.View.Kept);
    }

    [Fact]
    public void Double_clicking_a_drawing_opens_a_note_for_it_writing_numbers_it_and_Esc_leaves_the_drawing_as_it_was()
    {
        var a = new Layer().Selected();
        a.State.ChooseTool(Tool.Rect);
        a.Drag((250, 250), (330, 320));
        a.Click(700, 600);
        var drawing = Assert.Single(a.State.Marks);
        Assert.False(drawing.HasNote);

        a.Down(250, 280, 1);
        a.Up();
        a.Down(250, 280, 2);
        Assert.True(a.State.NoteOpen);
        Assert.Same(drawing, a.State.NoteFor);
        Assert.True(a.State.NoteKey(Key.Escape, ModifierKeys.None));
        Assert.Same(drawing, Assert.Single(a.State.Marks));
        Assert.False(drawing.HasNote);

        a.Down(250, 280, 1);
        a.Up();
        a.Down(250, 280, 2);
        a.View.NoteDraft = "这个框里改一下";
        Assert.True(a.State.NoteKey(Key.Enter, ModifierKeys.None));
        Assert.Equal("这个框里改一下", drawing.Note);
        Assert.Equal(1, drawing.Number);
    }

    [Fact]
    public void Deleting_a_drawing_while_its_double_clicked_note_box_is_open_deletes_it_and_undo_brings_it_back()
    {
        var a = new Layer().Selected();
        a.State.ChooseTool(Tool.Rect);
        a.Drag((250, 250), (330, 320));
        a.Click(700, 600);
        var drawing = Assert.Single(a.State.Marks);

        a.Down(250, 280, 1);
        a.Up();
        a.Down(250, 280, 2);
        Assert.Same(drawing, a.State.NoteFor);
        Assert.Same(drawing, a.State.Picked);
        a.View.NoteDraft = "写了一半";
        a.State.DeletePicked();
        Assert.False(a.State.NoteOpen);
        Assert.True(drawing.Removed);

        a.State.Undo();
        Assert.False(drawing.Removed);
        Assert.False(drawing.HasNote);
        Assert.Equal(0, drawing.Number);
    }

    // ---------- Deleting a picked mark (the toolbar's Delete, Delete / Backspace) ----------

    [Fact]
    public void Deleting_a_place_keeps_the_note_until_its_last_place_and_undo_brings_each_back()
    {
        var a = new Layer().Selected();
        a.State.ChooseTool(Tool.Note);
        a.Click(300, 300);
        a.Click(400, 300);
        a.View.NoteDraft = "两处";
        a.State.CommitNote();
        var (first, second) = (a.State.Marks[0], a.State.Marks[1]);

        // Clicking the second place opens the note and picks it; Delete takes only that place away and the box stays open
        a.Click(400, 300);
        Assert.Same(second, a.State.Picked);
        a.State.DeletePicked();
        Assert.True(a.State.NoteOpen);
        Assert.Equal(1, a.State.NotePlaces);
        Assert.Same(first, a.State.Marks.Single());
        Assert.Contains("ShowNotePlaces", a.View.Log); // the title says "1 mark" again and typing continues
        a.State.Undo(); // with the box open, undo first brings back what was deleted in it
        Assert.Equal(2, a.State.NotePlaces);
        a.Click(400, 300);
        a.State.DeletePicked();
        Assert.True(a.State.NoteKey(Key.Enter, ModifierKeys.None));
        Assert.Equal(1, first.Number);

        // Deleting the last place deletes the note (the box closes); undo brings back the note, then the place deleted before
        a.Click(300, 300);
        Assert.Same(first, a.State.Picked);
        a.State.DeletePicked();
        Assert.False(a.State.NoteOpen);
        Assert.Empty(a.State.Marks);
        Assert.False(a.State.HasNotes);
        a.State.Undo();
        Assert.Same(first, a.State.Marks.Single());
        Assert.Equal(1, first.Number);
        Assert.Equal("两处", first.Note);
        a.State.Undo();
        Assert.Equal(2, a.State.Marks.Count);
    }

    [Fact]
    public void Esc_in_the_box_brings_back_a_place_deleted_while_it_was_open()
    {
        var a = new Layer().Selected();
        a.State.ChooseTool(Tool.Note);
        a.Click(300, 300);
        a.Click(400, 300);
        a.View.NoteDraft = "两处";
        a.State.CommitNote();
        a.Click(400, 300);
        a.State.DeletePicked();
        Assert.Single(a.State.Marks);
        Assert.True(a.State.NoteKey(Key.Escape, ModifierKeys.None));
        Assert.Equal(2, a.State.Marks.Count);
        Assert.Equal(2, a.State.Marks.Count(m => m.Head.Number == 1));
    }

    [Fact]
    public void Deleting_a_notes_first_place_leaves_the_note_on_the_rest_and_finishing_hands_it_to_the_next_place()
    {
        var a = new Layer().Selected();
        a.State.ChooseTool(Tool.Rect);
        a.Drag((250, 250), (330, 330));
        a.State.ChooseTool(Tool.Note);
        a.Click(450, 400);
        a.View.NoteDraft = "改成圆角";
        a.State.CommitNote();
        a.State.ChooseTool(Tool.Rect);
        a.Drag((480, 250), (560, 330)); // a second note, so the numbers are 1 and 2
        a.View.NoteDraft = "第二条";
        a.State.CommitNote();
        var (rect, pin, other) = (a.State.Marks[0], a.State.Marks[1], a.State.Marks[2]);

        a.Click(331, 300); // the rectangle's right edge: a line only picks the rectangle, note 1 stays closed
        Assert.Same(rect, a.State.Picked);
        Assert.Null(a.State.NoteFor);
        Assert.True(a.State.Press(Key.Delete, ModifierKeys.None)); // the Delete key reaches the overlay, not a note box
        Assert.Equal([pin, other], a.State.Marks);
        Assert.Equal(1, pin.Head.Number); // the pin still shows number 1
        Assert.Equal(2, other.Number);

        // What is composited: the pin carries the note now, and the numbers are as shown
        var done = a.State.Finished();
        Assert.Equal([pin, other], done);
        Assert.Null(pin.Lead);
        Assert.Equal("改成圆角", pin.Note);
        Assert.Equal(1, pin.Number);
    }

    [Fact]
    public void Without_a_box_Delete_and_Backspace_delete_the_picked_text_and_nothing_happens_when_nothing_is_picked()
    {
        var a = new Layer().Selected();
        a.State.ChooseTool(Tool.Text);
        a.Click(300, 300);
        a.View.TextDraft = "甲";
        a.State.TextKey(Key.Escape);
        a.Click(400, 400);
        a.View.TextDraft = "乙";
        a.State.TextKey(Key.Escape);
        Assert.False(a.Press(Key.Delete)); // nothing picked: the key is not used
        Assert.Equal(2, a.State.Marks.Count);
        a.State.ChooseTool(Tool.Text); // put the tool down
        a.Click(302, 305);
        Assert.Equal("甲", a.State.Picked?.Text);
        Assert.True(a.Press(Key.Delete));
        Assert.Equal("乙", a.State.Marks.Single().Text);
        Assert.Null(a.State.Picked);
        a.Click(402, 405);
        Assert.True(a.Press(Key.Back));
        Assert.Empty(a.State.Marks);
        a.State.Undo();
        a.State.Undo();
        Assert.Equal(["甲", "乙"], a.State.Marks.Select(m => m.Text));
    }

    [Fact]
    public void Clicking_a_marks_line_only_picks_it_so_Delete_reaches_the_overlay_while_clicking_its_number_opens_the_note()
    {
        var a = new Layer().Selected();
        a.State.ChooseTool(Tool.Rect);
        a.Drag((250, 250), (330, 330));
        a.View.NoteDraft = "改成圆角";
        a.State.CommitNote();
        a.State.ChooseTool(Tool.Rect); // put the tool down
        var rect = a.State.Marks.Single();

        a.Click(331, 300); // the right edge: picked, no note box, so the keys are the overlay's
        Assert.Same(rect, a.State.Picked);
        Assert.Null(a.State.NoteFor);
        Assert.True(a.Press(Key.Delete));
        Assert.Empty(a.State.Marks); // its only place: the note goes with it
        a.State.Undo();
        Assert.Same(rect, a.State.Marks.Single());
        Assert.Equal("改成圆角", rect.Note);

        var badge = rect.BadgeAt; // the number: edit that note
        a.Click((int)Math.Round(badge.X), (int)Math.Round(badge.Y));
        Assert.Same(rect, a.State.NoteFor);
        Assert.Same(rect, a.State.Picked);
        Assert.False(a.Press(Key.Delete)); // the box is open: Delete edits its text
        Assert.Same(rect, a.State.Marks.Single());
    }

    [Fact]
    public void Keys_7_and_8_are_black_and_white()
    {
        var a = new Layer().Selected();
        Assert.True(a.Press(Key.D7));
        Assert.Equal(Colors.Black, a.State.Prefs.Color);
        Assert.True(a.Press(Key.NumPad8));
        Assert.Equal(Colors.White, a.State.Prefs.Color);
        Assert.False(a.Press(Key.D9)); // no ninth preset
        Assert.Equal(8, ToolPrefs.Colors.Length);
    }

    // ---------- Clicking a mark changes its color (so a note with several places can refer to them by color) ----------

    [Fact]
    public void With_the_note_box_open_clicking_one_of_its_places_selects_it_and_recolors_only_it_without_closing_the_box_or_adding_a_place()
    {
        var a = new Layer().Selected();
        a.State.ChooseTool(Tool.Note);
        a.Click(300, 300);
        a.Click(400, 300);
        var (first, second) = (a.State.Marks[0], a.State.Marks[1]);
        a.View.NoteDraft = "左边改成 A，黄色那处改成 B";
        a.View.Log.Clear();
        Assert.Equal(CursorKind.Hand, CursorAt(a, 402, 301));
        a.Click(402, 301); // click the number of the second place
        Assert.Same(second, a.State.Picked);
        Assert.True(a.State.NoteOpen);
        Assert.Equal(2, a.State.NotePlaces);
        Assert.DoesNotContain("ShowNotePlaces", a.View.Log); // clicking the canvas does not take focus from the input box, so none needs returning
        a.State.SetColor(ToolPrefs.Colors[2]);
        Assert.Equal(ToolPrefs.Colors[2], second.Color);
        Assert.Equal(ToolPrefs.Colors[0], first.Color);
        Assert.Equal(ToolPrefs.Colors[0], a.State.Prefs.Color); // the color for later drawing is unchanged

        // Click one more place on blank space: the selection is dropped and the new place uses the original color
        a.Click(500, 300);
        Assert.Null(a.State.Picked);
        Assert.Equal(3, a.State.NotePlaces);
        Assert.Equal(ToolPrefs.Colors[0], a.State.Marks[2].Color);
        Assert.True(a.State.NoteKey(Key.Enter, ModifierKeys.None));
        Assert.Equal(ToolPrefs.Colors[2], second.Color);
        Assert.Null(a.State.Picked);

        // The number of another note: with the box open, clicking outside still means done writing, and it is not selected
        a.State.ChooseTool(Tool.Rect);
        a.Drag((250, 400), (300, 450));
        Assert.Equal(CursorKind.Tool, CursorAt(a, 300, 300));
        a.Click(300, 300);
        Assert.False(a.State.NoteOpen);
        Assert.Null(a.State.Picked);
    }

    [Fact]
    public void Without_the_note_box_clicking_a_text_selects_it_keys_1_to_8_recolor_it_undo_reverts_the_color_first_and_Esc_deselects_first()
    {
        // Text is the mark that lives without a note (rectangles, arrows and pen strokes come with one, and clicking them opens it)
        var a = new Layer().Selected();
        a.State.ChooseTool(Tool.Text);
        a.Click(300, 300);
        a.View.TextDraft = "甲";
        a.State.TextKey(Key.Escape);
        a.Click(400, 400);
        a.View.TextDraft = "乙";
        a.State.TextKey(Key.Escape);
        var text = a.State.Marks[0];
        Assert.Equal(CursorKind.Hand, CursorAt(a, 305, 305));
        Assert.Equal(CursorKind.Tool, CursorAt(a, 500, 300)); // blank space: a new mark is drawn as usual
        Assert.False(a.Down(305, 305));
        a.Up();
        Assert.Same(text, a.State.Picked);
        Assert.False(a.State.NoteOpen); // a mark without a note is only selected
        Assert.True(a.Press(Key.D5));
        Assert.Equal(ToolPrefs.Colors[4], text.Color);
        Assert.True(a.Press(Key.NumPad2));
        Assert.Equal(ToolPrefs.Colors[1], text.Color);
        Assert.False(a.Press(Key.D3, ModifierKeys.Control)); // with Ctrl it is not a color change
        Assert.Equal(ToolPrefs.Colors[0], a.State.Prefs.Color);

        // Undo goes one step at a time: the last action was a color change, so it is reverted first; the next undo removes the text written last
        a.State.Undo();
        Assert.Equal(ToolPrefs.Colors[4], text.Color);
        a.State.Undo();
        Assert.Equal(ToolPrefs.Colors[0], text.Color);
        Assert.Equal(2, a.State.Marks.Count);
        a.State.Undo();
        Assert.Same(text, a.State.Marks.Single());
        Assert.Same(text, a.State.Picked);

        // Esc: first deselects without cancelling the capture; pressing it again cancels
        Assert.True(a.Press(Key.Escape));
        Assert.Null(a.State.Picked);
        Assert.Empty(a.Host.Log);
        // With nothing selected, 1–8 set the color for later drawing
        Assert.True(a.Press(Key.D4));
        Assert.Equal(ToolPrefs.Colors[3], a.State.Prefs.Color);
        Assert.Equal(ToolPrefs.Colors[0], text.Color);
        Assert.True(a.Press(Key.Escape));
        Assert.Equal(["RequestCancel"], a.Host.Log);
    }

    [Fact]
    public void Clicking_a_marks_number_opens_that_note_and_selects_that_place_a_color_changed_in_the_box_is_reverted_by_Esc_and_undo_goes_in_order()
    {
        var a = new Layer().Selected();
        a.State.ChooseTool(Tool.Note);
        a.Click(300, 300);
        a.Click(400, 300);
        a.View.NoteDraft = "两处";
        a.State.CommitNote();
        var (first, second) = (a.State.Marks[0], a.State.Marks[1]);

        // Click the number of the second place: opens this note and selects the second place
        a.Click(400, 300);
        Assert.Same(first, a.State.NoteFor);
        Assert.Same(second, a.State.Picked);
        a.State.SetColor(ToolPrefs.Colors[3]);
        Assert.True(a.State.NoteKey(Key.Escape, ModifierKeys.None)); // discard the change
        Assert.Equal(ToolPrefs.Colors[0], second.Color);
        Assert.Null(a.State.Picked);

        // Open it again: change the second place's color → add another place → change its color; undo goes backwards in the order done,
        // and only when all are undone is the note cancelled
        a.Click(400, 300);
        a.State.SetColor(ToolPrefs.Colors[3]);
        a.Click(500, 300);
        var third = a.State.Marks[2];
        a.Click(500, 300); // click the place just added: selects it (no second one is stacked)
        Assert.Same(third, a.State.Picked);
        Assert.Equal(3, a.State.NotePlaces);
        a.State.SetColor(ToolPrefs.Colors[4]);
        a.State.Undo();
        Assert.Equal(ToolPrefs.Colors[0], third.Color);
        a.State.Undo();
        Assert.Equal(2, a.State.NotePlaces);
        Assert.Null(a.State.Picked);
        a.State.Undo();
        Assert.Equal(ToolPrefs.Colors[0], second.Color);
        Assert.True(a.State.NoteOpen);
        a.State.Undo();
        Assert.False(a.State.NoteOpen);
        Assert.Equal("两处", first.Note);
        Assert.Equal(2, a.State.Marks.Count);

        // A saved color change is kept
        a.Click(400, 300);
        a.State.SetColor(ToolPrefs.Colors[1]);
        a.State.CommitNote();
        Assert.Equal(ToolPrefs.Colors[1], second.Color);
    }

    [Fact]
    public void With_the_overall_comment_open_clicking_the_canvas_still_finishes_it_without_adding_a_place()
    {
        var a = new Layer().Selected();
        a.State.ChooseTool(Tool.Note);
        a.Press(Key.N);
        Assert.True(a.State.NoteOpen);
        a.View.NoteDraft = "整体";
        a.Click(300, 300);
        Assert.False(a.State.NoteOpen);
        Assert.Empty(a.State.Marks);
        Assert.Equal("整体", a.State.Overall);
    }
}
