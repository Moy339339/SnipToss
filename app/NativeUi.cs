using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace SnipToss.App;

/// <summary>
/// The look shared by the shell's own native UI (the error window, the startup failure page, the Screen Capture finish notice).
/// Colors and corner radii come from the tokens in packages/web/src/styles.css, so it looks like the same app as the web UI. Text comes from messages (Locale).
/// When Windows has a contrast theme (high contrast) on, system colors are used throughout, same as the UI's forced-colors (styles.css): read each time against the current setting, at window open
/// </summary>
static class NativeUi
{
    static readonly Brush bg = Hex("#141416");          // --bg
    static readonly Brush surface2 = Hex("#232327");    // --surface-2
    static readonly Brush toastSurface = Hex("#3A3A40"); // gray of --border-strong (the base of the capture finish notice, opaque)
    static readonly Brush toastBorder = Hex("#4C4C52");  // one step lighter than the base: the outline is clear on both white and dark backgrounds
    static readonly Brush border = Hex("#3a3a40");      // --border-strong
    static readonly Brush text = Hex("#e8e8ea");        // --text
    static readonly Brush text2 = Hex("#a9a9b0");       // --text-2
    static readonly Brush accent = Hex("#5b8cff");      // --accent (clickable text, links)
    static readonly Brush accentFill = Hex("#386be0");  // --accent-fill
    static readonly Brush buttonBg = Hex("#2c2c31");    // --border (secondary button background)

    /// <summary>A contrast theme is on (Windows Settings → Accessibility → Contrast themes)</summary>
    public static bool HighContrast => SystemParameters.HighContrast;

    // The system-color brushes are frozen and can be used on the capture overlay's thread too
    public static Brush Bg => HighContrast ? SystemColors.WindowBrush : bg;
    public static Brush Surface2 => HighContrast ? SystemColors.WindowBrush : surface2;
    /// <summary>The Screen Capture finish notice: an opaque mid-dark gray block in the middle of the screen (not near-black, so it stands out on top of a dark UI); under a contrast theme it uses system colors</summary>
    public static Brush ToastSurface => HighContrast ? SystemColors.WindowBrush : toastSurface;
    public static Brush ToastBorder => HighContrast ? SystemColors.WindowTextBrush : toastBorder;
    public static Brush Border => HighContrast ? SystemColors.WindowTextBrush : border;
    public static Brush Text => HighContrast ? SystemColors.WindowTextBrush : text;
    public static Brush Text2 => HighContrast ? SystemColors.WindowTextBrush : text2;
    public static Brush Accent => HighContrast ? SystemColors.HotTrackBrush : accent;
    public static Brush AccentFill => HighContrast ? SystemColors.HighlightBrush : accentFill;
    public static Brush ButtonBg => HighContrast ? SystemColors.ControlBrush : buttonBg;

    /// <summary>UI font (UiFonts.Current)</summary>
    public static FontFamily UiFont => UiFonts.Current;
    public static readonly FontFamily MonoFont = new("Cascadia Mono, Consolas");

    /// <summary>
    /// Button look, same as the UI's .btn (corner radius --r-control 6, slightly darker on hover / press, a ring of --accent for keyboard focus).
    /// Uses a real Button (Enter, Tab and screen readers all work), only replacing WPF's default light-blue look
    /// </summary>
    static readonly ControlTemplate ButtonTemplate = (ControlTemplate)System.Windows.Markup.XamlReader.Parse("""
        <ControlTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
                         xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" TargetType="Button">
          <Border x:Name="b" Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}"
                  BorderThickness="1" CornerRadius="6" SnapsToDevicePixels="True">
            <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center" Margin="{TemplateBinding Padding}" />
          </Border>
          <ControlTemplate.Triggers>
            <Trigger Property="IsMouseOver" Value="True"><Setter TargetName="b" Property="Opacity" Value="0.88" /></Trigger>
            <Trigger Property="IsPressed" Value="True"><Setter TargetName="b" Property="Opacity" Value="0.76" /></Trigger>
            <Trigger Property="IsKeyboardFocused" Value="True"><Setter TargetName="b" Property="BorderBrush" Value="#5b8cff" /></Trigger>
          </ControlTemplate.Triggers>
        </ControlTemplate>
        """);

