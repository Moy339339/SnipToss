#if TEST_HOOKS
using System.Text.Json;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;

namespace SnipToss.App.Capture;

/// <summary>
/// Test entry points for the capture overlay (ADR-0004 item 3): read this layer's state and inject mouse and keyboard input. Compiled only into the shell-test build (TEST_HOOKS),
/// and used only with fake displays (TestHooks.CaptureFake: placed off screen so nothing is visible). All coordinates are DIPs in this layer
/// </summary>
sealed partial class CaptureOverlay
{
    /// <summary>With fake displays the real mouse and keyboard are ignored and only input injected through <see cref="TestInput"/> counts, so someone moving the mouse or typing nearby cannot disturb a test</summary>
    static bool RealInput => CaptureFakes.Monitors is null;

    /// <summary>Intercepted first on the window (tunneling events): the later bubbling events and the input boxes never see them. The movement the system re-sends while the mouse is captured is intercepted here as well</summary>
    void IgnoreRealInput()
    {
        PreviewMouseDown += (_, e) => e.Handled = true;
        PreviewMouseUp += (_, e) => e.Handled = true;
        PreviewMouseMove += (_, e) => e.Handled = true;
        PreviewMouseWheel += (_, e) => e.Handled = true;
        PreviewKeyDown += (_, e) => e.Handled = true;
        PreviewTextInput += (_, e) => e.Handled = true;
    }

    Point testMouse;

    /// <summary>One step: down / move / up / right / click (id or x, y) / dblclick / drag / leave / key / type</summary>
    internal object? TestInput(JsonElement a)
    {
        var op = a.GetProperty("op").GetString();
        switch (op)
        {
            case "down":
                return TestDown(Pt(a), a.TryGetProperty("clicks", out var n) ? n.GetInt32() : 1);
            case "move":
                TestMove(Pt(a), Flag(a, "shift"));
                break;
            case "up":
                TestUp(a.TryGetProperty("x", out _) ? Pt(a) : testMouse);
                break;
            case "right":
                TestRight(a.TryGetProperty("x", out _) ? Pt(a) : testMouse);
                break;
            case "click":
                {
                    var p = a.TryGetProperty("id", out var id) ? CenterOf(id.GetString()!) : Pt(a);
                    TestDown(p, 1);
                    TestUp(p);
                    return new { x = p.X, y = p.Y };
                }
            case "dblclick":
                {
                    var p = Pt(a);
                    TestDown(p, 1);
                    TestUp(p);
                    TestDown(p, 2);
                    TestUp(p);
                    break;
                }
            case "drag":
                {
                    // Do it all in one go (without yielding the UI thread in between)
                    var from = Pt(a, "from");
                    var to = Pt(a, "to");
                    var steps = a.TryGetProperty("steps", out var s) ? s.GetInt32() : 8;
                    var shift = Flag(a, "shift");
                    TestDown(from, 1);
                    for (var i = 1; i <= steps; i++) TestMove(from + (to - from) * i / steps, shift);
                    if (!Flag(a, "hold")) TestUp(to);
                    break;
                }
            case "leave":
                MouseLeft();
                break;
            case "cursorAt":
                return CursorAtPoint(Pt(a));
            case "losecapture":
                // The mouse capture is taken away mid-drag (Alt+Tab, a system dialog)
                surface.ReleaseMouseCapture();
                break;
            case "shot":
                {
                    // Render this layer to a PNG (path) to look at it: a fake display is off screen and cannot be screen-grabbed. Tooltips are popup windows and are not included
                    root.UpdateLayout();
                    var bitmap = new RenderTargetBitmap((int)Math.Ceiling(full.Width * scale), (int)Math.Ceiling(full.Height * scale), 96 * scale, 96 * scale, PixelFormats.Pbgra32);
                    bitmap.Render(root);
                    var png = new PngBitmapEncoder();
                    png.Frames.Add(BitmapFrame.Create(bitmap));
                    using var file = System.IO.File.Create(a.GetProperty("path").GetString()!);
                    png.Save(file);
                    break;
                }
            case "key":
                return TestKey(a);
            case "type":
                {
                    // replace = select all first, then type (same as Ctrl+A and then typing); typing an empty string clears the box
                    var input = OpenInput() ?? throw new InvalidOperationException("No input box is open");
                    if (Flag(a, "replace")) input.Text = "";
                    Insert(input, a.GetProperty("text").GetString()!);
                    break;
                }
            default:
                throw new ArgumentException($"Unknown op: {op}");
        }
        return null;
    }

