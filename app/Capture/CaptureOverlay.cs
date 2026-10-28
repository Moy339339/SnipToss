using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Effects;
using System.Windows.Media.Imaging;
using System.Windows.Shapes;
using static SnipToss.App.Native;

namespace SnipToss.App.Capture;

/// <summary>
/// The capture overlay on one display (like other screenshot tools): on the frozen picture, hovering highlights a window and a click selects it, or a drag draws a rectangle;
/// the rectangle can be moved and resized by eight handles; below it is a row of tools: rectangle / ellipse / arrow / pen / Pixelate / text,
/// plus SnipToss's own Pin (place a numbered dot and write words for the AI) and Overall comment. After drawing a rectangle, ellipse, arrow or pen stroke, a note box pops up next to it; Esc writes nothing.
/// Finishing (✓, double-click inside the frame, Enter) hands over to <see cref="CaptureSession"/>, which composites the image and puts it on the clipboard.
/// The state and transitions of the selection, tools, marks, note box and text box live in <see cref="OverlayStateMachine"/>;
/// this class only draws, receives mouse and keyboard input, hosts the two input boxes and the magnifier, and shows the warning before cancelling; what the state machine needs from the window is in <see cref="IOverlayView"/>.
/// Coordinates: always DIPs in the window, aligned to physical pixels (<see cref="Snap"/>); compositing multiplies by the scale to get back to physical pixels
/// </summary>
sealed partial class CaptureOverlay : Window, IOverlayView, IOverlayHost
{
    // ---------- Colors and sizes (matching the tokens in packages/web/src/styles.css) ----------
    // Accent is for lines (selection frame, handles, selected text); AccentFill is the solid background under white text and white shapes (--accent-fill: white text passes 4.5:1)
    static readonly Color Accent = Rgb(0x5b8cff), AccentFill = Rgb(0x386be0), AccentFillHover = Rgb(0x3b6fe8), Surface2 = Rgb(0x232327), Hover = Rgb(0x2a2a2f),
        BorderStrong = Rgb(0x3a3a40), Text = Rgb(0xe8e8ea), Text2 = Rgb(0xa9a9b0), Muted = Rgb(0x92929a), Bg = Rgb(0x141416);

    readonly CaptureSession session;
    readonly MonitorShot mon;
    readonly double scale;
    readonly Rect full;
    readonly OverlayStateMachine state;
    ImageSource? pixelated;

    readonly Canvas root = new();
    readonly MarksView marksView;
    readonly Path dim = new() { Fill = Solid(Color.FromArgb(0x80, 0, 0, 0)), IsHitTestVisible = false };
    readonly Rectangle frame = new() { Stroke = Solid(Accent), IsHitTestVisible = false };
    readonly Rectangle[] handles = new Rectangle[8];
    readonly Rectangle surface = new() { Fill = Brushes.Transparent };
    readonly Border sizeLabel;
    readonly TextBlock sizeText = Txt("", 12, Text);
    readonly Border toolbar;
    readonly Border subbar;
    readonly StackPanel subbarItems = new() { Orientation = Orientation.Horizontal };
    readonly Border magnifier;
    readonly Image magImage = new() { Width = 120, Height = 88, Stretch = Stretch.Fill };
    readonly TextBlock magPos = Txt("", 12, Text2), magColor = Txt("", 12, Text2);
    readonly Border magSwatch = new() { Width = 10, Height = 10, CornerRadius = new CornerRadius(2), Margin = new Thickness(0, 0, 6, 0) };
    /// <summary>The instructions below the magnifier the first time Screen Capture is used (drag to select an area, click to select a window, Esc to exit); gone after one capture has been finished (Settings.Capture.SelectHintDone)</summary>
    readonly TextBlock? magHint;

    // The small note box (the words for the AI)
    readonly Border noteBox;
    readonly TextBox noteInput;
    readonly TextBlock noteTitle = Txt("", 12, Muted);
    // Worded like the main app's composer (the two sides use the same phrasing)
    readonly TextBlock notePlaceholder = Txt(Locale.T("capture.note.placeholder"), 13, Muted);

    // Text tool: text written directly on the image
    readonly Border textBox;
    readonly TextBox textInput;

    readonly List<(Border button, Func<bool> on, bool primary)> toolButtons = [];