    /// <summary>Button under a contrast theme: no darkening (it can't be seen); hover and keyboard focus both thicken the border to 2</summary>
    static readonly ControlTemplate ButtonTemplateHighContrast = (ControlTemplate)System.Windows.Markup.XamlReader.Parse("""
        <ControlTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
                         xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" TargetType="Button">
          <Border x:Name="b" Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}"
                  BorderThickness="1" CornerRadius="6" SnapsToDevicePixels="True">
            <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center" Margin="{TemplateBinding Padding}" />
          </Border>
          <ControlTemplate.Triggers>
            <Trigger Property="IsMouseOver" Value="True"><Setter TargetName="b" Property="BorderThickness" Value="2" /></Trigger>
            <Trigger Property="IsKeyboardFocused" Value="True"><Setter TargetName="b" Property="BorderThickness" Value="2" /></Trigger>
          </ControlTemplate.Triggers>
        </ControlTemplate>
        """);
    public static Button MakeButton(string text, bool primary, Action<Button> onClick, Dock dock)
    {
        var b = new Button
        {
            Content = text,
            MinWidth = 88,
            Height = 32,
            Padding = new Thickness(12, 0, 12, 0),
            Margin = dock == Dock.Left ? new Thickness(0, 0, 8, 0) : new Thickness(8, 0, 0, 0),
            Foreground = HighContrast ? (primary ? SystemColors.HighlightTextBrush : SystemColors.ControlTextBrush) : primary ? Brushes.White : Text,
            Background = primary ? AccentFill : ButtonBg,
            BorderBrush = HighContrast ? SystemColors.ControlTextBrush : primary ? AccentFill : Border,
            IsDefault = primary,
            Template = HighContrast ? ButtonTemplateHighContrast : ButtonTemplate,
            FocusVisualStyle = null,
        };
        DockPanel.SetDock(b, dock);
        b.Click += (_, _) => onClick(b);
        return b;
    }

    /// <summary>"Copy diagnostic info" (error window, startup failure page): after the click the text on the button changes to whether the copy worked</summary>
    public static Button CopyDiagnosticsButton(Exception ex, Dock dock) =>
        MakeButton(Locale.T("menu.help.diagnostics"), false, b => b.Content = Locale.T(Crash.CopyDiagnostics(ex) ? "shell.button.copied" : "shell.button.copyFailed"), dock);

    /// <summary>The × at the top right (24 square, a --hover background appears on hover, same as the UI's .toast-close)</summary>
    public static Button CloseButton(Action onClick)
    {
        var icon = new System.Windows.Shapes.Path
        {
            Data = Geometry.Parse("M4.5,4.5 L11.5,11.5 M11.5,4.5 L4.5,11.5"),
            Stroke = Text2,
            StrokeThickness = 1.3,
            StrokeStartLineCap = PenLineCap.Round,
            StrokeEndLineCap = PenLineCap.Round,
            Width = 16,
            Height = 16,
        };
        var b = new Button
        {
            Content = icon,
            Width = 24,
            Height = 24,
            Background = Brushes.Transparent,
            BorderBrush = Brushes.Transparent,
            Template = HighContrast ? CloseTemplateHighContrast : CloseTemplate,
            FocusVisualStyle = null,
            IsCancel = true,
        };
        b.Click += (_, _) => onClick();
        return b;
    }

    static readonly ControlTemplate CloseTemplate = (ControlTemplate)System.Windows.Markup.XamlReader.Parse("""
        <ControlTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
                         xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" TargetType="Button">
          <Border x:Name="b" Background="Transparent" CornerRadius="4" SnapsToDevicePixels="True">
            <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center" />
          </Border>
          <ControlTemplate.Triggers>
            <Trigger Property="IsMouseOver" Value="True"><Setter TargetName="b" Property="Background" Value="#2a2a2f" /></Trigger>
            <Trigger Property="IsKeyboardFocused" Value="True"><Setter TargetName="b" Property="Background" Value="#2a2a2f" /></Trigger>
          </ControlTemplate.Triggers>
        </ControlTemplate>
        """);

