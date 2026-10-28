# Paste probe: puts different combinations on the clipboard so you can Ctrl+V into various programs and see whether an image or text arrives.
#   pwsh -File scripts/clipboard-probe.ps1              press a number key to switch combinations; pressing Q to quit restores your original clipboard text / image
#   pwsh -File scripts/clipboard-probe.ps1 -Combo 2     put just one combination and exit (no restore)
param([ValidateRange(1, 7)][int]$Combo)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName PresentationCore, PresentationFramework, WindowsBase

if ([Threading.Thread]::CurrentThread.ApartmentState -ne 'STA') {
    Write-Host 'The clipboard needs an STA thread: run pwsh -STA -File scripts/clipboard-probe.ps1' -ForegroundColor Red
    exit 1
}

$dir = Join-Path $env:TEMP 'sniptoss-probe'
New-Item -ItemType Directory -Force $dir | Out-Null

# ---------- First save the current clipboard ----------
$savedText = $null; $savedImage = $null
try {
    if ([Windows.Clipboard]::ContainsImage()) { $savedImage = [Windows.Clipboard]::GetImage() }
    if ([Windows.Clipboard]::ContainsText()) { $savedText = [Windows.Clipboard]::GetText() }
} catch { }

# ---------- Draw a test image: one that makes it obvious an image arrived ----------
function New-ProbeImage {
    $w = 900; $h = 520
    $visual = New-Object Windows.Media.DrawingVisual
    $dc = $visual.RenderOpen()
    $dc.DrawRectangle([Windows.Media.Brushes]::White, $null, (New-Object Windows.Rect 0, 0, $w, $h))
    $dc.DrawRectangle((New-Object Windows.Media.SolidColorBrush ([Windows.Media.Color]::FromRgb(0x2b, 0x2f, 0x36))), $null, (New-Object Windows.Rect 0, 0, $w, 330))
    $pen = New-Object Windows.Media.Pen ((New-Object Windows.Media.SolidColorBrush ([Windows.Media.Color]::FromRgb(0xff, 0x5a, 0x4f)))), 4
    $dc.DrawRectangle($null, $pen, (New-Object Windows.Rect 120, 90, 380, 150))
    $dc.DrawEllipse((New-Object Windows.Media.SolidColorBrush ([Windows.Media.Color]::FromRgb(0xff, 0x5a, 0x4f))), $null, (New-Object Windows.Point 120, 90), 18, 18)
    $face = New-Object Windows.Media.Typeface 'Microsoft YaHei UI'
    $dpi = 1.0
    $draw = {
        param($text, $size, $x, $y, $brush)
        $ft = New-Object Windows.Media.FormattedText ($text, [Globalization.CultureInfo]::InvariantCulture, [Windows.FlowDirection]::LeftToRight, $face, $size, $brush, $dpi)
        $dc.DrawText($ft, (New-Object Windows.Point $x, $y))
    }
    & $draw '1' 20 113 76 ([Windows.Media.Brushes]::White)
    & $draw '【这是图片】超级批注 · 粘贴实测' 30 150 140 ([Windows.Media.Brushes]::White)
    & $draw '1. 修改 · 框选处：标题字太细了，换成粗一点的黑体' 22 40 360 ([Windows.Media.Brushes]::Black)
    & $draw '（图下方附批注说明：粘进去看到这张图 = 程序收的是图）' 18 40 410 ([Windows.Media.Brushes]::Gray)
    $dc.Close()
    $bmp = New-Object Windows.Media.Imaging.RenderTargetBitmap $w, $h, 96, 96, ([Windows.Media.PixelFormats]::Pbgra32)
    $bmp.Render($visual)
    $bmp.Freeze()
    return $bmp
}

$image = New-ProbeImage
$enc = New-Object Windows.Media.Imaging.PngBitmapEncoder
$enc.Frames.Add([Windows.Media.Imaging.BitmapFrame]::Create($image))
$pngPath = Join-Path $dir '超级批注-粘贴实测.png'
$fs = [IO.File]::Create($pngPath); $enc.Save($fs); $fs.Close()
$pngBytes = [IO.File]::ReadAllBytes($pngPath)

function Text($n) { "【这是文字】超级批注粘贴实测（组合 $n）。粘进去看到这句话 = 程序收的是文字。`n1. 修改 · 框选处：标题字太细了，换成粗一点的黑体" }