    /// <param name="defaultColor">The mark color in Settings</param>
    /// <param name="defaultCategory">The default category for new notes (Settings → Annotations → Default category)</param>
    /// <param name="selectHint">Write how to select below the magnifier (for a newcomer who has not finished a capture yet)</param>
    public CaptureOverlay(CaptureSession session, MonitorShot mon, IEnumerable<Int32Rect> windowRects, Color defaultColor, string defaultCategory, bool selectHint = false)
    {
        this.session = session;
        this.mon = mon;
        scale = mon.Scale;
        full = new Rect(0, 0, mon.Bounds.Width / scale, mon.Bounds.Height / scale);
        // Convert window positions to DIPs on this display, keeping only those that intersect it
        var windows = windowRects
            .Select(r => Rect.Intersect(new Rect((r.X - mon.Bounds.X) / scale, (r.Y - mon.Bounds.Y) / scale, r.Width / scale, r.Height / scale), full))
            .Where(r => !r.IsEmpty && r.Width >= 8 && r.Height >= 8)
            .ToList();
        ToolPrefs.Shared.Start(defaultColor);
        // Build the state machine first: the handlers attached below when building the toolbar and input boxes all use it
        state = new OverlayStateMachine(this, this, scale, full, windows, defaultColor, defaultCategory, ToolPrefs.Shared);

        WindowStyle = WindowStyle.None;
        ResizeMode = ResizeMode.NoResize;
        ShowInTaskbar = false;
        Topmost = true;
        Background = Brushes.Black;
        WindowStartupLocation = WindowStartupLocation.Manual;
        Left = mon.Bounds.X;
        Top = mon.Bounds.Y;
        Width = full.Width;
        Height = full.Height;
        UseLayoutRounding = true;
        Cursor = Cursors.Arrow;
        Title = Locale.T("capture.title");
        // With an IME such as a Chinese one active, tool keys like R / A / B are swallowed and turned into composition text: switch the IME off on the overlay
        // and turn it on only in the two text boxes (InputMethod.IsInputMethodEnabled is inherited by children)
        InputMethod.SetIsInputMethodEnabled(this, false);

        var shot = new Image { Source = mon.Shot, Width = full.Width, Height = full.Height, Stretch = Stretch.Fill };
        RenderOptions.SetBitmapScalingMode(shot, BitmapScalingMode.NearestNeighbor);
        marksView = new MarksView(state, () => pixelated ??= MarkPainter.Pixelate(mon.Shot, scale), full) { Width = full.Width, Height = full.Height, IsHitTestVisible = false };
        surface.Width = full.Width;
        surface.Height = full.Height;
        root.Width = full.Width;
        root.Height = full.Height;
        root.Children.Add(shot);
        root.Children.Add(marksView);
        root.Children.Add(dim);
        root.Children.Add(frame);
        for (var i = 0; i < 8; i++)
        {
            handles[i] = new Rectangle { Width = 7, Height = 7, Fill = Brushes.White, Stroke = Solid(Accent), StrokeThickness = 1, IsHitTestVisible = false, Visibility = Visibility.Collapsed };
            root.Children.Add(handles[i]);
        }
        root.Children.Add(surface);

        sizeLabel = new Border { Background = Solid(Color.FromArgb(0xe0, 0x18, 0x18, 0x1b)), CornerRadius = new CornerRadius(4), Padding = new Thickness(6, 2, 6, 2), Child = sizeText, IsHitTestVisible = false };
        root.Children.Add(sizeLabel);

        (textBox, textInput) = BuildTextEditor();
        root.Children.Add(textBox);

        toolbar = Panel(BuildToolbar());
        subbar = Panel(subbarItems);
        root.Children.Add(toolbar);
        root.Children.Add(subbar);

        (noteBox, noteInput) = BuildNoteEditor();
        root.Children.Add(noteBox);

        if (selectHint)
        {
            magHint = Txt(KeepWords.Of(string.Join("\n", Locale.T("capture.hint.drag"), Locale.T("capture.hint.click"), Locale.T("capture.hint.esc"))), 12, Text2);
            magHint.TextWrapping = TextWrapping.Wrap;
            magHint.MaxWidth = 120; // same width as the magnified picture; long languages wrap instead of widening the magnifier
            magHint.LineHeight = 16;
            magHint.Margin = new Thickness(0, 6, 0, 0);
        }
        magnifier = BuildMagnifier();
        root.Children.Add(magnifier);

        Content = root;

        // The handlers take coordinates and modifier keys as parameters: the real mouse and keyboard and the shell tests' entry point (TestInput) go through the same code
#if TEST_HOOKS
        if (!RealInput) IgnoreRealInput();
#endif
        surface.MouseLeftButtonDown += (_, e) =>
        {
            if (Down(Snap(e.GetPosition(root)), e.ClickCount)) e.Handled = true;
        };
        surface.MouseMove += (_, e) => MoveTo(e.GetPosition(root), Keyboard.Modifiers.HasFlag(ModifierKeys.Shift));
        surface.MouseLeftButtonUp += (_, _) => state.EndOp();
        surface.MouseRightButtonUp += (_, _) => state.Right();
        surface.LostMouseCapture += (_, _) => state.EndOp();
        PreviewKeyDown += (_, e) =>
        {
            // In case the IME got it first: ImeProcessedKey is the key actually pressed
            if (state.Press(e.Key switch { Key.System => e.SystemKey, Key.ImeProcessed => e.ImeProcessedKey, _ => e.Key }, Keyboard.Modifiers)) e.Handled = true;
        };
        Closed += (_, _) => session.OverlayClosed(this);
        SourceInitialized += (_, _) =>
        {
            FitToMonitor();
            // When moving across displays with different scales, the system suggests another size on the DPI change; wait until WPF has handled it, then fit the whole display again
            HwndSource.FromHwnd(new WindowInteropHelper(this).Handle)?.AddHook((IntPtr _, int msg, IntPtr _, IntPtr _, ref bool _) =>
            {
                if (msg == 0x02E0 /* WM_DPICHANGED */) Dispatcher.InvokeAsync(FitToMonitor);
                return IntPtr.Zero;
            });
        };
        Loaded += (_, _) =>
        {
            FitToMonitor();
            state.HoverAtCursor();
            Refresh();
        };
        MouseLeave += (_, _) =>
        {
            if (RealInput) MouseLeft();
        };
    }

#if !TEST_HOOKS
    /// <summary>Real mouse and keyboard (with fake displays the shell tests accept only input injected through the test entry point, see CaptureOverlay.TestHooks.cs)</summary>
    static bool RealInput => true;
#endif

    /// <summary>The mouse moved to another display: hide the magnifier and remove this display's hover highlight (ignored while dragging)</summary>
    void MouseLeft()
    {
        if (state.Op != DragOp.None) return;
        magnifier.Visibility = Visibility.Collapsed; // hide the magnifier too (or it would stay where it was)
        state.MouseLeft();
    }

    // ---------- The window covers the whole display (aligned to physical pixels) ----------

    void FitToMonitor()
    {
        var hwnd = new WindowInteropHelper(this).Handle;
        SetWindowPos(hwnd, new IntPtr(-1) /* HWND_TOPMOST */, mon.Bounds.X, mon.Bounds.Y, mon.Bounds.Width, mon.Bounds.Height, 0x0010 /* NOACTIVATE */);
    }

    // ---------- Mouse (what to do is up to the state machine; this class snaps pixels, captures the mouse, and runs the magnifier) ----------

    Point Snap(Point p) => OverlayGeometry.Snap(p, scale);

    /// <summary>Left button down (p is already snapped to physical pixels). Returns true = a drag started and the mouse is captured (captured only when the state machine says to drag)</summary>
    bool Down(Point p, int clicks)
    {
        if (!state.Down(p, clicks)) return false;
        surface.CaptureMouse();
        return true;
    }

    /// <summary>Mouse move (raw = DIPs in this layer, not yet clamped to the screen or snapped)</summary>
    void MoveTo(Point raw, bool shift)
    {
        var p = state.MoveTo(raw, shift);
        ShowMagnifier(p, state.MagnifierVisible);
    }

    // Selection handles, which handle is hit, resizing, moving: OverlayGeometry (pure functions, tested with xUnit)
    static Point[] HandlePoints(Rect r) => OverlayGeometry.HandlePoints(r);

    // ---------- A safeguard before cancelling ----------

    readonly System.Windows.Threading.DispatcherTimer warnTimer = new() { Interval = OverlayStateMachine.WarnFor };
    Border? warn;

