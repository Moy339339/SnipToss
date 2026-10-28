using System.Windows;
using System.Windows.Input;
using System.Windows.Media;

namespace SnipToss.App.Capture;

/// <summary>What a drag is doing (from one press to release on the overlay)</summary>
enum DragOp { None, NewSel, Move, Resize, Draw }

/// <summary>The cursor over the canvas (the window turns it into a WPF cursor; Tool = the small icon of the current drawing tool, see ToolCursors)</summary>
enum CursorKind { Arrow, Hand, Tool, SizeAll, SizeNWSE, SizeNESW, SizeNS, SizeWE }

/// <summary>What the state machine needs the overlay window to do: draw, open and close the two input boxes, focus. The window is CaptureOverlay; in unit tests it is a fake</summary>
interface IOverlayView
{
    /// <summary>Redraw the outline, the dimmed area, the handles and the toolbar (the note box follows if it is open)</summary>
    void Refresh();

    /// <summary>Redraw only the marks (called on every frame of a drag-draw, so it must not re-lay out the toolbar)</summary>
    void RedrawMarks();

    void SetCursor(CursorKind cursor);

    /// <summary>Open the note box (the title and category come from the state machine), put text in it first, and give it the keyboard</summary>
    void OpenNoteBox(string text);

    void CloseNoteBox();

    /// <summary>The note box's category changed</summary>
    void PaintNote();

    /// <summary>While the note box is open, this note gained or lost a place, or the tool changed and marking continues: the "N marks" in the title follows, and the keyboard returns to the note box</summary>
    void ShowNotePlaces();

    /// <summary>The text currently in the note box (not saved yet)</summary>
    string NoteDraft { get; }

    /// <summary>Open the text box at TextAt (empty, TextSize font size, current color) and give it the keyboard</summary>
    void OpenTextBox();

    void CloseTextBox();

    /// <summary>The font size or color changed while the text box is open</summary>
    void RestyleText();

    /// <summary>The text currently in the text box (not finished yet)</summary>
    string TextDraft { get; }

    /// <summary>The top-left corner of the first character in the text box (DIPs in this layer): the finished text is drawn here, so its position after compositing matches where it was typed</summary>
    Point TextOrigin { get; }

    void Activate();

    /// <summary>The keyboard returns to the overlay itself (after an input box closes)</summary>
    void FocusSelf();

    /// <summary>Release the mouse if it is captured (the window calls EndOp once more on release)</summary>
    void ReleaseMouse();

    /// <summary>The mouse position when it is on this display (DIPs in this layer, not snapped); null when it is on another display</summary>
    Point? CursorPosition { get; }
}

/// <summary>What the state machine asks the session (with several displays the selection can be on only one; see CaptureSession)</summary>
interface IOverlayHost
{
    /// <summary>The selection is on this layer</summary>
    bool IsOwner { get; }

    /// <summary>Some layer (possibly this one) has a selection</summary>
    bool HasOwner { get; }

    /// <summary>This layer starts selecting: the other layers go back to fully dark. Refused (returns false) if another layer has drawings</summary>
    bool Claim();

    /// <summary>This layer stops selecting: all layers (including this one) go back to Idle</summary>
    void Release();

    void FocusOwner();

    void RequestCancel();

    void Finish();
}

/// <summary>
/// The last color and thickness used (remembered while the app runs, shared by displays and captures through <see cref="Shared"/>).
/// Three sizes: line width, text font size, Pixelate brush width. Even the thinnest Pixelate size must cover a line of body text in one stroke (16 px text with its ascenders and descenders is about 20):
/// it used to be 12 / 20 / 32, and with the thinnest size the top and bottom halves of the text still showed
/// </summary>
sealed class ToolPrefs
{
    public static readonly Color[] Colors = [Rgb(0xff6a3d), Rgb(0xff4d6d), Rgb(0xffc233), Rgb(0x3ddc84), Rgb(0x5b8cff), Rgb(0xb07cff)];
    /// <summary>The names of the preset colors (the options of the message markColor.name), matching Colors one to one (same as markColors.ts in the main app)</summary>
    static readonly string[] Names = ["orange", "red", "yellow", "green", "blue", "purple"];
    static readonly double[] LineSizes = [2, 4, 6], TextSizes = [14, 18, 24], MosaicSizes = [20, 32, 56];

    // Placed after Colors: static fields initialize in the order written, and creating one needs Colors[0]
    public static readonly ToolPrefs Shared = new();

    public Color Color = Colors[0];
    public readonly Dictionary<Tool, int> SizeIndex = new() { [Tool.Text] = 1, [Tool.Mosaic] = 1 };

    /// <summary>
    /// What the mark color in Settings was when a color was chosen in the overlay. If Settings changes later, the new one wins: after picking a color once,
    /// no later change to Settings → Annotations → Mark color was recognized by the overlay until the app restarted
    /// </summary>
    Color? chosenOver;