# CF_HTML: needs a header that states the byte offsets (a Windows requirement)
function HtmlFormat($fragment) {
    $header = "Version:0.9`r`nStartHTML:{0:D10}`r`nEndHTML:{1:D10}`r`nStartFragment:{2:D10}`r`nEndFragment:{3:D10}`r`n"
    $pre = "<html><body><!--StartFragment-->"; $post = "<!--EndFragment--></body></html>"
    $utf8 = [Text.Encoding]::UTF8
    $headLen = $utf8.GetByteCount(($header -f 0, 0, 0, 0))
    $startFrag = $headLen + $utf8.GetByteCount($pre)
    $endFrag = $startFrag + $utf8.GetByteCount($fragment)
    $endHtml = $endFrag + $utf8.GetByteCount($post)
    return ($header -f $headLen, $endHtml, $startFrag, $endFrag) + $pre + $fragment + $post
}

function Put([int]$n) {
    $data = New-Object Windows.DataObject
    $addImage = {
        $data.SetImage((New-Object Windows.Media.Imaging.FormatConvertedBitmap ($image, [Windows.Media.PixelFormats]::Bgr32, $null, 0)))
        $data.SetData('PNG', (New-Object IO.MemoryStream (, $pngBytes)), $false)
    }
    switch ($n) {
        1 { & $addImage; $what = 'image only (what Copy as Images is meant to use)' }
        2 { & $addImage; $data.SetText((Text 2), [Windows.TextDataFormat]::UnicodeText); $what = 'image + text (what Screen Capture puts there now)' }
        3 {
            & $addImage; $data.SetText((Text 3), [Windows.TextDataFormat]::UnicodeText)
            $b64 = [Convert]::ToBase64String($pngBytes)
            $html = "<p>【这是 HTML 里的文字】超级批注粘贴实测（组合 3）</p><img src=`"data:image/png;base64,$b64`">"
            $data.SetData([Windows.DataFormats]::Html, (HtmlFormat $html))
            $what = 'image + text + web format (HTML with the image embedded)'
        }
        4 {
            $files = New-Object Collections.Specialized.StringCollection; [void]$files.Add($pngPath)
            $data.SetFileDropList($files); $what = 'image file (as if a PNG was copied in File Explorer)'
        }
        5 { $data.SetText((Text 5), [Windows.TextDataFormat]::UnicodeText); $what = 'text only (what Copy as Text in the main app does now)' }
        6 {
            $files = New-Object Collections.Specialized.StringCollection; [void]$files.Add($pngPath)
            $data.SetFileDropList($files); $data.SetText((Text 6), [Windows.TextDataFormat]::UnicodeText)
            $what = 'image file + text'
        }
        7 {
            $second = Join-Path $dir '超级批注-粘贴实测-2.png'
            Copy-Item $pngPath $second -Force
            $files = New-Object Collections.Specialized.StringCollection; [void]$files.Add($pngPath); [void]$files.Add($second)
            $data.SetFileDropList($files); $what = 'two image files (handing over several images at once)'
        }
    }
    for ($i = 0; ; $i++) {
        try { [Windows.Clipboard]::SetDataObject($data, $true); break }
        catch { if ($i -ge 10) { throw }; Start-Sleep -Milliseconds 50 }
    }
    Write-Host "On the clipboard: combination $n - $what" -ForegroundColor Green
    Write-Host 'In the program you are testing press Ctrl+V (for web-based AI, paste only, do not send) and see whether an image, text or both arrive.' -ForegroundColor DarkGray
}

if ($Combo) { Put $Combo; exit 0 }

Write-Host ''
Write-Host 'SnipToss paste probe' -ForegroundColor Cyan
Write-Host 'Paste each combination once into each of these programs and note whether an image, text, both, or nothing arrives:'
Write-Host '  web-based AI (a few common ones), chat apps, Word, a terminal-based coding agent, desktop coding-agent apps'
Write-Host ''
Write-Host '  1  image only'
Write-Host '  2  image + text'
Write-Host '  3  image + text + web format (HTML)'
Write-Host '  4  image file'
Write-Host '  5  text only'
Write-Host '  6  image file + text'
Write-Host '  7  two image files'
Write-Host '  Q  quit (restores your original clipboard)'
Write-Host ''
while ($true) {
    $key = [Console]::ReadKey($true).KeyChar
    if ($key -in 'q', 'Q') { break }
    if ("$key" -match '^[1-7]$') { Put ([int]"$key") }
}

# ---------- Restore the original clipboard ----------
$restore = New-Object Windows.DataObject
if ($savedImage) { $restore.SetImage($savedImage) }
if ($savedText) { $restore.SetText($savedText) }
if ($savedImage -or $savedText) {
    [Windows.Clipboard]::SetDataObject($restore, $true)
    Write-Host 'Your original clipboard has been restored.' -ForegroundColor Green
} else {
    [Windows.Clipboard]::Clear()
    Write-Host 'The original clipboard was empty (or in another format that cannot be restored); it has been cleared.' -ForegroundColor Yellow
}