    /// <summary>× under a contrast theme: hover and keyboard focus draw a border in the system text color (no background fill)</summary>
    static readonly ControlTemplate CloseTemplateHighContrast = (ControlTemplate)System.Windows.Markup.XamlReader.Parse("""
        <ControlTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
                         xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" TargetType="Button">
          <Border x:Name="b" Background="Transparent" BorderThickness="1" BorderBrush="Transparent" CornerRadius="4" SnapsToDevicePixels="True">
            <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center" />
          </Border>
          <ControlTemplate.Triggers>
            <Trigger Property="IsMouseOver" Value="True"><Setter TargetName="b" Property="BorderBrush" Value="{DynamicResource {x:Static SystemColors.WindowTextBrushKey}}" /></Trigger>
            <Trigger Property="IsKeyboardFocused" Value="True"><Setter TargetName="b" Property="BorderBrush" Value="{DynamicResource {x:Static SystemColors.WindowTextBrushKey}}" /></Trigger>
          </ControlTemplate.Triggers>
        </ControlTemplate>
        """);
    public static TextBlock Title(string text) => new()
    {
        Text = KeepWords.Of(text),
        FontSize = 16,
        FontWeight = FontWeights.SemiBold,
        Foreground = Text,
        TextWrapping = TextWrapping.Wrap,
        Margin = new Thickness(0, 0, 0, 8),
    };

    public static TextBlock Body(string text) => new()
    {
        Text = KeepWords.Of(text),
        TextWrapping = TextWrapping.Wrap,
        Foreground = Text2,
        LineHeight = 20,
        Margin = new Thickness(0, 0, 0, 12),
    };

    /// <summary>Error details that can be selected and copied</summary>
    public static TextBox Detail(string text) => new()
    {
        Text = text,
        IsReadOnly = true,
        TextWrapping = TextWrapping.Wrap,
        MaxHeight = 96,
        VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
        Background = Bg,
        Foreground = Text2,
        BorderBrush = Border,
        Padding = new Thickness(8, 6, 8, 6),
        FontFamily = MonoFont,
        FontSize = 12,
        Margin = new Thickness(0, 0, 0, 16),
    };

    static SolidColorBrush Hex(string hex)
    {
        var brush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));
        brush.Freeze();
        return brush;
    }
}

/// <summary>
/// A row of buttons (MakeButton's dock): Dock.Left ones go left to right, Dock.Right ones go right to left (like DockPanel: the first added is rightmost).
/// If everything fits it is one row; if not, the left and right groups take one row each (the right group still aligns right, so the primary button stays at the bottom right), and a group that still doesn't fit wraps within itself.
/// It used to be a DockPanel, and buttons that didn't fit were squeezed out: in the French and Russian error windows "Continue" and "Restart" were entirely invisible and unclickable
/// </summary>
sealed class ButtonRow : Panel
{
    const double RowGap = 8;

    /// <summary>Each row: the ones on the left, the ones on the right (the right ones in left-to-right order)</summary>
    List<(List<UIElement> Left, List<UIElement> Right)> Lines(double width)
    {
        var children = InternalChildren.Cast<UIElement>().Where(c => c.Visibility != Visibility.Collapsed).ToList();
        var left = children.Where(c => DockPanel.GetDock(c) != Dock.Right).ToList();
        var right = children.Where(c => DockPanel.GetDock(c) == Dock.Right).Reverse().ToList();
        if (SumWidth(left) + SumWidth(right) <= width) return [(left, right)];
        var lines = Wrap(left, width).Select(l => (l, new List<UIElement>())).ToList();
        lines.AddRange(Wrap(right, width).Select(r => (new List<UIElement>(), r)));
        return lines;
    }

    static double SumWidth(IEnumerable<UIElement> items) => items.Sum(c => c.DesiredSize.Width);

    static List<List<UIElement>> Wrap(List<UIElement> items, double width)
    {
        var rows = new List<List<UIElement>>();
        foreach (var c in items)
        {
            if (rows.Count == 0 || (rows[^1].Count > 0 && SumWidth(rows[^1]) + c.DesiredSize.Width > width)) rows.Add([]);
            rows[^1].Add(c);
        }
        return rows;
    }