    /// <summary>The name of a color: presets use their name (following the UI language), anything else (a mark color written by hand in the settings file) uses the hex value</summary>
    public static string Name(Color c)
    {
        var i = Array.IndexOf(Colors, c);
        return i < 0 ? $"#{c.R:x2}{c.G:x2}{c.B:x2}" : Locale.T("markColor.name", ("color", Names[i]));
    }

    public static double[] Sizes(Tool t) => t == Tool.Text ? TextSizes : t == Tool.Mosaic ? MosaicSizes : LineSizes;

    public double CurrentSize(Tool t) => Sizes(t)[SizeIndex.GetValueOrDefault(t)];

    /// <summary>When an overlay opens: the mark color in Settings is defaultColor</summary>
    public void Start(Color defaultColor)
    {
        if (chosenOver == defaultColor) return;
        Color = defaultColor;
        chosenOver = null;
    }

    /// <summary>A color was clicked on the sub-toolbar</summary>
    public void Choose(Color c, Color defaultColor)
    {
        Color = c;
        chosenOver = defaultColor;
    }

    static Color Rgb(int rgb) => Color.FromRgb((byte)(rgb >> 16), (byte)(rgb >> 8), (byte)rgb);
}

/// <summary>
/// The state and transitions of the overlay on one display (split out of CaptureOverlay): selection, hover, drag, tool, marks, note box, text box, undo, the warning before cancelling.
/// It does not touch WPF controls: when it needs to draw, open or close an input box, or move focus it calls <see cref="IOverlayView"/> (the overlay window), and for multi-display matters it asks <see cref="IOverlayHost"/> (the session),
/// so unit tests can run without a window (tests/AppTests/OverlayStateMachineTests.cs). Keep the order of calls to the window as is (state first or open the box first, release the mouse first or finish up first).
/// All coordinates are DIPs in this layer; the press point is already snapped to physical pixels (<see cref="OverlayGeometry.Snap"/>)
/// </summary>
sealed class OverlayStateMachine(IOverlayView view, IOverlayHost host, double scale, Rect full, List<Rect> windows, Color defaultColor, string defaultCategory, ToolPrefs prefs)
{
    /// <summary>After notes have been written, the first Esc / × only warns; pressing again within this time really cancels</summary>
    public static readonly TimeSpan WarnFor = TimeSpan.FromSeconds(3);

    public ToolPrefs Prefs { get; } = prefs;

    readonly List<Mark> marks = [];

    public IReadOnlyList<Mark> Marks => marks;

    /// <summary>null = still choosing</summary>
    public Rect? Sel { get; private set; }

    public Rect? Hover { get; private set; }

    public Tool Tool { get; private set; } = Tool.None;

    public string Overall { get; private set; } = "";

    public string OverallCategory { get; private set; } = "change";

    /// <summary>The category used by the last newly written note on this screenshot: the next one starts from it (like the main app, which remembers the last one per item)</summary>
    string? lastCategory;

    public DragOp Op { get; private set; }

    /// <summary>The mark being drag-drawn (it enters Marks only on release)</summary>
    public Mark? Drawing { get; private set; }

    Point start;
    Rect startSel;
    Rect? downSel;
    int handle = -1;
    bool moved;

    // The small note box (the words for the AI)
    public bool NoteOpen { get; private set; }

    /// <summary>Which note the box is writing (its first place); null with NoteOpen = writing the overall comment</summary>
    public Mark? NoteFor { get; private set; }

    /// <summary>The places marked after this note box opened (undo and Esc take these back)</summary>
    readonly List<Mark> added = [];

    /// <summary>How many places the note being written marks (0 for the overall comment)</summary>
    public int NotePlaces => NoteFor is { } lead ? marks.Count(m => m.Head == lead) : 0;

    /// <summary>
    /// While the note box is open and the note being written marks a place, clicking or drawing with these tools in the selection = this note gains another place and the box stays open (one comment covers several places without repeating it; ADR-0009).
    /// Pixelate and Text do not mark positions, so as before "click elsewhere = done writing"
    /// </summary>
    static bool MarksPlace(Tool t) => t is Tool.Note or Tool.Rect or Tool.Ellipse or Tool.Arrow or Tool.Pen;

    /// <summary>
    /// The mark picked by a click: the colors on the sub-toolbar and the number keys 1–6 change this one, while later drawings still use the color in Prefs (like the main app, where 1–6 on a selected mark changes only that one).
    /// Once a note marks several places, clicking any one of them changes its color, so the note can say by color which place gets which change. null = nothing picked
    /// </summary>
    public Mark? Picked { get; private set; }

    /// <summary>Colors that were changed (restored on undo): Seq is ordered together with the marks' Seq, and undo undoes the later one first</summary>
    readonly List<(Mark Mark, Color Was, int Seq)> recolored = [];

    /// <summary>The ordering of marks and color changes (Mark.Seq and recolored's Seq are taken from here)</summary>
    int clock;

