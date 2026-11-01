using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;

namespace SnipToss.App.Capture;

/// <summary>
/// The color picker of the capture overlay (opened by the hue disc at the end of the color row): a saturation / brightness field, a hue strip, the color as hex digits, and Apply.
/// Laid out like the main window's picker (packages/web/src/ColorPicker.tsx). Enter / Apply uses the color (on the picked mark, otherwise for what is drawn next) and adds it to the recent colors;
/// Esc or a click elsewhere closes it without changing anything
/// </summary>
sealed partial class CaptureOverlay
{
    const double FieldWidth = 208, FieldHeight = 128, StripHeight = 12;

    readonly Border picker;
    readonly SolidColorBrush pickerHueFill = new(Colors.Red);
    readonly Canvas pickerThumbs = new() { Width = FieldWidth, Height = FieldHeight, IsHitTestVisible = false };
    readonly Canvas hueThumbs = new() { Width = FieldWidth, Height = StripHeight, IsHitTestVisible = false };
    (Grid Box, Ellipse Fill) fieldThumb, hueThumb;
    Border pickerPreview = null!;
    TextBox pickerHex = null!;
    Grid pickerField = null!;
    Border pickerStrip = null!;

    /// <summary>The color being picked: hue / saturation / value drive the field and strip, and the exact color is kept apart so typed digits are not rounded through HSV</summary>
    double pickH, pickS, pickV;
    Color pickColor;
    /// <summary>The digits box is being rewritten by code (not typed): its TextChanged must not feed back</summary>
    bool pickerWriting;

    bool PickerOpen => picker.Visibility == Visibility.Visible;