    /// <summary>
    /// Once notes have been written, the first Esc / × does not cancel but shows a "press again to discard" warning above the toolbar, and only a second press within 3 seconds really cancels (whether it counts is decided by the state machine's ArmCancel).
    /// Returns true = this time only the warning was shown
    /// </summary>
    public bool GuardCancel()
    {
        if (!state.ArmCancel(DateTime.Now)) return false;
        if (warn is null)
        {
            var text = Txt(KeepWords.Of(Locale.T("capture.cancelWarn")), 13, Text);
            warn = new Border
            {
                Background = Solid(Surface2),
                BorderBrush = Solid(Color.FromRgb(0xff, 0x5f, 0x5f)),
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(8),
                Padding = new Thickness(12, 6, 12, 6),
                Child = text,
                IsHitTestVisible = false,
            };
            root.Children.Add(warn);
            warnTimer.Tick += (_, _) =>
            {
                warnTimer.Stop();
                warn.Visibility = Visibility.Collapsed;
            };
        }
        warn.Visibility = Visibility.Visible;
        warn.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
        var x = Canvas.GetLeft(toolbar);
        var y = Canvas.GetTop(toolbar);
        if (double.IsNaN(x) || double.IsNaN(y))
        {
            x = (full.Width - warn.DesiredSize.Width) / 2;
            y = full.Height / 2;
        }
        Canvas.SetLeft(warn, Math.Clamp(x + toolbar.DesiredSize.Width - warn.DesiredSize.Width, full.Left + 4, Math.Max(full.Left + 4, full.Right - 4 - warn.DesiredSize.Width)));
        // Count the thickness and color row above or below the toolbar too, and place the warning outside the whole group (it used to cover the row above)
        var top = y;
        var bottom = y + toolbar.DesiredSize.Height;
        if (subbar.Visibility == Visibility.Visible && Canvas.GetTop(subbar) is var st && !double.IsNaN(st))
        {
            top = Math.Min(top, st);
            bottom = Math.Max(bottom, st + subbar.DesiredSize.Height);
        }
        Canvas.SetTop(warn, top - 8 - warn.DesiredSize.Height >= full.Top + 4 ? top - 8 - warn.DesiredSize.Height : bottom + 8);
        warnTimer.Stop();
        warnTimer.Start();
        return true;
    }

    /// <summary>Another display started selecting: this one goes back to fully dark, with no highlight</summary>
    public void Idle() => state.Idle();

    // ---------- Writing notes (the words for the AI) ----------

    /// <summary>
    /// The small note box, looking like the main app's composer (Composer.tsx): title, category (Change / Remove / Add / Question, Alt 1~4),
    /// the input box, and "Cancel" and "Save" below (with the same category, cancel and save choices as writing a note in the main app, not just an input box).
    /// The button is called Save, not Finish: the toolbar already has a Finish (finish the whole capture), and two with the same name would be confusing
    /// </summary>
    (Border, TextBox) BuildNoteEditor()
    {
        var input = new TextBox
        {
            MinHeight = 64,
            MaxHeight = 180,
            Margin = new Thickness(0, 8, 0, 0),
            AcceptsReturn = true,
            TextWrapping = TextWrapping.Wrap,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
            Background = Solid(Bg),
            Foreground = Solid(Text),
            CaretBrush = Solid(Text),
            SelectionBrush = Solid(Accent),
            BorderBrush = Solid(BorderStrong),
            BorderThickness = new Thickness(1),
            Padding = new Thickness(6, 6, 6, 6),
            FontFamily = MarkPainter.Font,
            FontSize = 13,
        };
        input.PreviewKeyDown += (_, e) =>
        {
            if (state.NoteKey(e.Key == Key.System ? e.SystemKey : e.Key, Keyboard.Modifiers)) e.Handled = true;
        };
        InputMethod.SetIsInputMethodEnabled(input, true);
        input.TextChanged += (_, _) =>
        {
            notePlaceholder.Visibility = input.Text.Length == 0 ? Visibility.Visible : Visibility.Collapsed;
            PaintNoteButtons();
            // A line break made it taller: lay it out again so it does not run off the bottom of the screen (it used to be placed only when opened)
            if (state.NoteOpen) Dispatcher.InvokeAsync(PlaceNote, System.Windows.Threading.DispatcherPriority.Loaded);
        };
        notePlaceholder.IsHitTestVisible = false;
        notePlaceholder.Margin = new Thickness(9, 15, 9, 0);
        notePlaceholder.TextWrapping = TextWrapping.Wrap;
        // Sits on the first line (the caret's line). It used to be vertically centered by Txt, and since the box is taller than the text the hint landed on the second line with an empty line above
        notePlaceholder.VerticalAlignment = VerticalAlignment.Top;
        var field = new Grid();
        field.Children.Add(input);
        field.Children.Add(notePlaceholder);

        // Category: normally gray text + a category-colored dot, and only the selected one gets a category-colored fill and outline (as in the main app)
        var segRow = new StackPanel { Orientation = Orientation.Horizontal };
        for (var i = 0; i < Categories.Keys.Length; i++)
        {
            var key = Categories.Keys[i];
            var c = Categories.Color(key);
            var row = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
            row.Children.Add(new Ellipse { Width = 6, Height = 6, Fill = Solid(c), Margin = new Thickness(0, 0, 6, 0), VerticalAlignment = VerticalAlignment.Center });
            row.Children.Add(Txt(Categories.Label(key), 12, Text2));
            var seg = new Border
            {
                Height = 28,
                Padding = new Thickness(8, 0, 12, 0),
                Margin = new Thickness(i == 0 ? 0 : 2, 0, 0, 0),
                CornerRadius = new CornerRadius(6),
                BorderThickness = new Thickness(1),
                Child = row,
                ToolTip = Tip(Locale.T("composer.categoryTitle", ("name", Categories.Label(key)), ("n", i + 1))),
            };
            Named(seg, $"category-{key}", Categories.Label(key));
            seg.MouseEnter += (_, _) => PaintNoteButtons();
            seg.MouseLeave += (_, _) => PaintNoteButtons();
            seg.MouseLeftButtonDown += (_, e) => e.Handled = true;
            seg.MouseLeftButtonUp += (_, e) =>
            {
                e.Handled = true;
                state.SetNoteCategory(key);
                noteInput.Focus();
            };
            segs.Add((seg, key));
            segRow.Children.Add(seg);
        }
        var segGroup = new Border
        {
            Background = Solid(Bg),
            BorderBrush = Solid(Rgb(0x2c2c31)),
            BorderThickness = new Thickness(1),
            CornerRadius = new CornerRadius(8),
            Padding = new Thickness(2),
            HorizontalAlignment = HorizontalAlignment.Left,
            Child = segRow,
        };

        // Bottom row: hint + Cancel + Save. The hint is the same sentence as in the main app's composer; there used to be an extra "Esc skips the note" that did not fit on one line with the two buttons
        // and was cut off at "Esc skips…", so it moved into the Cancel button's hover tip
        // Esc only skips this note: rectangles and arrows stay on the image (a screenshot can be drawn on without a note); in the main app Esc cancels the mark along with it (the two sides keep their own behavior)
        // When it does not fit, it wraps to two lines (like the main app composer's .composer-hint): it used to be cut with an ellipsis, so in German, French, Spanish, Italian, Portuguese and Russian the "Shift Enter for a new line" half was invisible
        var hint = Txt(KeepWords.Of(Locale.T("composer.keys")), 12, Muted);
        hint.TextWrapping = TextWrapping.Wrap;
        hint.Margin = new Thickness(0, 0, 8, 0);
        noteCancel = FootButton(Locale.T("capture.note.cancel"), primary: false, state.CancelNote, tip: Locale.T("capture.note.cancelTip"));
        noteSave = FootButton(Locale.T("capture.note.save"), primary: true, state.CommitNote);
        var foot = new Grid { Margin = new Thickness(0, 12, 0, 0) };
        foot.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        foot.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        foot.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(noteCancel, 1);
        Grid.SetColumn(noteSave, 2);
        noteSave.Margin = new Thickness(8, 0, 0, 0);
        foot.Children.Add(hint);
        foot.Children.Add(noteCancel);
        foot.Children.Add(noteSave);

        noteTitle.Margin = new Thickness(0, 0, 0, 8);
        // Inner width 336 (box width 360, same as the main window's composer): the four categories in Italian, German, Russian and Portuguese need a bit over 320, and at a width of 340 the last one was clipped
        var stack = new StackPanel { Width = 336 };
        stack.Children.Add(noteTitle);
        stack.Children.Add(segGroup);
        stack.Children.Add(field);
        stack.Children.Add(foot);
        var box = Panel(stack, padding: 12);
        box.CornerRadius = new CornerRadius(12);
        box.Visibility = Visibility.Collapsed;
        return (box, input);
    }