    /// <summary>The clock when this note box opened: while the box is open undo only undoes color changes made after this, and Esc / cancel restores all of them</summary>
    int noteSince;

    public string NoteCategory { get; private set; } = "change";

    // Text tool: text written directly on the image
    public bool TextOpen { get; private set; }

    public Point TextAt { get; private set; }

    public double TextSize { get; private set; }

    DateTime cancelArmed = DateTime.MinValue;

    /// <summary>
    /// There are drawings on this display: marks, an overall comment, or text typed in an input box and not yet saved. This locks the selection (it cannot be moved or re-selected with a right-click),
    /// another display cannot start selecting, and cancelling warns once first (unsaved typed text used to not count: switching displays or clicking × lost it at once)
    /// </summary>
    public bool Locked => marks.Count > 0 || Overall.Length > 0 || PendingText;

    bool PendingText => (TextOpen && view.TextDraft.Trim().Length > 0) || (NoteOpen && view.NoteDraft.Trim().Length > 0);

    public bool HasNotes => marks.Any(m => m.HasNote) || Overall.Length > 0 || PendingText;

    /// <summary>Numbers must not be drawn outside this range (the selection)</summary>
    public Rect Keep => Sel ?? Rect.Empty;

    /// <summary>The part that gets an outline and is not dimmed: the selection; while still choosing, the hovered window (none while another display is selecting)</summary>
    public Rect? Shown => Sel ?? (host.HasOwner && !host.IsOwner ? null : Hover);

    public bool HandlesVisible => Sel is not null && !Locked && Op != DragOp.NewSel;

    /// <summary>The toolbar hides while the selection is being dragged, moved or resized</summary>
    public bool ToolbarVisible => Sel is not null && Op is not (DragOp.NewSel or DragOp.Move or DragOp.Resize);

    public bool MagnifierVisible => Op is DragOp.NewSel or DragOp.Resize || (Sel is null && !host.HasOwner);

    // ---------- Mouse ----------

    /// <summary>Left button down (p is already snapped to physical pixels). Returns true = a drag starts and the window must capture the mouse</summary>
    public bool Down(Point p, int clicks)
    {
        if (clicks == 2 && Sel is { } framed && framed.Contains(p) && host.IsOwner)
        {
            // Double-click inside the frame = finish (whatever tool is selected). If the first click just opened an empty numbered dot / text box, drop it (saving an empty one = removing it).
            // If the first click placed a numbered dot while the note box was open: remove it, and the text being written is saved as usual (it used to cancel here, so a double-click-to-finish with the box open lost the typed text together with this note)
            if (NoteOpen)
            {
                if (added.Count > 0 && added[^1].Kind == Tool.Note && (added[^1].Points[0] - p).Length < 6) RemoveLastPlace();
                CommitNote();
            }
            CommitText();
            host.Finish();
            return false;
        }
        Unpick(); // a click anywhere first drops the picked mark; if the click hits a mark it is picked again
        if (NoteOpen)
        {
            // Hit one of this note's places: pick it (to change its color), keep the box open, and do not add a place
            if (NoteFor is { } mine && host.IsOwner && PlaceAt(p) is { } place && place.Head == mine)
            {
                Pick(place);
                return false;
            }
            // The note being written marks a place, a tool that can mark positions is selected, and the click is inside the selection (not on another note's number): mark one more place and keep the box open
            if (NoteFor is { } lead && MarksPlace(Tool) && Sel is { } open && open.Contains(p) && host.IsOwner && (BadgeAt(p) is not { } hit || hit == lead))
            {
                moved = false;
                start = p;
                downSel = Sel;
                StartMark(p);
                return Op != DragOp.None;
            }
            CommitNote(); // clicking outside = done writing
            return false;
        }
        if (TextOpen)
        {
            CommitText();
            return false;
        }
        if (!host.Claim())
        {
            // Another display already has drawings: give the keyboard back to that layer (otherwise Enter and the tool keys land on this display, which has no selection, and do nothing)
            host.FocusOwner();
            return false;
        }
        moved = false;
        start = p;
        downSel = Sel;
        if (Sel is not { } s)
        {
            Op = DragOp.NewSel;
        }
        else if (PlaceAt(p) is { } m)
        {
            // Hit a mark (a number or a line): pick it; if it has a note, open that note too (clicking a number = edit that note)
            if (m.Head.HasNote) OpenNote(m.Head);
            Pick(m);
            return false;
        }
        else if (Tool != Tool.None && s.Contains(p))
        {
            StartMark(p);
            // A numbered dot or text opens its input box on a single click, with no drag: do not capture the mouse. A capture nobody releases would make this layer swallow later clicks on the toolbar and Finish
            // (symptom: after writing a note nothing responds, and the only way out is Esc, which loses all the notes)
            if (Op == DragOp.None) return false;
        }
        else if (!Locked)
        {
            handle = OverlayGeometry.HitHandle(s, p);
            startSel = s;
            Op = handle >= 0 ? DragOp.Resize : s.Contains(p) ? DragOp.Move : DragOp.NewSel;
        }
        else
        {
            return false;
        }
        return true;
    }