    static Point Pt(JsonElement a) => new(a.GetProperty("x").GetDouble(), a.GetProperty("y").GetDouble());

    static Point Pt(JsonElement a, string name) => new(a.GetProperty(name)[0].GetDouble(), a.GetProperty(name)[1].GetDouble());

    static bool Flag(JsonElement a, string name) => a.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    /// <summary>
    /// Who receives this input, following the real routing: if the mouse is captured, whoever captured it; otherwise the topmost element at that point (the toolbar and note box over the canvas get it first)
    /// </summary>
    UIElement TestTarget(Point p)
    {
        if (Mouse.Captured is UIElement captured)
        {
            if (!IsAncestorOf(captured)) throw new InvalidOperationException("The mouse is captured by another window");
            return captured;
        }
        root.UpdateLayout();
        // InputHitTest is the one the real mouse uses: it skips what cannot be hit (the magnifier and size label with IsHitTestVisible = false, and everything inside them) and what is invisible
        return root.InputHitTest(p) as UIElement ?? surface;
    }

    /// <summary>Returns who it landed on (the canvas = surface, a button = its id, anything else = the type name)</summary>
    string TestDown(Point p, int clicks)
    {
        testMouse = p;
        var target = TestTarget(p);
        if (target == surface) Down(Snap(p), clicks);
        else Raise(target, Mouse.MouseDownEvent, MouseButton.Left);
        return target == surface ? "surface" : Describe(target);
    }

    static string Describe(UIElement e)
    {
        for (DependencyObject? v = e; v is not null; v = VisualTreeHelper.GetParent(v))
            if (v is FrameworkElement f && AutomationProperties.GetAutomationId(f) is { Length: > 0 } id) return id;
        return e.GetType().Name;
    }

    void TestMove(Point p, bool shift)
    {
        testMouse = p;
        if (TestTarget(p) == surface) MoveTo(p, shift);
    }

    void TestUp(Point p)
    {
        testMouse = p;
        var target = TestTarget(p);
        if (target == surface) state.EndOp();
        else Raise(target, Mouse.MouseUpEvent, MouseButton.Left);
    }

    void TestRight(Point p)
    {
        testMouse = p;
        if (TestTarget(p) == surface) state.Right();
    }

    /// <summary>Raises a real MouseDown / MouseUp (bubbling; each element on the way receives MouseLeftButtonDown / Up), the same as really clicking it</summary>
    static void Raise(UIElement target, RoutedEvent e, MouseButton button) =>
        target.RaiseEvent(new MouseButtonEventArgs(Mouse.PrimaryDevice, Environment.TickCount, button) { RoutedEvent = e });

    /// <summary>Keys follow the real order: the overlay gets them first (Press) and only if it lets them through do they go to the open input box; an Enter the input box does not take is a line break</summary>
    object TestKey(JsonElement a)
    {
        var key = Enum.Parse<Key>(a.GetProperty("key").GetString()!, ignoreCase: true);
        var mods = (Flag(a, "ctrl") ? ModifierKeys.Control : 0) | (Flag(a, "shift") ? ModifierKeys.Shift : 0) | (Flag(a, "alt") ? ModifierKeys.Alt : 0);
        var handled = state.Press(key, mods);
        if (!handled)
        {
            if (state.NoteOpen) handled = state.NoteKey(key, mods);
            else if (state.TextOpen) handled = state.TextKey(key);
        }
        if (!handled && key == Key.Enter && OpenInput() is { } input)
        {
            Insert(input, Environment.NewLine);
            return new { handled = true, by = "input" };
        }
        return new { handled, by = handled ? "overlay" : "none" };
    }