    static double LineHeight(List<UIElement> left, List<UIElement> right) => left.Concat(right).Select(c => c.DesiredSize.Height).DefaultIfEmpty(0).Max();

    protected override Size MeasureOverride(Size available)
    {
        foreach (UIElement c in InternalChildren) c.Measure(new Size(double.PositiveInfinity, double.PositiveInfinity));
        var lines = Lines(available.Width);
        var width = lines.Max(l => SumWidth(l.Left) + SumWidth(l.Right));
        return new Size(double.IsInfinity(available.Width) ? width : Math.Min(width, available.Width), lines.Sum(l => LineHeight(l.Left, l.Right)) + RowGap * (lines.Count - 1));
    }

    protected override Size ArrangeOverride(Size final)
    {
        var y = 0.0;
        foreach (var (left, right) in Lines(final.Width))
        {
            var h = LineHeight(left, right);
            var x = 0.0;
            foreach (var c in left)
            {
                c.Arrange(new Rect(x, y, c.DesiredSize.Width, h));
                x += c.DesiredSize.Width;
            }
            x = Math.Max(x, final.Width - SumWidth(right));
            foreach (var c in right)
            {
                c.Arrange(new Rect(x, y, c.DesiredSize.Width, h));
                x += c.DesiredSize.Width;
            }
            y += h + RowGap;
        }
        return final;
    }
}

/// <summary>
/// Korean breaks at word boundaries (same as the web's word-break: keep-all): WPF, like browsers by default, can break between any two Hangul syllables, so "진단 정보를" breaks as "정보 / 를" and the particle lands at the start of a line.
/// Between adjacent characters inside a word (one side Hangul) a zero-width, invisible WORD JOINER is inserted, so lines break only at spaces and punctuation. Japanese katakana words get the same treatment (between two adjacent katakana); hiragana and kanji can still break as usual.
/// Used only on text the app wraps itself (titles, descriptions, hints); notes the user wrote and text for AI are left alone; buttons fit on one line so nothing is added there (button names read by screen readers and UI Automation stay as they are).
/// A class of its own: the capture overlay uses it on another thread too (same reason as UiFonts)
/// </summary>
static class KeepWords
{
    const char WordJoiner = (char)0x2060;

    static bool Hangul(char c) => c is >= (char)0xAC00 and <= (char)0xD7A3 or >= (char)0x1100 and <= (char)0x11FF or >= (char)0x3130 and <= (char)0x318F;

    /// <summary>Katakana (including the long-vowel mark ー and half-width katakana): in Japanese a katakana word isn't broken in the middle either ("クリップボー / ド")</summary>
    static bool Katakana(char c) => c is >= (char)0x30A0 and <= (char)0x30FF or >= (char)0xFF65 and <= (char)0xFF9F;

    public static string Of(string text)
    {
        if (!text.Any(c => Hangul(c) || Katakana(c))) return text;
        var sb = new System.Text.StringBuilder(text.Length * 2);
        for (var i = 0; i < text.Length; i++)
        {
            sb.Append(text[i]);
            if (i + 1 >= text.Length) continue;
            char a = text[i], b = text[i + 1];
            if ((char.IsLetterOrDigit(a) && char.IsLetterOrDigit(b) && (Hangul(a) || Hangul(b))) || (Katakana(a) && Katakana(b))) sb.Append(WordJoiner);
        }
        return sb.ToString();
    }
}

/// <summary>
/// Fonts for the shell's native UI: Latin text in Segoe UI Variable, CJK following the UI language (Locale.CjkFont, same as --font-cjk in styles.css, ADR-0001 item 11).
/// Resolved against the current language every time: fetched when the capture overlay or error window opens, so after a language change the next opening is right.
/// A class of its own: NativeUi's static fields hold WPF templates (which belong to the thread that created them), and fetching a font on the capture overlay's other thread shouldn't create them as a side effect
/// </summary>
static class UiFonts
{
    static readonly System.Collections.Concurrent.ConcurrentDictionary<string, FontFamily> Fonts = new();

    public static FontFamily Current => Fonts.GetOrAdd(Locale.Current, lang => new FontFamily($"Segoe UI Variable Text, Segoe UI, {Locale.CjkFont(lang)}"));
}