    readonly List<(Border seg, string key)> segs = [];
    Border noteCancel = null!, noteSave = null!;

    Border FootButton(string label, bool primary, Action click, string? tip = null)
    {
        // The primary button stands out by its blue background, and its text is regular weight (same as .btn-primary in the main UI)
        var text = Txt(label, 13, primary ? Colors.White : Text2);
        var b = Named(new Border { Height = 28, Padding = new Thickness(12, 0, 12, 0), CornerRadius = new CornerRadius(6), Child = text, Background = primary ? Solid(AccentFill) : Brushes.Transparent }, primary ? "note-save" : "note-cancel", label);
        if (tip is not null) b.ToolTip = Tip(tip);
        b.MouseEnter += (_, _) => PaintNoteButtons();
        b.MouseLeave += (_, _) => PaintNoteButtons();
        b.MouseLeftButtonDown += (_, e) => e.Handled = true;
        b.MouseLeftButtonUp += (_, e) =>
        {
            e.Handled = true;
            if (b.Opacity < 1) return; // Save is grayed out while nothing is written
            click();
        };
        return b;
    }

    /// <summary>The selected state of the categories, button hover, and graying out Save while nothing is written</summary>
    void PaintNoteButtons()
    {
        foreach (var (seg, key) in segs)
        {
            var c = Categories.Color(key);
            var on = key == state.NoteCategory;
            seg.Background = on ? Solid(Mix(c, Surface2, 0.18)) : Brushes.Transparent;
            seg.BorderBrush = on ? Solid(Color.FromArgb(0x66, c.R, c.G, c.B)) : Brushes.Transparent;
            if (seg.Child is StackPanel row && row.Children[1] is TextBlock label) label.Foreground = Solid(on ? c : seg.IsMouseOver ? Text : Text2);
        }
        if (noteSave is null) return;
        var empty = noteInput.Text.Trim().Length == 0;
        noteSave.Opacity = empty ? 0.4 : 1;
        noteSave.Background = Solid(!empty && noteSave.IsMouseOver ? AccentFillHover : AccentFill);
        noteCancel.Background = noteCancel.IsMouseOver ? Solid(Hover) : Brushes.Transparent;
        if (noteCancel.Child is TextBlock t) t.Foreground = Solid(noteCancel.IsMouseOver ? Text : Text2);
    }

    static Color Mix(Color a, Color b, double t) =>
        Color.FromRgb((byte)(a.R * t + b.R * (1 - t)), (byte)(a.G * t + b.G * (1 - t)), (byte)(a.B * t + b.B * (1 - t)));

    /// <summary>The note box opens (the state machine has already decided which note and which category): text = the text put in the box first</summary>
    void IOverlayView.OpenNoteBox(string text)
    {
        noteTitle.Text = NoteTitle();
        // A note that marks a place: the hint says more places can be marked (ADR-0009); the overall comment keeps giving an example as before
        notePlaceholder.Text = KeepWords.Of(Locale.T(state.NoteFor is null ? "capture.note.placeholder" : "capture.note.placeholderMarks"));
        noteInput.Text = text;
        PaintNoteButtons();
        noteBox.Visibility = Visibility.Visible;
        noteBox.UpdateLayout();
        PlaceNote();
        Activate();
        noteInput.Focus();
        noteInput.CaretIndex = noteInput.Text.Length;
    }

    /// <summary>"Note 2"; with several places "Note 2 · 3 marks"; the overall comment is "Overall comment (no position)"</summary>
    string NoteTitle()
    {
        if (state.NoteFor is not { } m) return Locale.T("capture.note.overall");
        var n = m.HasNote ? m.Number : m.PendingNumber;
        var places = state.NotePlaces;
        return places > 1 ? Locale.T("capture.note.titlePlaces", ("n", n), ("count", places)) : Locale.T("capture.note.title", ("n", n));
    }

    void IOverlayView.CloseNoteBox() => noteBox.Visibility = Visibility.Collapsed;

    void IOverlayView.PaintNote() => PaintNoteButtons();

    void IOverlayView.ShowNotePlaces()
    {
        noteTitle.Text = NoteTitle();
        // Clicking the canvas does not take focus from the input box, and switching tools clicks the toolbar: either way the keyboard goes back to the note box so typing can continue
        noteInput.Focus();
    }

    string IOverlayView.NoteDraft => noteInput.Text;

    void PlaceNote()
    {
        noteBox.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
        var size = noteBox.DesiredSize;
        Rect anchor = state.NoteFor is { } m ? Inflate(m.Bounds, 12) : new Rect(Canvas.GetLeft(toolbar), Canvas.GetTop(toolbar), toolbar.ActualWidth, toolbar.ActualHeight);
        var at = OverlayGeometry.NoteAt(anchor, size, full);
        Canvas.SetLeft(noteBox, at.X);
        Canvas.SetTop(noteBox, at.Y);
    }

    // ---------- Text tool (text written on the image) ----------

    (Border, TextBox) BuildTextEditor()
    {
        var input = new TextBox
        {
            MinWidth = 40,
            AcceptsReturn = true,
            Background = Brushes.Transparent,
            BorderThickness = new Thickness(0),
            Padding = new Thickness(0),
            FontFamily = MarkPainter.Font,
            CaretBrush = Brushes.White,
            SelectionBrush = Solid(Accent),
        };
        InputMethod.SetIsInputMethodEnabled(input, true);
        input.PreviewKeyDown += (_, e) =>
        {
            if (state.TextKey(e.Key)) e.Handled = true;
        };
        var box = new Border
        {
            BorderBrush = Solid(Color.FromArgb(0xb0, 0xff, 0xff, 0xff)),
            BorderThickness = new Thickness(1),
            Padding = new Thickness(4, 2, 4, 2),
            Child = input,
            Visibility = Visibility.Collapsed,
        };
        return (box, input);
    }

