using System.Runtime.InteropServices;
using System.Windows;

namespace SnipToss.App;

/// <summary>
/// Puts data on the clipboard (shared by Screen Capture's finish step and the main app's Copy as Images). When another program (remote desktop, a clipboard tool) holds the clipboard,
/// .NET itself retries 10 times with 100 ms waits (ClipboardCore in dotnet/winforms, shared with WPF), so only one more try is made here.
/// An extra outer loop of 11 retries used to freeze the UI thread for ten-odd seconds before reporting an error when the clipboard stayed busy
/// </summary>
static class ClipboardWriter
{
    /// <summary>Throws COMException (CLIPBRD_E_CANT_OPEN) when it can't be set; the caller turns that into a plain-language message</summary>
    public static void Put(DataObject data)
    {
        try
        {
            Set(data);
        }
        catch (COMException)
        {
            Thread.Sleep(100);
            Set(data);
        }
    }

    static void Set(DataObject data)
    {
#if TEST_HOOKS
        if (CaptureFakes.Clipboard is { } fake)
        {
            fake(data); // shell tests: record it, leave the system clipboard alone
            return;
        }
#endif
        Clipboard.SetDataObject(data, true); // copy = true: the data stays after the app exits
    }
}