    /// <summary>Mouse move (raw = DIPs in this layer, not yet clamped to the screen or snapped). Returns the snapped point (the magnifier samples its pixel)</summary>
    public Point MoveTo(Point raw, bool shift)
    {
        var p = OverlayGeometry.Snap(OverlayGeometry.Clamp(raw, full), scale);
        if ((p - start).Length > 3) moved = true;
        switch (Op)
        {
            case DragOp.None:
                UpdateHover(p);
                view.SetCursor(CursorAt(p));
                break;
            case DragOp.NewSel:
                if (!moved) break;
                Sel = new Rect(start, p);
                view.Refresh();
                break;
            case DragOp.Move:
                var d = p - start;
                var r = startSel;
                r.X = Math.Clamp(r.X + d.X, full.Left, full.Right - r.Width);
                r.Y = Math.Clamp(r.Y + d.Y, full.Top, full.Bottom - r.Height);
                Sel = r;
                view.Refresh();
                break;
            case DragOp.Resize:
                Sel = OverlayGeometry.Resized(startSel, handle, p);
                view.Refresh();
                break;
            case DragOp.Draw:
                ExtendMark(p, shift);
                break;
        }
        return p;
    }

    /// <summary>
    /// Ends this drag: the left button was released, or the mouse capture was taken away (Alt+Tab mid-drag, a system window popped up, so the release never arrives).
    /// It used to be unhandled when the capture was lost, leaving Op stuck in the dragging state: the selection or mark followed the mouse without a button pressed, and the toolbar did not appear
    /// </summary>
    public void EndOp()
    {
        if (Op == DragOp.None)
        {
            view.ReleaseMouse(); // safety net: however it got captured, releasing the button always lets go
            return;
        }
        var was = Op;
        Op = DragOp.None;
        view.ReleaseMouse(); // this re-enters EndOp, by which time Op is already None
        switch (was)
        {
            case DragOp.NewSel when !moved:
                // No drag = a single click: if nothing is selected yet, select the hovered window (the whole display if none); if something is selected, leave it
                Sel = downSel ?? Hover ?? full;
                break;
            case DragOp.NewSel or DragOp.Resize:
                if (Sel is { } s && (s.Width < 4 || s.Height < 4)) Sel = downSel ?? Hover ?? full;
                break;
            case DragOp.Draw:
                FinishMark();
                break;
        }
        if (Sel is null) host.Release();
        view.Refresh();
        if (Sel is not null) view.Activate();
    }

    /// <summary>Right button released</summary>
    public void Right()
    {
        // The left button is still down (mid-drag): ignore it. It used to clear the selection, so the rectangle just dragged ended up with no selection: no toolbar, and Enter could not finish
        if (Op != DragOp.None) return;
        Unpick();
        if (NoteOpen) CancelNote();
        else if (TextOpen) CommitText();
        else if (Sel is not null && !Locked)
        {
            // Right-click = select again (as in other screenshot tools)
            Sel = null;
            Tool = Tool.None;
            host.Release();
            HoverAtCursor(); // highlight the window under the mouse at once even if the mouse does not move (same as right after opening)
            view.Refresh();
        }
        else if (Sel is null)
        {
            host.RequestCancel(); // notes may have been written on another display: warn once first as usual (it used to discard everything at once)
            host.FocusOwner(); // the warning says "press Enter to finish": the keyboard must return to the layer that has the selection
        }
    }

    /// <summary>The mouse moved to another display: remove this display's hover highlight (two displays used to each light one at the same time). Ignored while dragging</summary>
    public void MouseLeft()
    {
        if (Op != DragOp.None || Sel is not null || Hover is null) return;
        Hover = null;
        view.Refresh();
    }

    /// <summary>The mouse is resting on this display: highlight the window under it by its position without waiting for the mouse to move (it used to appear only after a movement)</summary>
    public void HoverAtCursor()
    {
        if (view.CursorPosition is { } c) UpdateHover(OverlayGeometry.Snap(OverlayGeometry.Clamp(c, full), scale));
    }

    /// <summary>While there is no selection yet, highlight the topmost window under the mouse (the whole display if none); a click selects it</summary>
    void UpdateHover(Point p)
    {
        if (Sel is not null || host.HasOwner) return;
        var hit = windows.FindIndex(r => r.Contains(p)); // the first one from the top
        Hover = hit >= 0 ? windows[hit] : full;
        view.Refresh();
    }