    /// <summary>Opens the text box at the position the state machine chose: empty, with the current font size and color</summary>
    void IOverlayView.OpenTextBox()
    {
        textInput.Text = "";
        RestyleText();
        Canvas.SetLeft(textBox, state.TextAt.X - 5);
        Canvas.SetTop(textBox, state.TextAt.Y - 3);
        textBox.Visibility = Visibility.Visible;
        Activate();
        textInput.Focus();
    }

    void IOverlayView.CloseTextBox() => textBox.Visibility = Visibility.Collapsed;

    void IOverlayView.RestyleText() => RestyleText();

    void RestyleText()
    {
        textInput.FontSize = state.TextSize;
        textInput.Foreground = Solid(state.Prefs.Color);
    }

    string IOverlayView.TextDraft => textInput.Text;

    Point IOverlayView.TextOrigin
    {
        get
        {
            // The text's top-left corner: the position of the first character in the input box, converted to canvas coordinates (so the composited result matches where it was typed)
            var caret = textInput.GetRectFromCharacterIndex(0);
            return caret.IsEmpty ? state.TextAt : textInput.TranslatePoint(new Point(caret.X, caret.Y), root);
        }
    }

    // ---------- Toolbar ----------

    UIElement BuildToolbar()
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal };
        void Tool_(Tool t, string tip, params string[] icon) => row.Children.Add(IconButton(t.ToString().ToLowerInvariant(), icon, tip, () => state.ChooseTool(t), () => state.Tool == t));
        Tool_(Tool.Rect, Locale.T("capture.tool.rect"), Icons.Rect);
        Tool_(Tool.Ellipse, Locale.T("capture.tool.ellipse"), Icons.Ellipse);
        Tool_(Tool.Arrow, Locale.T("capture.tool.arrow"), Icons.Arrow);
        Tool_(Tool.Pen, Locale.T("capture.tool.pen"), Icons.Pen);
        Tool_(Tool.Mosaic, Locale.T("capture.tool.mosaic"), Icons.Mosaic);
        Tool_(Tool.Text, Locale.T("capture.tool.text"), Icons.Text);
        row.Children.Add(Separator());
        Tool_(Tool.Note, Locale.T("capture.tool.note"), Icons.Note);
        row.Children.Add(IconButton("overall", Icons.Overall, Locale.T("capture.tool.overall"), state.ToggleOverall, () => state.NoteOpen && state.NoteFor is null));
        row.Children.Add(Separator());
        row.Children.Add(IconButton("undo", Icons.Undo, Locale.T("capture.tool.undo"), state.Undo, () => false));
        row.Children.Add(IconButton("cancel", Icons.Close, Locale.T("capture.tool.cancel"), session.RequestCancel, () => false));
        row.Children.Add(DoneButton());
        return row;
    }

    /// <summary>A button's name (UI Automation: screen readers read it; shell tests find buttons by id)</summary>
    static T Named<T>(T element, string id, string? name) where T : UIElement
    {
        AutomationProperties.SetAutomationId(element, id);
        if (name is not null) AutomationProperties.SetName(element, name);
        return element;
    }

    Border IconButton(string id, string[] icon, string tip, Action click, Func<bool> on)
    {
        var canvas = new Canvas { Width = 16, Height = 16 };
        foreach (var d in icon)
        {
            var filled = d.StartsWith('F');
            canvas.Children.Add(new Path
            {
                Data = Geometry.Parse(filled ? d[1..] : d),
                Stroke = filled ? null : Solid(Text2),
                Fill = filled ? Solid(Text2) : null,
                StrokeThickness = 1.3,
                StrokeStartLineCap = PenLineCap.Round,
                StrokeEndLineCap = PenLineCap.Round,
                StrokeLineJoin = PenLineJoin.Round,
            });
        }
        var b = Named(new Border { Width = 32, Height = 32, CornerRadius = new CornerRadius(6), Child = canvas, Background = Brushes.Transparent, ToolTip = Tip(tip) }, id, tip);
        Wire(b, click);
        toolButtons.Add((b, on, false));
        return b;
    }

    Border DoneButton()
    {
        var row = new StackPanel { Orientation = Orientation.Horizontal, VerticalAlignment = VerticalAlignment.Center };
        row.Children.Add(new Path
        {
            Data = Geometry.Parse(Icons.Check[0]),
            Stroke = Brushes.White,
            StrokeThickness = 1.6,
            StrokeStartLineCap = PenLineCap.Round,
            StrokeEndLineCap = PenLineCap.Round,
            StrokeLineJoin = PenLineJoin.Round,
            Width = 16,
            Height = 16,
            Margin = new Thickness(0, 0, 6, 0),
        });
        row.Children.Add(Txt(Locale.T("capture.done"), 13, Colors.White)); // regular weight, same as the main UI's primary button
        var tip = Locale.T("capture.doneTip");
        var b = Named(new Border { Height = 32, Padding = new Thickness(10, 0, 12, 0), Margin = new Thickness(4, 0, 0, 0), CornerRadius = new CornerRadius(6), Child = row, Background = Solid(AccentFill), ToolTip = Tip(tip) }, "done", tip);
        Wire(b, session.Finish);
        toolButtons.Add((b, () => false, true));
        return b;
    }

    void Wire(Border b, Action click)
    {
        b.MouseEnter += (_, _) => Paint();
        b.MouseLeave += (_, _) => Paint();
        b.MouseLeftButtonDown += (_, e) => e.Handled = true;
        b.MouseLeftButtonUp += (_, e) =>
        {
            e.Handled = true;
            click();
        };
    }

    /// <summary>Toolbar button backgrounds: the current tool = blue background with a white icon, hover = one step lighter</summary>
    void Paint()
    {
        foreach (var (b, on, primary) in toolButtons)
        {
            var isOn = on();
            if (primary)
            {
                b.Background = Solid(b.IsMouseOver ? AccentFillHover : AccentFill);
                continue;
            }
            b.Background = isOn ? Solid(AccentFill) : b.IsMouseOver ? Solid(Hover) : Brushes.Transparent;
            if (b.Child is Canvas c)
                foreach (var path in c.Children.OfType<Path>())
                {
                    var ink = Solid(isOn ? Colors.White : b.IsMouseOver ? Text : Text2);
                    if (path.Stroke is not null) path.Stroke = ink;
                    if (path.Fill is not null) path.Fill = ink;
                }
        }
    }

    /// <summary>With a drawing tool selected, the row below the toolbar: thickness + color. With a mark picked there are only colors, the lit one is its color, and clicking one changes that mark</summary>
    void BuildSubbar()
    {
        subbarItems.Children.Clear();
        var tool = state.Tool;
        var picked = state.Picked;
        if (tool is Tool.None && picked is null) return;
        if (tool is not Tool.Note && picked is null)
        {
            var sizes = ToolPrefs.Sizes(tool);
            for (var i = 0; i < sizes.Length; i++)
            {
                var index = i;
                var on = state.Prefs.SizeIndex.GetValueOrDefault(tool) == i;
                var dot = new Ellipse { Width = 4 + i * 3, Height = 4 + i * 3, Fill = Solid(on ? Text : Muted) };
                var tip = Locale.T(tool == Tool.Text ? "capture.size.text" : "capture.size.stroke", ("size", sizes[i]));
                var b = Named(new Border { Width = 28, Height = 28, CornerRadius = new CornerRadius(6), Child = dot, Background = on ? Solid(Hover) : Brushes.Transparent, ToolTip = Tip(tip) }, $"size-{i}", tip);
                b.MouseLeftButtonUp += (_, e) =>
                {
                    e.Handled = true;
                    state.SetSize(index);
                };
                b.MouseLeftButtonDown += (_, e) => e.Handled = true;
                subbarItems.Children.Add(b);
            }
        }
        if (tool is Tool.Mosaic && picked is null) return;
        if (subbarItems.Children.Count > 0) subbarItems.Children.Add(Separator());
        var current = picked?.Color ?? state.Prefs.Color;
        for (var i = 0; i < ToolPrefs.Colors.Length; i++)
        {
            var c = ToolPrefs.Colors[i];
            var on = c == current;
            var swatch = new Ellipse { Width = 14, Height = 14, Fill = Solid(c), Stroke = on ? Brushes.White : null, StrokeThickness = 2 };
            var tip = Locale.T("capture.colorTip", ("name", ToolPrefs.Name(c)), ("n", i + 1));
            var b = Named(new Border { Width = 28, Height = 28, CornerRadius = new CornerRadius(6), Child = swatch, Background = Brushes.Transparent, ToolTip = Tip(tip) }, $"color-{Hex(c)}", ToolPrefs.Name(c));
            b.MouseLeftButtonUp += (_, e) =>
            {
                e.Handled = true;
                state.SetColor(c);
            };
            b.MouseLeftButtonDown += (_, e) => e.Handled = true;
            subbarItems.Children.Add(b);
        }
    }

    // ---------- Magnifier ----------

    Border BuildMagnifier()
    {
        var zoom = new Grid { Width = 120, Height = 88, ClipToBounds = true };
        RenderOptions.SetBitmapScalingMode(magImage, BitmapScalingMode.NearestNeighbor);
        zoom.Children.Add(magImage);
        // The crosshair on the middle pixel
        zoom.Children.Add(new Rectangle { Width = 120, Height = 8, Fill = Solid(Color.FromArgb(0x40, 0x5b, 0x8c, 0xff)), VerticalAlignment = VerticalAlignment.Center });
        zoom.Children.Add(new Rectangle { Width = 8, Height = 88, Fill = Solid(Color.FromArgb(0x40, 0x5b, 0x8c, 0xff)), HorizontalAlignment = HorizontalAlignment.Center });
        zoom.Children.Add(new Rectangle { Width = 8, Height = 8, Stroke = Brushes.White, StrokeThickness = 1 });
        var colorRow = new StackPanel { Orientation = Orientation.Horizontal, Margin = new Thickness(0, 2, 0, 0) };
        magSwatch.VerticalAlignment = VerticalAlignment.Center;
        colorRow.Children.Add(magSwatch);
        colorRow.Children.Add(magColor);
        var stack = new StackPanel();
        stack.Children.Add(new Border { Child = zoom, CornerRadius = new CornerRadius(4), ClipToBounds = true });
        magPos.Margin = new Thickness(0, 6, 0, 0);
        stack.Children.Add(magPos);
        stack.Children.Add(colorRow);
        if (magHint is not null) stack.Children.Add(magHint);
        var box = Panel(stack, padding: 6);
        box.IsHitTestVisible = false;
        box.Visibility = Visibility.Collapsed;
        return box;
    }

    void ShowMagnifier(Point p, bool show)
    {
        if (!show)
        {
            magnifier.Visibility = Visibility.Collapsed;
            return;
        }
        // 15×11 physical pixels under the cursor, magnified 8 times
        int px = (int)Math.Round(p.X * scale), py = (int)Math.Round(p.Y * scale);
        px = Math.Clamp(px, 0, mon.Shot.PixelWidth - 1);
        py = Math.Clamp(py, 0, mon.Shot.PixelHeight - 1);
        magImage.Source = Around(px, py);
        var pixel = new byte[4];
        mon.Shot.CopyPixels(new Int32Rect(px, py, 1, 1), pixel, 4, 0);
        var c = Color.FromRgb(pixel[2], pixel[1], pixel[0]);
        magSwatch.Background = Solid(c);
        magColor.Text = $"#{c.R:X2}{c.G:X2}{c.B:X2}";
        var s = state.Op is DragOp.NewSel or DragOp.Resize && state.Sel is { } r ? $"{Math.Round(r.Width * scale)} × {Math.Round(r.Height * scale)}" : $"x {px}  y {py}";
        magPos.Text = s;
        // The instructions show only before a drag starts: once dragging, what matters is the selection size
        if (magHint is not null) magHint.Visibility = state.Op == DragOp.None ? Visibility.Visible : Visibility.Collapsed;
        magnifier.Visibility = Visibility.Visible;
        magnifier.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
        var size = magnifier.DesiredSize;
        var x = p.X + 20;
        var y = p.Y + 20;
        if (x + size.Width > full.Right - 4) x = p.X - 20 - size.Width;
        if (y + size.Height > full.Bottom - 4) y = p.Y - 20 - size.Height;
        Canvas.SetLeft(magnifier, x);
        Canvas.SetTop(magnifier, y);
    }

    /// <summary>
    /// The 15×11 physical pixels centered on (px, py). Next to a screen edge the part that sticks out of the screen is transparent (showing the magnifier's background),
    /// so the crosshair always marks the pixel under the cursor (the view used to be clamped into the screen, and the crosshair marked a different pixel)
    /// </summary>
    BitmapSource Around(int px, int py)
    {
        const int w = 15, h = 11;
        int left = px - w / 2, top = py - h / 2;
        int x0 = Math.Max(0, left), y0 = Math.Max(0, top), x1 = Math.Min(mon.Shot.PixelWidth, left + w), y1 = Math.Min(mon.Shot.PixelHeight, top + h);
        var buffer = new byte[w * h * 4];
        if (x1 > x0 && y1 > y0)
        {
            int cw = x1 - x0, ch = y1 - y0;
            var part = new byte[cw * ch * 4];
            mon.Shot.CopyPixels(new Int32Rect(x0, y0, cw, ch), part, cw * 4, 0); // already converted to Bgra32 when grabbed (Screens.Grab)
            for (var row = 0; row < ch; row++) Buffer.BlockCopy(part, row * cw * 4, buffer, ((y0 - top + row) * w + (x0 - left)) * 4, cw * 4);
        }
        var bitmap = BitmapSource.Create(w, h, 96, 96, PixelFormats.Bgra32, null, buffer, w * 4);
        bitmap.Freeze();
        return bitmap;
    }

    // ---------- Redrawing the outline, the dimmed area and the toolbar ----------

    void Refresh()
    {
        var sel = state.Sel;
        var shown = state.Shown;
        // Dim everything outside the selection (while still choosing, the hovered window is not dimmed, previewing "a click selects this one")
        var dark = new RectangleGeometry(full);
        dim.Data = shown is { } h ? new CombinedGeometry(GeometryCombineMode.Exclude, dark, new RectangleGeometry(h)) : dark;
        marksView.Clip = sel is { } clip ? new RectangleGeometry(clip) : Geometry.Empty;
        marksView.InvalidateVisual();

        if (shown is { } f)
        {
            frame.Visibility = Visibility.Visible;
            frame.StrokeThickness = sel is null ? 2 : 1;
            var inset = sel is null ? 1 : 0.5 / scale;
            Canvas.SetLeft(frame, f.X - inset);
            Canvas.SetTop(frame, f.Y - inset);
            frame.Width = f.Width + inset * 2;
            frame.Height = f.Height + inset * 2;
            sizeText.Text = $"{Math.Round(f.Width * scale)} × {Math.Round(f.Height * scale)}";
            sizeLabel.Visibility = Visibility.Visible;
            sizeLabel.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
            var top = f.Top - 6 - sizeLabel.DesiredSize.Height;
            Canvas.SetLeft(sizeLabel, Math.Clamp(f.Left, full.Left + 4, Math.Max(full.Left + 4, full.Right - 4 - sizeLabel.DesiredSize.Width)));
            Canvas.SetTop(sizeLabel, top >= full.Top + 4 ? top : f.Top + 6);
        }
        else
        {
            frame.Visibility = Visibility.Collapsed;
            sizeLabel.Visibility = Visibility.Collapsed;
        }

        var pts = state.HandlesVisible && sel is { } s ? HandlePoints(s) : null;
        for (var i = 0; i < 8; i++)
        {
            handles[i].Visibility = pts is not null ? Visibility.Visible : Visibility.Collapsed;
            if (pts is null) continue;
            Canvas.SetLeft(handles[i], pts[i].X - 3.5);
            Canvas.SetTop(handles[i], pts[i].Y - 3.5);
        }

        PlaceToolbar();
        if (state.NoteOpen) PlaceNote();
    }

    void PlaceToolbar()
    {
        if (state.Sel is not { } s || !state.ToolbarVisible)
        {
            toolbar.Visibility = Visibility.Collapsed;
            subbar.Visibility = Visibility.Collapsed;
            return;
        }
        Paint();
        BuildSubbar();
        toolbar.Visibility = Visibility.Visible;
        subbar.Visibility = subbarItems.Children.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        var inf = new Size(double.PositiveInfinity, double.PositiveInfinity);
        toolbar.Measure(inf);
        subbar.Measure(inf);
        var sb = subbar.Visibility == Visibility.Visible ? subbar.DesiredSize : new Size(0, 0);
        // Right-aligned below the selection; above it if there is no room below; inside the selection at the bottom if neither fits (OverlayGeometry.ToolbarAt)
        var (bar, sub) = OverlayGeometry.ToolbarAt(s, toolbar.DesiredSize, sb, full);
        Canvas.SetLeft(toolbar, bar.X);
        Canvas.SetTop(toolbar, bar.Y);
        if (sb.Height > 0)
        {
            Canvas.SetLeft(subbar, sub.X);
            Canvas.SetTop(subbar, sub.Y);
        }
    }

    // ---------- What the state machine needs from the window (the rest of IOverlayView; the input-box members are in their own sections above) ----------

    void IOverlayView.Refresh() => Refresh();

    void IOverlayView.RedrawMarks() => marksView.InvalidateVisual();

    void IOverlayView.SetCursor(CursorKind cursor) => Cursor = cursor switch
    {
        CursorKind.Hand => Cursors.Hand,
        // Drawing tools: the pointer becomes that tool's small icon (as in the main app); the Pin tool shows a pin, and Pixelate a circle as large as the brush
        CursorKind.Tool => ToolCursors.For(state.Tool, state.Prefs.Color, scale, state.Prefs.CurrentSize(state.Tool)) ?? Cursors.Arrow,
        CursorKind.SizeAll => Cursors.SizeAll,
        CursorKind.SizeNWSE => Cursors.SizeNWSE,
        CursorKind.SizeNESW => Cursors.SizeNESW,
        CursorKind.SizeNS => Cursors.SizeNS,
        CursorKind.SizeWE => Cursors.SizeWE,
        _ => Cursors.Arrow,
    };

    void IOverlayView.Activate() => Activate();

    void IOverlayView.FocusSelf() => Focus();

    void IOverlayView.ReleaseMouse()
    {
        if (surface.IsMouseCaptured) surface.ReleaseMouseCapture();
    }

    Point? IOverlayView.CursorPosition =>
        Screens.Cursor() is { } c && CaptureSession.Contains(mon.Bounds, c) ? new Point((c.X - mon.Bounds.X) / scale, (c.Y - mon.Bounds.Y) / scale) : null;

    // Multi-display matters go to the session (the selection can be on only one display)
    bool IOverlayHost.IsOwner => session.Owner == this;

    bool IOverlayHost.HasOwner => session.Owner is not null;

    bool IOverlayHost.Claim() => session.Claim(this);

    void IOverlayHost.Release() => session.Release(this);

    void IOverlayHost.FocusOwner() => session.FocusOwner();

    void IOverlayHost.RequestCancel() => session.RequestCancel();

    void IOverlayHost.Finish() => session.Finish();

    // ---------- Handed to the session: what compositing the image needs ----------

    public CaptureResult Result()
    {
        state.CommitOpenEdits();
        var marks = state.Marks;
        return new CaptureResult(mon, state.Sel ?? full, marks.ToList(), state.Overall, state.OverallCategory, pixelated ?? (marks.Any(m => m.Kind == Tool.Mosaic) ? MarkPainter.Pixelate(mon.Shot, scale) : null), full);
    }

    public bool HasSelection => state.Sel is not null;

    /// <summary>The display this layer covers (physical pixels)</summary>
    public Int32Rect Monitor => mon.Bounds;

    /// <summary>Something has been drawn / an overall comment written: the selection is locked and another display cannot take over</summary>
    public bool IsLocked => state.Locked;

    // ---------- Helpers ----------

    static Color Rgb(int rgb) => Color.FromRgb((byte)(rgb >> 16), (byte)(rgb >> 8), (byte)rgb);

    static string Hex(Color c) => $"{c.R:x2}{c.G:x2}{c.B:x2}";

    static SolidColorBrush Solid(Color c)
    {
        var b = new SolidColorBrush(c);
        b.Freeze();
        return b;
    }

    static TextBlock Txt(string text, double size, Color color) =>
        new() { Text = text, FontSize = size, Foreground = Solid(color), FontFamily = MarkPainter.Font, VerticalAlignment = VerticalAlignment.Center };

    static Rect Inflate(Rect r, double d)
    {
        r.Inflate(d, d);
        return r;
    }

    static Border Panel(UIElement child, double padding = 4) => new()
    {
        // Over the toolbar and note box the cursor is an arrow: it must not inherit the position-based cursor of the canvas (the pen icon, the four-way arrow)
        Cursor = Cursors.Arrow,
        Background = Solid(Surface2),
        BorderBrush = Solid(BorderStrong),
        BorderThickness = new Thickness(1),
        CornerRadius = new CornerRadius(10),
        Padding = new Thickness(padding),
        Child = child,
        Effect = new DropShadowEffect { BlurRadius = 24, ShadowDepth = 8, Direction = 270, Opacity = 0.45, Color = Colors.Black },
        Visibility = Visibility.Collapsed,
    };

    static Rectangle Separator() => new() { Width = 1, Height = 16, Fill = Solid(BorderStrong), Margin = new Thickness(4, 0, 4, 0), VerticalAlignment = VerticalAlignment.Center };

    static ToolTip Tip(string text) => new()
    {
        Content = text,
        Background = Solid(Surface2),
        Foreground = Solid(Text),
        BorderBrush = Solid(BorderStrong),
        Padding = new Thickness(8, 4, 8, 4),
        FontFamily = MarkPainter.Font,
        FontSize = 12,
    };
}