    TextBox? OpenInput() => state.NoteOpen ? noteInput : state.TextOpen ? textInput : null;

    static void Insert(TextBox box, string text)
    {
        var at = box.CaretIndex;
        box.Text = box.Text.Insert(at, text);
        box.CaretIndex = at + text.Length;
    }

    /// <summary>The center of a button (by AutomationId); an invisible button cannot be clicked</summary>
    Point CenterOf(string id)
    {
        root.UpdateLayout();
        var e = Find(root, id) ?? throw new ArgumentException($"No button: {id}");
        if (!e.IsVisible) throw new InvalidOperationException($"Button not visible: {id}");
        return e.TranslatePoint(new Point(e.ActualWidth / 2, e.ActualHeight / 2), root);
    }

    static FrameworkElement? Find(DependencyObject parent, string id)
    {
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(parent); i++)
        {
            var child = VisualTreeHelper.GetChild(parent, i);
            if (child is FrameworkElement f && AutomationProperties.GetAutomationId(f) == id) return f;
            if (Find(child, id) is { } found) return found;
        }
        return null;
    }

    // ---------- Reading state ----------

    /// <summary>What this layer looks like now (DIPs; anything not visible is null)</summary>
    internal object Describe()
    {
        root.UpdateLayout();
        return new
        {
            monitor = new { x = mon.Bounds.X, y = mon.Bounds.Y, width = mon.Bounds.Width, height = mon.Bounds.Height, scale },
            owner = session.Owner == this,
            active = IsActive,
            sel = Box(state.Sel),
            hover = Box(state.Hover),
            frame = Shown(frame),
            tool = state.Tool.ToString().ToLowerInvariant(),
            color = Hex(state.Prefs.Color),
            size = state.Tool is Tool.None or Tool.Note ? (double?)null : state.Prefs.CurrentSize(state.Tool),
            locked = state.Locked,
            op = state.Op.ToString().ToLowerInvariant(),
            captured = surface.IsMouseCaptured,
            cursor = CursorName(Cursor),
            handles = handles[0].Visibility == Visibility.Visible,
            sizeLabel = sizeLabel.Visibility == Visibility.Visible ? new { text = sizeText.Text, box = Shown(sizeLabel) } : null,
            // center = the color of the cell at the middle of the magnified view (the one the crosshair marks)
            magnifier = magnifier.Visibility == Visibility.Visible ? new { pos = magPos.Text, color = magColor.Text, center = CenterColor(), box = Shown(magnifier), hint = magHint is { Visibility: Visibility.Visible } ? magHint.Text : null } : null,
            marks = state.Marks.Select(DescribeMark).ToList(),
            // The index in marks of the mark picked by a click (the sub-toolbar's colors change it); -1 when none is picked
            picked = state.Picked is { } pk ? state.Marks.ToList().IndexOf(pk) : -1,
            drawing = state.Drawing is { } d ? DescribeMark(d) : null,
            overall = state.Overall,
            overallCategory = state.OverallCategory,
            note = state.NoteOpen
                ? new { title = noteTitle.Text, text = noteInput.Text, category = state.NoteCategory, overall = state.NoteFor is null, saveEnabled = noteSave.Opacity >= 1, placeholder = notePlaceholder.Visibility == Visibility.Visible, box = Shown(noteBox) }
                : null,
            text = state.TextOpen
                ? new { text = textInput.Text, size = textInput.FontSize, color = textInput.Foreground is SolidColorBrush b ? Hex(b.Color) : "", box = Shown(textBox) }
                : null,
            toolbar = Shown(toolbar),
            subbar = Shown(subbar),
            // Visible buttons: id, name (tooltip), and whether it is selected (for those on the toolbar)
            buttons = NamedElements(root).Where(e => e.IsVisible).Select(e => new { id = AutomationProperties.GetAutomationId(e), name = AutomationProperties.GetName(e), on = toolButtons.FirstOrDefault(t => t.button == e).on?.Invoke() }).ToList(),
            warn = warn is { Visibility: Visibility.Visible } w ? new { text = (w.Child as TextBlock)?.Text, box = Shown(w) } : null,
        };
    }

    static IEnumerable<FrameworkElement> NamedElements(DependencyObject parent)
    {
        for (var i = 0; i < VisualTreeHelper.GetChildrenCount(parent); i++)
        {
            var child = VisualTreeHelper.GetChild(parent, i);
            if (child is FrameworkElement f && AutomationProperties.GetAutomationId(f).Length > 0) yield return f;
            foreach (var found in NamedElements(child)) yield return found;
        }
    }

    object DescribeMark(Mark m) => new
    {
        kind = m.Kind.ToString().ToLowerInvariant(),
        color = Hex(m.Color),
        size = m.Size,
        points = m.Points.Select(p => new[] { p.X, p.Y }).ToList(),
        text = m.Text,
        note = m.Note,
        category = m.Category,
        // Places marked afterwards (ADR-0009): the number is the first place's, and lead is the first place's index in marks (-1 if this is not a later place)
        number = m.Head.Number,
        pending = m.Head.PendingNumber,
        lead = m.Lead is { } l ? state.Marks.ToList().IndexOf(l) : -1,
        badge = m.Head.Number > 0 || m.Head.PendingNumber > 0 ? new[] { MarkPainter.BadgeCenter(m, state.Keep).X, MarkPainter.BadgeCenter(m, state.Keep).Y } : null,
    };

    string CenterColor()
    {
        if (magImage.Source is not BitmapSource b) return "";
        var px = new byte[4];
        new FormatConvertedBitmap(b, PixelFormats.Bgra32, null, 0).CopyPixels(new Int32Rect(7, 5, 1, 1), px, 4, 0);
        return Hex(Color.FromRgb(px[2], px[1], px[0]));
    }

    /// <summary>
    /// The cursor actually shown when the mouse rests on this point: search outward from the topmost element at the point for the first one that sets its own cursor (an input box shows an I-beam);
    /// if none does, the window's (the one chosen by position on the canvas, see MoveTo)
    /// </summary>
    string CursorAtPoint(Point p)
    {
        root.UpdateLayout();
        for (var v = root.InputHitTest(p) as DependencyObject; v is not null && v != this; v = VisualTreeHelper.GetParent(v))
            if (v is FrameworkElement { Cursor: { } c }) return CursorName(c);
        return CursorName(Cursor);
    }

    static object? Box(Rect? r) => r is { } v ? new { x = v.X, y = v.Y, width = v.Width, height = v.Height } : null;

    /// <summary>Position and size within this layer; null when not shown</summary>
    object? Shown(FrameworkElement e)
    {
        if (e.Visibility != Visibility.Visible) return null;
        var at = e.TranslatePoint(new Point(0, 0), root);
        return new { x = at.X, y = at.Y, width = e.ActualWidth, height = e.ActualHeight };
    }

    /// <summary>The Pixelate circle is brush-&lt;brush width&gt; (ToolCursors caches, so the same size returns the same object); the other drawing tools are "tool"</summary>
    string CursorName(Cursor? c) =>
        c is null ? "none"
        : c == Cursors.Arrow ? "arrow"
        : c == Cursors.Hand ? "hand"
        : c == Cursors.SizeAll ? "sizeall"
        : c == Cursors.SizeNWSE ? "nwse"
        : c == Cursors.SizeNESW ? "nesw"
        : c == Cursors.SizeNS ? "ns"
        : c == Cursors.SizeWE ? "we"
        : c == Cursors.IBeam ? "ibeam"
        : ToolPrefs.Sizes(Tool.Mosaic).FirstOrDefault(s => c == ToolCursors.For(Tool.Mosaic, default, scale, s)) is > 0 and var brush ? $"brush-{brush}"
        : "tool";
}
#endif