    CursorKind CursorAt(Point p)
    {
        if (Sel is not { } s) return CursorKind.Arrow;
        // A mark that can be hit shows a hand (clicking picks it and edits its note). While the note box is open only this note's places can be hit; anything else is "click outside = done writing"
        if (NoteOpen ? NoteFor is { } mine && PlaceAt(p)?.Head == mine : !TextOpen && PlaceAt(p) is not null) return CursorKind.Hand;
        // Drawing tools: the pointer becomes that tool's small icon (as in the main app), and the Pin tool shows a pin
        if (Tool != Tool.None && s.Contains(p)) return CursorKind.Tool;
        if (Locked) return CursorKind.Arrow;
        return OverlayGeometry.HitHandle(s, p) switch
        {
            0 or 4 => CursorKind.SizeNWSE,
            2 or 6 => CursorKind.SizeNESW,
            1 or 5 => CursorKind.SizeNS,
            3 or 7 => CursorKind.SizeWE,
            _ => s.Contains(p) ? CursorKind.SizeAll : CursorKind.Arrow,
        };
    }

    void Nudge(double dx, double dy)
    {
        if (Sel is not { } s || Locked) return;
        Sel = OverlayGeometry.Nudge(s, dx, dy, scale, full);
        view.Refresh();
    }

    // ---------- Several displays, cancelling ----------

    /// <summary>Another display started selecting: this one goes back to fully dark, with no highlight</summary>
    public void Idle()
    {
        // An open empty note box or text box is closed along with it (one with text locks the selection, so it never gets here): they used to stay on the dark display and swallow the first click after coming back.
        // CloseNote / HideText are not called: they pull keyboard focus back to this layer, while the user is selecting on another display right now
        NoteOpen = false;
        NoteFor = null;
        added.Clear();
        view.CloseNoteBox();
        TextOpen = false;
        view.CloseTextBox();
        Sel = null;
        Hover = null;
        marks.Clear();
        Picked = null;
        recolored.Clear();
        Overall = "";
        Tool = Tool.None;
        view.Refresh();
    }

    /// <summary>
    /// Once notes have been written, the first Esc / × does not cancel but warns "press again to discard"; only a second press within <see cref="WarnFor"/> really cancels.
    /// Returns true = this time should warn (and not cancel)
    /// </summary>
    public bool ArmCancel(DateTime now)
    {
        if (!HasNotes || now - cancelArmed < WarnFor) return false;
        cancelArmed = now;
        return true;
    }

    /// <summary>On finish: the open note box and text box are committed first</summary>
    public void CommitOpenEdits()
    {
        if (NoteOpen) CommitNote();
        if (TextOpen) CommitText();
    }

    // ---------- Drawing marks ----------

    void StartMark(Point p)
    {
        switch (Tool)
        {
            case Tool.Text:
                OpenText(p);
                Op = DragOp.None;
                return;
            case Tool.Note:
                Op = DragOp.None;
                if (NoteOpen && NoteFor is { } lead)
                {
                    // Mark one more place. If this note already has a numbered dot at almost the same spot (a double click), do not stack another
                    if (!marks.Any(x => x.Head == lead && x.Kind == Tool.Note && (x.Points[0] - p).Length < 6))
                        AddPlace(new Mark { Kind = Tool.Note, Color = Prefs.Color, Size = 2, Points = [p], Lead = lead });
                    return;
                }
                var pin = new Mark { Kind = Tool.Note, Color = Prefs.Color, Size = 2, Points = [p] };
                Put(pin);
                view.RedrawMarks();
                OpenNote(pin);
                return;
        }
        var m = new Mark { Kind = Tool, Color = Prefs.Color, Size = Prefs.CurrentSize(Tool), Points = [p] };
        if (Tool is Tool.Rect or Tool.Ellipse or Tool.Arrow) m.Points.Add(p);
        Drawing = m;
        Op = DragOp.Draw;
    }

    void ExtendMark(Point p, bool shift)
    {
        if (Drawing is not { } m || Sel is not { } s) return;
        p = new Point(Math.Clamp(p.X, s.Left, s.Right), Math.Clamp(p.Y, s.Top, s.Bottom));
        switch (m.Kind)
        {
            case Tool.Rect or Tool.Ellipse:
                // Shift: square / circle
                if (shift) p = OverlayGeometry.SquareCorner(m.Points[0], p, s);
                m.Points[1] = p;
                break;
            case Tool.Arrow:
                m.Points[1] = p;
                break;
            default:
                if ((p - m.Points[^1]).Length >= 1.5) m.Points.Add(p);
                break;
        }
        view.RedrawMarks();
    }

    void FinishMark()
    {
        var m = Drawing;
        Drawing = null;
        if (m is null || m.IsTiny)
        {
            view.RedrawMarks();
            // A click inside the selection while the note box is open, without a drag: as before, clicking elsewhere = done writing
            if (m is not null && NoteOpen) CommitNote();
            return;
        }
        if (NoteOpen && NoteFor is { } lead)
        {
            // Drawn while the note box is open: this note gains another place, and the box stays open and does not move
            m.Lead = lead;
            AddPlace(m);
            return;
        }
        Put(m);
        view.RedrawMarks();
        // After drawing a rectangle, ellipse, arrow or pen stroke: pop up the note box next to it (Esc writes nothing and just keeps the mark)
        if (m.Kind is Tool.Rect or Tool.Ellipse or Tool.Arrow or Tool.Pen) OpenNote(m);
    }