/// <summary>The marks on the overlay (including the one being drag-drawn): drawn live on the frozen picture, showing only the part inside the selection</summary>
sealed class MarksView(OverlayStateMachine state, Func<ImageSource> pixelated, Rect monitor) : FrameworkElement
{
    protected override void OnRender(DrawingContext dc)
    {
        var dpi = VisualTreeHelper.GetDpi(this).PixelsPerDip;
        var marks = state.Marks;
        var needMosaic = marks.Any(m => m.Kind == Tool.Mosaic) || state.Drawing?.Kind == Tool.Mosaic;
        var mosaic = needMosaic ? pixelated() : null;
        foreach (var m in marks) MarkPainter.Draw(dc, m, mosaic, monitor, state.Keep, dpi);
        if (state.Drawing is { } d) MarkPainter.Draw(dc, d, mosaic, monitor, state.Keep, dpi);
        if (state.Picked is { } picked) DrawPicked(dc, picked);
    }

    // The picked mark: a blue dashed line over a white halo (visible on both light and dark pictures), drawn only on the overlay and never in the composited image
    static readonly Pen Halo = Frozen(new Pen(Frozen(new SolidColorBrush(Color.FromArgb(0xcc, 0xff, 0xff, 0xff))), 3));
    static readonly Pen Dash = Frozen(new Pen(Frozen(new SolidColorBrush(Color.FromRgb(0x5b, 0x8c, 0xff))), 1.5) { DashStyle = new DashStyle([2, 2], 0) });

