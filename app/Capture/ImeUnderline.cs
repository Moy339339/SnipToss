using System.Collections;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Documents;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;

namespace SnipToss.App.Capture;

/// <summary>
/// The dotted underline under text an input method is still composing (not yet committed), for the capture overlay's text boxes.
///
/// WPF draws this itself (CompositionAdorner), and its walk over the lines of the composition never ends when the composition holds a hard
/// line break: AddMultipleCompositionLines asks for the line range of the line's content end, which lies before the line break and so in the
/// same line, and it loops on that line forever (the UI thread spins and the overlay freezes with the note unsaved). Dictation in an input
/// method can put paragraph breaks into a long composition. It is also slow on every update: two full line layouts per line for each clause
/// the input method marks. So WPF's underline is turned off for the whole process (<see cref="DisableWpfUnderline"/>) and this adorner
/// draws one underline per line, from the composition the text box reports in its text input events.
/// </summary>
sealed class ImeUnderline : Adorner
{
    readonly TextBox box;
    /// <summary>The composition in the box's text (character offset and length); length 0 = none</summary>
    int start, length;
    /// <summary>The underline of each line, in the box's coordinates (worked out once per change, not in every render)</summary>
    List<(Point From, Point To)> lines = [];
    bool refreshQueued;

    ImeUnderline(TextBox box) : base(box)
    {
        this.box = box;
        IsHitTestVisible = false;
        // Raised after the input method's edit, with the composition's current place; also for events the text box marks handled
        box.AddHandler(TextCompositionManager.TextInputStartEvent, new TextCompositionEventHandler(OnComposition), true);
        box.AddHandler(TextCompositionManager.TextInputUpdateEvent, new TextCompositionEventHandler(OnComposition), true);
        box.AddHandler(TextCompositionManager.TextInputEvent, new TextCompositionEventHandler((_, _) => Clear()), true);
        box.AddHandler(ScrollViewer.ScrollChangedEvent, new ScrollChangedEventHandler((_, _) => QueueRefresh()), true);
        box.LostKeyboardFocus += (_, _) => Clear();
        box.SizeChanged += (_, _) => QueueRefresh();
        box.TextChanged += (_, _) => QueueRefresh();
    }

    /// <summary>Draws the composition underline on this text box (once its adorner layer exists)</summary>
    public static void Attach(TextBox box)
    {
        void Add()
        {
            if (AdornerLayer.GetAdornerLayer(box) is { } layer) layer.Add(new ImeUnderline(box));
        }
        if (box.IsLoaded) Add();
        else box.Loaded += (_, _) => Add();
    }

    void OnComposition(object sender, TextCompositionEventArgs e)
    {
        if (e.TextComposition is not FrameworkTextComposition c) return;
        start = c.CompositionOffset;
        length = c.CompositionLength;
        QueueRefresh();
    }

    void Clear()
    {
        length = 0;
        QueueRefresh();
    }

    /// <summary>Several updates in a row (dictation sends many) are worked out once, after layout</summary>
    void QueueRefresh()
    {
        if (refreshQueued) return;
        refreshQueued = true;
        Dispatcher.BeginInvoke(DispatcherPriority.Loaded, () =>
        {
            refreshQueued = false;
            lines = length > 0 && box.IsKeyboardFocusWithin ? Lines(box, start, length) : [];
            InvalidateVisual();
        });
    }

    /// <summary>
    /// The underline of each line the range covers, line by line: one layout query per end of each line, and line breaks are left out
    /// (the walk cannot get stuck on a line: it goes by line index, not by asking which line a position is in)
    /// </summary>
    internal static List<(Point From, Point To)> Lines(TextBox box, int start, int length)
    {
        var result = new List<(Point, Point)>();
        var text = box.Text;
        int s = Math.Clamp(start, 0, text.Length), e = Math.Clamp(start + length, s, text.Length);
        if (e <= s) return result;
        int first = box.GetLineIndexFromCharacterIndex(s), last = box.GetLineIndexFromCharacterIndex(e - 1);
        if (first < 0 || last < first) return result;
        for (var line = first; line <= last; line++)
        {
            var lineStart = box.GetCharacterIndexFromLineIndex(line);
            if (lineStart < 0) break;
            int a = Math.Max(s, lineStart), b = Math.Min(e, lineStart + box.GetLineLength(line));
            while (b > a && IsLineBreak(text[b - 1])) b--;
            if (b <= a) continue;
            var from = box.GetRectFromCharacterIndex(a);
            var to = box.GetRectFromCharacterIndex(b - 1, trailingEdge: true);
            if (from.IsEmpty || to.IsEmpty) continue;
            result.Add((new Point(from.Left, from.Bottom), new Point(to.Right, from.Bottom)));
        }
        return result;
    }