    Border BuildPicker()
    {
        // The field: the hue, white from the left, black from the bottom; clipped to rounded corners, the thumb sits on top unclipped so it shows whole at the edges
        pickerField = new Grid { Width = FieldWidth, Height = FieldHeight, Clip = new RectangleGeometry(new Rect(0, 0, FieldWidth, FieldHeight), 6, 6), Background = Brushes.Transparent };
        pickerField.Children.Add(new Rectangle { Fill = pickerHueFill });
        pickerField.Children.Add(new Rectangle { Fill = new LinearGradientBrush(Colors.White, Color.FromArgb(0, 0xff, 0xff, 0xff), 0) });
        pickerField.Children.Add(new Rectangle { Fill = new LinearGradientBrush(Color.FromArgb(0, 0, 0, 0), Colors.Black, 90) });
        Named(pickerField, "picker-field", Locale.T("markColor.field"));
        fieldThumb = Thumb();
        pickerThumbs.Children.Add(fieldThumb.Box);
        var fieldWrap = new Grid { Width = FieldWidth, Height = FieldHeight, Cursor = Cursors.Cross };
        fieldWrap.Children.Add(pickerField);
        fieldWrap.Children.Add(pickerThumbs);
        DragOn(pickerField, p =>
        {
            pickS = Math.Clamp(p.X / FieldWidth, 0, 1);
            pickV = 1 - Math.Clamp(p.Y / FieldHeight, 0, 1);
            pickColor = ColorMath.FromHsv(pickH, pickS, pickV);
            ShowPicked(writeDigits: true);
        });

        var hues = new GradientStopCollection();
        for (var i = 0; i <= 6; i++) hues.Add(new GradientStop(ColorMath.FromHsv(i * 60, 1, 1), i / 6.0));
        pickerStrip = Named(new Border { Width = FieldWidth, Height = StripHeight, CornerRadius = new CornerRadius(StripHeight / 2), Background = new LinearGradientBrush(hues, 0) }, "picker-hue", Locale.T("markColor.hue"));
        hueThumb = Thumb();
        hueThumbs.Children.Add(hueThumb.Box);
        var stripWrap = new Grid { Width = FieldWidth, Height = StripHeight, Margin = new Thickness(0, 10, 0, 0), Cursor = Cursors.Hand };
        stripWrap.Children.Add(pickerStrip);
        stripWrap.Children.Add(hueThumbs);
        DragOn(pickerStrip, p =>
        {
            pickH = Math.Clamp(p.X / FieldWidth, 0, 1) * 359.9;
            pickColor = ColorMath.FromHsv(pickH, pickS, pickV);
            ShowPicked(writeDigits: true);
        });

        // The bottom row: a preview of the color, its digits (typed or pasted, with or without #), Apply
        pickerPreview = new Border { Width = 28, Height = 28, CornerRadius = new CornerRadius(6), BorderBrush = Solid(Color.FromArgb(0x26, 0xff, 0xff, 0xff)), BorderThickness = new Thickness(1) };
        pickerHex = new TextBox
        {
            MaxLength = 7,
            Background = Brushes.Transparent,
            BorderThickness = new Thickness(0),
            Padding = new Thickness(0),
            Foreground = Solid(Text),
            CaretBrush = Solid(Text),
            SelectionBrush = Solid(Accent),
            FontFamily = new FontFamily("Consolas"),
            FontSize = 13,
            VerticalAlignment = VerticalAlignment.Center,
            CharacterCasing = CharacterCasing.Upper,
        };
        Named(pickerHex, "picker-hex", Locale.T("markColor.hex"));
        pickerHex.TextChanged += (_, _) =>
        {
            if (pickerWriting || ColorMath.Parse(pickerHex.Text) is not { } typed) return;
            pickColor = typed;
            var (h, s, v) = ColorMath.ToHsv(typed);
            // Gray and black have no hue of their own: keep the strip where it was instead of jumping to red
            if (s > 0 && v > 0) pickH = h;
            (pickS, pickV) = (s, v);
            ShowPicked(writeDigits: false);
        };
        var digits = new Grid();
        digits.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        digits.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        var hash = Txt("#", 13, Muted);
        hash.Margin = new Thickness(0, 0, 4, 0);
        Grid.SetColumn(pickerHex, 1);
        digits.Children.Add(hash);
        digits.Children.Add(pickerHex);
        var digitsBox = new Border { Height = 28, Padding = new Thickness(8, 0, 8, 0), Margin = new Thickness(8, 0, 8, 0), CornerRadius = new CornerRadius(6), Background = Solid(Bg), BorderBrush = Solid(BorderStrong), BorderThickness = new Thickness(1), Child = digits, Cursor = Cursors.IBeam };
        var apply = FootButton(Locale.T("markColor.apply"), primary: true, ApplyPicker);
        AutomationIdOf(apply, "picker-apply");
        var row = new Grid { Margin = new Thickness(0, 12, 0, 0) };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        Grid.SetColumn(digitsBox, 1);
        Grid.SetColumn(apply, 2);
        row.Children.Add(pickerPreview);
        row.Children.Add(digitsBox);
        row.Children.Add(apply);

        var stack = new StackPanel { Width = FieldWidth };
        stack.Children.Add(fieldWrap);
        stack.Children.Add(stripWrap);
        stack.Children.Add(row);
        var box = Panel(stack, padding: 12);
        Named(box, "picker", Locale.T("markColor.custom"));
        // Presses inside the picker stay in it (they must not reach the canvas or close it)
        box.MouseLeftButtonDown += (_, e) => e.Handled = true;
        box.MouseLeftButtonUp += (_, e) => e.Handled = true;
        return box;
    }

    static void AutomationIdOf(UIElement e, string id) => System.Windows.Automation.AutomationProperties.SetAutomationId(e, id);

    /// <summary>A round thumb: white ring with a faint dark edge (visible on light and dark colors), filled with the color under it</summary>
    static (Grid, Ellipse) Thumb()
    {
        var fill = new Ellipse { Width = 14, Height = 14, Stroke = Brushes.White, StrokeThickness = 2 };
        var box = new Grid { Width = 16, Height = 16 };
        box.Children.Add(new Ellipse { Width = 16, Height = 16, Stroke = Solid(Color.FromArgb(0x66, 0, 0, 0)), StrokeThickness = 1 });
        box.Children.Add(fill);
        return (box, fill);
    }

    /// <summary>Press and drag on an area: set receives the position inside it (DIPs from its top-left corner) on the press and on every move while held</summary>
    void DragOn(FrameworkElement area, Action<Point> set)
    {
        Point Inside(MouseEventArgs e) => MouseAt(e) - (Vector)area.TranslatePoint(new Point(0, 0), root);
        area.MouseLeftButtonDown += (_, e) =>
        {
            e.Handled = true;
            area.CaptureMouse();
            set(Inside(e));
        };
        area.MouseMove += (_, e) =>
        {
            if (area.IsMouseCaptured) set(Inside(e));
        };
        area.MouseLeftButtonUp += (_, e) =>
        {
            e.Handled = true;
            area.ReleaseMouseCapture();
        };
    }