    void DrawPicked(DrawingContext dc, Mark m)
    {
        if (m.Kind == Tool.Note)
        {
            // Numbered dot: a ring around the number circle
            var c = MarkPainter.BadgeCenter(m, state.Keep);
            dc.DrawEllipse(null, Halo, c, 14, 14);
            dc.DrawEllipse(null, Dash, c, 14, 14);
            return;
        }
        var r = m.Kind == Tool.Text ? MarkPainter.TextBounds(m) : m.Bounds;
        // Lines have thickness and the arrowhead is wider than the line: widen the box to enclose them
        var pad = (m.Kind == Tool.Arrow ? 2 * m.Size + 5 : m.Kind == Tool.Text ? 0 : m.Size / 2) + 4;
        r.Inflate(pad, pad);
        dc.DrawRectangle(null, Halo, r);
        dc.DrawRectangle(null, Dash, r);
    }

    static T Frozen<T>(T f) where T : Freezable
    {
        f.Freeze();
        return f;
    }
}

/// <summary>What the overlay hands to the session</summary>
sealed record CaptureResult(MonitorShot Monitor, Rect Selection, List<Mark> Marks, string Overall, string OverallCategory, ImageSource? Pixelated, Rect Full);

/// <summary>Toolbar icons (16×16, 1.3 stroke width, the same set as packages/web/src/icons.tsx). A leading F = filled</summary>
static class Icons
{
    public static readonly string[] Rect = ["M4 3.5 H12 A1.5 1.5 0 0 1 13.5 5 V11 A1.5 1.5 0 0 1 12 12.5 H4 A1.5 1.5 0 0 1 2.5 11 V5 A1.5 1.5 0 0 1 4 3.5 Z"];
    public static readonly string[] Ellipse = ["M2.5 8 A5.5 4.5 0 1 0 13.5 8 A5.5 4.5 0 1 0 2.5 8 Z"];
    public static readonly string[] Arrow = ["M3 13 L13 3 M7 3 H13 V9"];
    public static readonly string[] Pen = ["M2.5 12.5 C5 11.5 5.5 6.5 8 6.5 S9.5 10.5 11.5 10.5 S13.5 7.5 13.5 7.5"];
    public static readonly string[] Mosaic = ["M3 3 H13 V13 H3 Z", "FM3 3 H8 V8 H3 Z", "FM8 8 H13 V13 H8 Z"];
    public static readonly string[] Text = ["M3.5 4.5 V3 H12.5 V4.5 M8 3 V13 M6 13 H10"];
    public static readonly string[] Note = ["M8 14 C8 14 12.5 9.9 12.5 6.6 A4.5 4.5 0 0 0 3.5 6.6 C3.5 9.9 8 14 8 14 Z", "M9.6 6.6 A1.6 1.6 0 1 1 6.4 6.6 A1.6 1.6 0 1 1 9.6 6.6 Z"];
    public static readonly string[] Overall = ["M3 3.5 H13 A1 1 0 0 1 14 4.5 V10.5 A1 1 0 0 1 13 11.5 H7 L4 14 V11.5 H3 A1 1 0 0 1 2 10.5 V4.5 A1 1 0 0 1 3 3.5 Z", "M5 6.5 H11 M5 8.5 H9"];
    public static readonly string[] Undo = ["M5 4 L2.5 6.5 L5 9", "M2.5 6.5 H10 A3.5 3.5 0 0 1 10 13.5 H7"];
    public static readonly string[] Close = ["M4.5 4.5 L11.5 11.5 M11.5 4.5 L4.5 11.5"];
    public static readonly string[] Check = ["M3 8.5 L6.2 11.5 L13 4.5"];
}