    /// <summary>The characters WPF ends a line with: CR, LF, NEL, line and paragraph separators</summary>
    static bool IsLineBreak(char c) => c is (char)0x0D or (char)0x0A or (char)0x85 or (char)0x2028 or (char)0x2029;

    protected override void OnRender(DrawingContext dc)
    {
        if (lines.Count == 0) return;
        // Only inside the box's text area: lines scrolled out of a tall note are not drawn over the box's border or the buttons below it
        var p = box.Padding;
        var b = box.BorderThickness;
        dc.PushClip(new RectangleGeometry(new Rect(
            b.Left + p.Left - 1,
            b.Top,
            Math.Max(0, box.ActualWidth - b.Left - b.Right - p.Left - p.Right + 2),
            Math.Max(0, box.ActualHeight - b.Top - b.Bottom))));
        var pen = new Pen(box.Foreground, 1) { DashStyle = new DashStyle([1, 2], 0) };
        pen.Freeze();
        foreach (var (from, to) in lines)
        {
            // 1 below the text's bottom, on the pixel grid (a line on a half pixel smears into two gray rows)
            var y = Math.Round(from.Y) - 0.5;
            dc.DrawLine(pen, new Point(from.X, y), new Point(to.X, y));
        }
        dc.Pop();
    }

    /// <summary>
    /// Turns WPF's own composition underline off for the whole process: WPF looks up how to draw each input method attribute in a cache
    /// (TextServicesDisplayAttributePropertyRanges._attributes) and draws nothing for an empty attribute. The cache is replaced by one that
    /// answers every lookup with an empty attribute. Reaches into WPF internals: if a later WPF renames them, it logs and leaves WPF as is
    /// (the test DisablesWpfCompositionUnderline then fails, so it is noticed when .NET is upgraded)
    /// </summary>
    public static bool DisableWpfUnderline()
    {
        try
        {
            var framework = typeof(TextBox).Assembly;
            var ranges = framework.GetType("System.Windows.Documents.TextServicesDisplayAttributePropertyRanges", throwOnError: false);
            var attribute = framework.GetType("System.Windows.Documents.TextServicesDisplayAttribute", throwOnError: false);
            var cache = ranges?.GetField("_attributes", BindingFlags.NonPublic | BindingFlags.Static);
            var isEmpty = attribute?.GetMethod("IsEmptyAttribute", BindingFlags.NonPublic | BindingFlags.Instance);
            if (attribute is null || cache is null || cache.FieldType != typeof(Hashtable) || isEmpty is null)
            {
                Log.Warn("Could not turn off WPF's IME composition underline: its internals have changed");
                return false;
            }
            // All fields zero: no text color, no background, no line color, no line style
            var empty = RuntimeHelpers.GetUninitializedObject(attribute);
            if (isEmpty.Invoke(empty, null) is not true)
            {
                Log.Warn("Could not turn off WPF's IME composition underline: an empty attribute does not read as empty");
                return false;
            }
            cache.SetValue(null, new EmptyAttributes(empty));
            return true;
        }
        catch (Exception ex) when (ex is MemberAccessException or TargetException or ArgumentException or InvalidOperationException or NotSupportedException)
        {
            Log.Warn("Could not turn off WPF's IME composition underline", ex);
            return false;
        }
    }

    /// <summary>The attribute cache that knows only "nothing to draw"</summary>
    sealed class EmptyAttributes(object empty) : Hashtable
    {
        public override object? this[object key]
        {
            get => empty;
            set { }
        }
    }
}