    /// <summary>One more place marked while the note box is open: added to this note</summary>
    void AddPlace(Mark m)
    {
        Put(m);
        added.Add(m);
        view.RedrawMarks();
        view.ShowNotePlaces();
    }

    /// <summary>Adds a newly drawn mark (recording its order)</summary>
    void Put(Mark m)
    {
        m.Seq = ++clock;
        marks.Add(m);
    }

    /// <summary>Removes the last place marked this time (undo, Alt+Z in the note box). Returns false = nothing was marked this time</summary>
    bool RemoveLastPlace()
    {
        if (added.Count == 0) return false;
        marks.Remove(added[^1]);
        added.RemoveAt(added.Count - 1);
        view.RedrawMarks();
        view.ShowNotePlaces();
        return true;
    }

    public void Undo()
    {
        if (NoteOpen)
        {
            // First undo what was done while this box was open: the places marked and the colors changed, the later one first; only when none is left cancel the note being written;
            // one more press is needed to undo the last mark (undoing while editing note 1 used to delete the last mark as well)
            if (!UndoRecolor(Math.Max(noteSince, added.Count > 0 ? added[^1].Seq : 0)) && !RemoveLastPlace()) CancelNote();
            KeepPick();
            return;
        }
        if (TextOpen)
        {
            // Typing text: what gets undone is this text (it used to undo the previously drawn mark, leaving this text in place so that a click anywhere afterwards would commit it)
            HideText();
            return;
        }
        // The last action was a color change (later than the last drawn mark): change it back
        if (UndoRecolor(marks.Count > 0 ? marks[^1].Seq : 0))
        {
            KeepPick();
            return;
        }
        if (marks.Count > 0) marks.RemoveAt(marks.Count - 1);
        else Overall = "";
        KeepPick();
        Renumber();
        view.Refresh();
    }

    /// <summary>Undoes the last color change if it is later than after (the last drawn mark, or the moment this note box opened). Returns false = nothing to undo</summary>
    bool UndoRecolor(int after)
    {
        recolored.RemoveAll(r => !marks.Contains(r.Mark)); // ignore marks that are gone (undone, taken back)
        if (recolored.Count == 0 || recolored[^1].Seq <= after) return false;
        var (m, was, _) = recolored[^1];
        recolored.RemoveAt(recolored.Count - 1);
        m.Color = was;
        view.Refresh();
        return true;
    }

    /// <summary>After an undo the picked mark is gone: it is no longer picked</summary>
    void KeepPick()
    {
        if (Picked is { } m && !marks.Contains(m)) Unpick();
    }

    void Pick(Mark m)
    {
        Picked = m;
        view.Refresh(); // draw a selection box on the mark, and the sub-toolbar switches to its color
    }

    void Unpick()
    {
        if (Picked is null) return;
        Picked = null;
        view.Refresh();
    }

    void Renumber()
    {
        var n = 0;
        // The number is kept on the first place, and the places marked afterwards draw the first place's number (MarkPainter)
        foreach (var m in marks) m.Number = m.Lead is null && m.Note.Length > 0 ? ++n : 0;
        view.RedrawMarks();
    }

    /// <summary>Which note's number was hit (for a note with several places, any place's number is that note; returns the first place)</summary>
    Mark? BadgeAt(Point p) => BadgePlaceAt(p)?.Head;

    /// <summary>Which place's number was hit (the note being written and not yet saved counts too: its number is already drawn)</summary>
    Mark? BadgePlaceAt(Point p) => marks.LastOrDefault(m => (m.Head.HasNote || m.Head.PendingNumber > 0) && (MarkPainter.BadgeCenter(m, Keep) - p).Length <= 11);

    /// <summary>Which mark was hit: numbers are drawn on top, so check numbers first, then lines and text (later ones are on top); Pixelate does not count (it has no color to change)</summary>
    Mark? PlaceAt(Point p) => BadgePlaceAt(p) ?? marks.LastOrDefault(m => m.Kind == Tool.Note ? (MarkPainter.BadgeCenter(m, Keep) - p).Length <= 11 : m.Hits(p));

    // ---------- Writing notes (the words for the AI) ----------

    /// <param name="m">null = overall comment</param>
    void OpenNote(Mark? m)
    {
        if (NoteOpen) CommitNote(); // switching to open another: the open one is committed first and its preview number is taken back
        Picked = null; // when opened by clicking a mark, the caller picks the hit place again afterwards
        NoteFor = m;
        NoteOpen = true;
        added.Clear();
        noteSince = clock;
        if (m is { HasNote: false }) m.PendingNumber = marks.Count(x => x.HasNote) + 1;
        NoteCategory = m is { HasNote: true } ? m.Category : m is null && Overall.Length > 0 ? OverallCategory : lastCategory ?? defaultCategory;
        view.OpenNoteBox(m?.Note ?? Overall);
        view.Refresh();
    }