    /// <summary>The picked color changed: move the thumbs, recolor the field and the preview; writeDigits = also show its digits (not while they are being typed)</summary>
    void ShowPicked(bool writeDigits)
    {
        pickerHueFill.Color = ColorMath.FromHsv(pickH, 1, 1);
        fieldThumb.Fill.Fill = Solid(pickColor);
        hueThumb.Fill.Fill = Solid(ColorMath.FromHsv(pickH, 1, 1));
        Canvas.SetLeft(fieldThumb.Box, pickS * FieldWidth - 8);
        Canvas.SetTop(fieldThumb.Box, (1 - pickV) * FieldHeight - 8);
        Canvas.SetLeft(hueThumb.Box, pickH / 360 * FieldWidth - 8);
        Canvas.SetTop(hueThumb.Box, StripHeight / 2 - 8);
        pickerPreview.Background = Solid(pickColor);
        if (!writeDigits) return;
        pickerWriting = true;
        // Uppercase like typed digits (CharacterCasing only applies to typing) and like the main window's picker
        pickerHex.Text = ColorMath.Hex(pickColor)[1..].ToUpperInvariant();
        pickerWriting = false;
    }

    /// <summary>Opens the picker on the color in use; the keyboard goes to its digits (all selected, so typing replaces them)</summary>
    void OpenPicker(Color start)
    {
        pickColor = start;
        (pickH, pickS, pickV) = ColorMath.ToHsv(start);
        ShowPicked(writeDigits: true);
        picker.Visibility = Visibility.Visible;
        PlaceToolbar(); // the hue disc shows it is open, and the picker is placed next to the color row
        Activate();
        pickerHex.Focus();
        pickerHex.SelectAll();
    }

    /// <summary>Closes the picker without using the color; the keyboard goes back to where it was (the note box being written, the text box, or the overlay)</summary>
    void ClosePicker()
    {
        if (!PickerOpen) return;
        picker.Visibility = Visibility.Collapsed;
        PlaceToolbar();
        if (state.NoteOpen) noteInput.Focus();
        else if (state.TextOpen) textInput.Focus();
        else Focus();
    }

    /// <summary>Uses the picked color like a click on a swatch, and remembers it among the recent colors (shared with the main window)</summary>
    void ApplyPicker()
    {
        if (!PickerOpen) return;
        var c = ColorMath.Parse(pickerHex.Text) ?? pickColor;
        picker.Visibility = Visibility.Collapsed;
        if (!ToolPrefs.Colors.Contains(c)) session.AddRecentColor(c);
        state.SetColor(c);
        if (state.NoteOpen) noteInput.Focus();
        else if (state.TextOpen) textInput.Focus();
        else Focus();
    }

    /// <summary>A key while the picker is open: Enter applies, Esc closes; true = handled. Anything else goes to the digits box</summary>
    bool PickerKey(Key key)
    {
        if (key == Key.Escape) ClosePicker();
        else if (key == Key.Enter) ApplyPicker();
        else return false;
        return true;
    }

    /// <summary>Above the toolbar and color row, right-aligned with the color row; below them when there is no room above</summary>
    void PlacePicker()
    {
        var inf = new Size(double.PositiveInfinity, double.PositiveInfinity);
        picker.Measure(inf);
        var size = picker.DesiredSize;
        double barTop = Canvas.GetTop(toolbar), subTop = Canvas.GetTop(subbar);
        var top = Math.Min(barTop, subTop);
        var bottom = Math.Max(barTop + toolbar.DesiredSize.Height, subTop + subbar.DesiredSize.Height);
        var right = Canvas.GetLeft(subbar) + subbar.DesiredSize.Width;
        var x = Math.Clamp(right - size.Width, full.Left + 4, Math.Max(full.Left + 4, full.Right - 4 - size.Width));
        var y = top - 8 - size.Height >= full.Top + 4 ? top - 8 - size.Height : Math.Min(bottom + 8, Math.Max(full.Top + 4, full.Bottom - 4 - size.Height));
        Canvas.SetLeft(picker, x);
        Canvas.SetTop(picker, y);
    }
}