    /// <summary>A key pressed in the note box (the overlay's own keys give way first, see Press). Returns true = handled, and the input box does not get it</summary>
    public bool NoteKey(Key key, ModifierKeys mods)
    {
        if (key == Key.Enter && !mods.HasFlag(ModifierKeys.Shift))
        {
            CommitNote(); // Enter and Ctrl+Enter both save (a note on a screenshot is usually one sentence); Shift+Enter inserts a line break
            return true;
        }
        if (key == Key.Escape)
        {
            CancelNote();
            return true;
        }
        if (mods.HasFlag(ModifierKeys.Alt) && key is >= Key.D1 and <= Key.D4)
        {
            SetNoteCategory(Categories.Keys[key - Key.D1]);
            return true;
        }
        if (mods.HasFlag(ModifierKeys.Alt) && key == Key.Z)
        {
            RemoveLastPlace(); // remove the last place marked (same as Alt+Z in the main app's composer); if none was marked, do nothing and do not cancel the whole note
            return true;
        }
        return false;
    }

    public void SetNoteCategory(string key)
    {
        NoteCategory = key;
        view.PaintNote();
    }

    public void CommitNote()
    {
        if (!NoteOpen) return;
        var text = view.NoteDraft.Trim();
        if (text.Length > 0) lastCategory = NoteCategory;
        if (NoteFor is { } m)
        {
            m.Note = text;
            m.Category = NoteCategory;
            if (text.Length == 0)
            {
                // No text written (or all of it deleted) = no note wanted: remove the numbered dots, and keep the rectangles and arrows as plain drawings
                foreach (var x in marks.Where(x => x.Lead == m).ToList()) Drop(x);
                if (m.Kind == Tool.Note) marks.Remove(m);
            }
        }
        else
        {
            Overall = text;
            OverallCategory = NoteCategory;
        }
        CloseNote();
    }

    public void CancelNote()
    {
        if (!NoteOpen) return;
        // Colors changed while this box was open are changed back; places marked since, and a newly placed numbered dot that never had text, are taken back together (the dot is removed, rectangles and arrows stay as plain drawings without a note); when editing an existing note its original places are left alone
        while (UndoRecolor(noteSince)) { }
        foreach (var x in added) Drop(x);
        if (NoteFor is { Kind: Tool.Note, Note.Length: 0 } pin) marks.Remove(pin);
        CloseNote();
    }

    /// <summary>A place no longer belongs to this note: a numbered dot (there only to mark a position) is removed, while rectangles, arrows and pen strokes stay as drawings</summary>
    void Drop(Mark x)
    {
        if (x.Kind == Tool.Note) marks.Remove(x);
        else x.Lead = null;
    }

    void CloseNote()
    {
        NoteOpen = false;
        added.Clear();
        Picked = null; // the picked mark is one of this note's places: once the box closes it is no longer picked (redrawn below)
        if (NoteFor is not null) NoteFor.PendingNumber = 0;
        NoteFor = null;
        view.CloseNoteBox();
        Renumber();
        view.Refresh();
        view.FocusSelf();
    }

    // ---------- Text tool (text written on the image) ----------

    void OpenText(Point p)
    {
        TextAt = p;
        TextSize = Prefs.CurrentSize(Tool.Text);
        TextOpen = true;
        view.OpenTextBox();
    }

    /// <summary>A key pressed in the text box: Esc means done (not cancel), and everything else goes to the input box (Enter inserts a line break)</summary>
    public bool TextKey(Key key)
    {
        if (key != Key.Escape) return false;
        CommitText();
        return true;
    }

    void CommitText()
    {
        if (!TextOpen) return;
        var text = view.TextDraft.TrimEnd();
        if (text.Trim().Length > 0) Put(new Mark { Kind = Tool.Text, Color = Prefs.Color, Size = TextSize, Points = [view.TextOrigin], Text = text });
        HideText();
    }

    /// <summary>Closes the text box (finished text has already become a mark; on undo it just closes and keeps no text)</summary>
    void HideText()
    {
        TextOpen = false;
        view.CloseTextBox();
        view.RedrawMarks();
        view.Refresh();
        view.FocusSelf();
    }

    // ---------- Keyboard, toolbar ----------

    /// <summary>A key pressed on the overlay (the window gets it first, the input boxes after). Returns true = handled (swallowed); false = leave it to the input box / the system</summary>
    public bool Press(Key key, ModifierKeys mods)
    {
        // Alt+F4 = cancel (warn once first if notes were written). It used to go back to the system, which closed only this layer without the session knowing, and Screen Capture could never open again
        if (key == Key.F4 && mods.HasFlag(ModifierKeys.Alt))
        {
            host.RequestCancel();
            return true;
        }
        if (NoteOpen || TextOpen) return false; // the input box handles it itself
        var ctrl = mods.HasFlag(ModifierKeys.Control);
        var shift = mods.HasFlag(ModifierKeys.Shift);
        switch (key)
        {
            case Key.Escape when Picked is not null:
                Unpick(); // first put down the picked mark; pressing again cancels the capture
                break;
            case Key.Escape:
                host.RequestCancel();
                break;
            case >= Key.D1 and <= Key.D6 when mods == ModifierKeys.None && Sel is not null:
                SetColor(ToolPrefs.Colors[key - Key.D1]); // same order as the colors on the sub-toolbar (same as 1–6 in the main app)
                break;
            case >= Key.NumPad1 and <= Key.NumPad6 when mods == ModifierKeys.None && Sel is not null:
                SetColor(ToolPrefs.Colors[key - Key.NumPad1]);
                break;
            case Key.Enter:
            case Key.C when ctrl:
                host.Finish(); // works when the selection is on another display too (Finish looks for the layer that has drawings)
                break;
            case Key.Z when ctrl && !shift: // Ctrl+Shift+Z is redo in the main app, and the overlay has no redo: do not treat it as another undo
                Undo();
                break;
            case Key.Left:
                Nudge(shift ? -10 : -1, 0);
                break;
            case Key.Right:
                Nudge(shift ? 10 : 1, 0);
                break;
            case Key.Up:
                Nudge(0, shift ? -10 : -1);
                break;
            case Key.Down:
                Nudge(0, shift ? 10 : 1);
                break;
            default:
                var t = key switch
                {
                    Key.R => Tool.Rect,
                    Key.O => Tool.Ellipse,
                    Key.A => Tool.Arrow,
                    Key.B => Tool.Pen,
                    Key.M => Tool.Mosaic,
                    Key.T => Tool.Text,
                    Key.C => Tool.Note,
                    _ => Tool.None,
                };
                if (t != Tool.None && !ctrl && Sel is not null) ChooseTool(t, toggle: false);
                else if (key == Key.N && !ctrl && Sel is not null) OpenNote(null);
                else return false;
                break;
        }
        return true;
    }

    /// <summary>
    /// The "Overall comment" button on the toolbar: the open note box and text box are committed first (same as clicking a tool button), then the overall comment opens; if the overall comment is already open = commit and close (same as clicking the selected tool again).
    /// It used to open directly: the text of the note being written was lost, and the newly drawn mark kept its preview number while the copied image had no matching explanation
    /// </summary>
    public void ToggleOverall()
    {
        if (NoteOpen && NoteFor is null)
        {
            CommitNote();
            return;
        }
        if (NoteOpen) CommitNote();
        CommitText();
        OpenNote(null);
    }

    /// <param name="toggle">Clicking the already selected tool on the toolbar = put it down; a shortcut key always selects (as in the main app, pressing R repeatedly stays on Rectangle)</param>
    public void ChooseTool(Tool t, bool toggle = true)
    {
        var next = toggle && Tool == t ? Tool.None : t;
        Picked = null; // picking up a tool means drawing something new (redrawn below)
        // While a note that marks a place is being written, switching to another tool that can mark positions keeps the box open and continues marking with it (same as switching tools while the main app's composer is open); switching to anything else commits as before
        var keepNote = NoteOpen && NoteFor is not null && MarksPlace(next);
        if (NoteOpen && !keepNote) CommitNote();
        if (TextOpen) CommitText();
        Tool = next;
        view.Refresh();
        CursorAtPointer();
        if (keepNote) view.ShowNotePlaces();
    }

    /// <summary>The nth thickness was clicked on the sub-toolbar (for text, the font size)</summary>
    public void SetSize(int index)
    {
        Prefs.SizeIndex[Tool] = index;
        if (Tool == Tool.Text && TextOpen)
        {
            TextSize = Prefs.CurrentSize(Tool.Text);
            view.RestyleText();
        }
        view.Refresh();
        CursorAtPointer();
    }

    /// <summary>A color was clicked on the sub-toolbar or 1–6 was pressed: with a mark picked only it changes (undoable), otherwise it sets the color for later drawings</summary>
    public void SetColor(Color c)
    {
        if (Picked is { } m)
        {
            if (m.Color != c)
            {
                recolored.Add((m, m.Color, ++clock));
                m.Color = c;
            }
            view.Refresh();
            return;
        }
        Prefs.Choose(c, defaultColor);
        // While typing text: the text in the input box changes color too (it used to keep the old color and only change after being committed)
        if (TextOpen) view.RestyleText();
        view.Refresh();
        CursorAtPointer();
    }

    /// <summary>After the tool, thickness or color changes: the pointer changes at once even if the mouse is still (after pressing M to switch tools it used to change only once the mouse moved). Ignored while dragging</summary>
    void CursorAtPointer()
    {
        if (Op == DragOp.None && view.CursorPosition is { } c) view.SetCursor(CursorAt(OverlayGeometry.Snap(OverlayGeometry.Clamp(c, full), scale)));
    }
}
