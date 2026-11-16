using System.Diagnostics;
using System.Runtime.InteropServices;
using static SnipToss.App.Native;

namespace SnipToss.App.Capture;

/// <summary>
/// Grabs a display through DXGI Desktop Duplication: the picture is a frame the desktop compositor has finished.
/// The GDI grab (BitBlt on the screen DC) reads the composed screen back while the GPU may be writing the next frame: now and then it returns two frames mixed
/// (a diagonal front of small tiles, one side the old frame and the other the new one), or black where a browser presents through the GPU. Duplication only hands over completed frames.
/// A duplication is opened for one grab and closed right after (while one is open, the compositor stops using hardware overlays on that display).
/// <para>
/// The Direct3D device it needs is made ahead of time by <see cref="Prepare"/> and kept: the first one in a process loads the graphics driver (about 150 ms and 50 MB),
/// too slow for the press of the shortcut. Until it is ready, and whenever duplication cannot give a frame, <see cref="TryGrab"/> returns null and the caller grabs with GDI:
/// a display no GPU output drives, a desktop that is not 8-bit BGRA (HDR), the secure desktop, remote sessions, no new frame within the wait
/// </para>
/// </summary>
static class DesktopDuplication
{
    const int DXGI_ERROR_NOT_FOUND = unchecked((int)0x887A0002);
    const int DXGI_ERROR_DEVICE_REMOVED = unchecked((int)0x887A0005);
    const int DXGI_ERROR_DEVICE_HUNG = unchecked((int)0x887A0006);
    const int DXGI_ERROR_DEVICE_RESET = unchecked((int)0x887A0007);
    const int DXGI_ERROR_WAIT_TIMEOUT = unchecked((int)0x887A0027);
    const int DXGI_FORMAT_B8G8R8A8_UNORM = 87;
    const int DXGI_FORMAT_B8G8R8A8_UNORM_SRGB = 91;
    const int D3D11_SDK_VERSION = 7;
    const int D3D11_USAGE_STAGING = 3;
    const uint D3D11_CPU_ACCESS_READ = 0x20000;
    const int D3D11_MAP_READ = 1;

    static readonly Guid IID_IDXGIFactory1 = new("770aae78-f26f-4dba-a829-253c83d1b387");
    static readonly Guid IID_IDXGIOutput1 = new("00cddea8-939b-4b83-a340-a685226666cc");
    static readonly Guid IID_ID3D11Texture2D = new("6f15aaf2-d208-4e89-9ab4-489535d34f9c");

    /// <summary>A Direct3D device on one adapter. Grabs on displays of the same adapter take turns (lock on it): the device context is not thread-safe</summary>
    sealed class Gpu(IntPtr device, IntPtr context)
    {
        public IntPtr Device = device, Context = context;
    }

    /// <summary>The prepared devices by adapter LUID (lock on the dictionary to read or change it)</summary>
    static readonly Dictionary<long, Gpu> gpus = [];

    /// <summary>
    /// Makes the Direct3D device for each adapter that drives a display, if there is none yet. Slow the first time (loads the graphics driver): call it on a worker thread.
    /// Does nothing when it cannot (no DXGI, an adapter that refuses a device): the grabs then stay with GDI
    /// </summary>
    public static void Prepare()
    {
        IntPtr factory = 0;
        try
        {
            if (CreateDXGIFactory1(in IID_IDXGIFactory1, out factory) < 0) return;
            var enumAdapters = Slot<EnumFn>(factory, 12); // IDXGIFactory1::EnumAdapters1
            for (uint a = 0; enumAdapters(factory, a, out var adapter) != DXGI_ERROR_NOT_FOUND; a++)
            {
                if (adapter == 0) continue;
                try
                {
                    if (HasOutputs(adapter) && Luid(adapter) is { } luid && GpuFor(luid) is null) MakeGpu(adapter, luid);
                }
                finally
                {
                    Marshal.Release(adapter);
                }
            }
        }
        catch (Exception ex) when (ex is DllNotFoundException or EntryPointNotFoundException or SEHException or MarshalDirectiveException)
        {
            Log.Warn($"Desktop duplication unavailable, screenshots use GDI: {ex.Message}");
        }
        finally
        {
            Release(ref factory);
        }
    }

    /// <summary>Whether a device has been made (so <see cref="Prepare"/> has run at least once and found a GPU)</summary>
    public static bool Prepared
    {
        get
        {
            lock (gpus) return gpus.Count > 0;
        }
    }

    static Gpu? GpuFor(long luid)
    {
        lock (gpus) return gpus.TryGetValue(luid, out var gpu) ? gpu : null;
    }

    static void MakeGpu(IntPtr adapter, long luid)
    {
        var clock = Stopwatch.StartNew();
        var hr = D3D11CreateDevice(adapter, 0 /* D3D_DRIVER_TYPE_UNKNOWN, required when an adapter is given */, 0, 0, 0, 0, D3D11_SDK_VERSION, out var device, out _, out var context);
        if (hr < 0)
        {
            Log.Warn($"Desktop duplication: no Direct3D device on adapter {luid:X} (0x{hr:X8}); screenshots of its displays use GDI");
            return;
        }
        lock (gpus)
        {
            if (gpus.ContainsKey(luid))
            {
                // Another thread made one meanwhile
                Marshal.Release(context);
                Marshal.Release(device);
                return;
            }
            gpus[luid] = new Gpu(device, context);
        }
        Log.Info($"Desktop duplication ready on adapter {luid:X} ({clock.ElapsedMilliseconds} ms)");
    }

    /// <summary>The device was lost (driver update, GPU reset): forget it, the next <see cref="Prepare"/> makes a new one. Called with the lock on the gpu held</summary>
    static void Drop(long luid, Gpu gpu, int hr)
    {
        lock (gpus)
            if (gpus.TryGetValue(luid, out var known) && known == gpu) gpus.Remove(luid);
        Release(ref gpu.Context);
        Release(ref gpu.Device);
        Log.Warn($"Desktop duplication: the Direct3D device on adapter {luid:X} was lost (0x{hr:X8}); it is made again for the next screenshot");
    }

    static bool Lost(int hr) => hr is DXGI_ERROR_DEVICE_REMOVED or DXGI_ERROR_DEVICE_HUNG or DXGI_ERROR_DEVICE_RESET;

    /// <summary>
    /// The pixels of one display (Bgra32, top row first, fully opaque, upright), as <see cref="Screens"/> grabs them with GDI; null when duplication cannot give a frame (why says what happened, for the log)
    /// </summary>
    /// <param name="monitor">The display (HMONITOR)</param>
    /// <param name="bounds">Its screen coordinates in physical pixels: the frame must be exactly this size</param>
    /// <param name="wait">How long to wait for the compositor to finish a frame after the duplication opens</param>
    public static int[]? TryGrab(IntPtr monitor, RECT bounds, TimeSpan wait, out string? why)
    {
        IntPtr factory = 0, adapter = 0, output = 0, output1 = 0, duplication = 0;
        try
        {
            var hr = CreateDXGIFactory1(in IID_IDXGIFactory1, out factory);
            if (hr < 0) return Fail($"CreateDXGIFactory1 0x{hr:X8}", out why);
            if (!FindOutput(factory, monitor, out adapter, out output, out var rotation)) return Fail("no GPU output drives this display", out why);
            if (Luid(adapter) is not { } luid || GpuFor(luid) is not { } gpu) return Fail("Direct3D device not prepared yet", out why);
            lock (gpu)
            {
                if (gpu.Device == 0) return Fail("Direct3D device was lost", out why);
                hr = Marshal.QueryInterface(output, in IID_IDXGIOutput1, out output1);
                if (hr < 0) return Fail($"IDXGIOutput1 0x{hr:X8}", out why);
                hr = Slot<DuplicateOutputFn>(output1, 22)(output1, gpu.Device, out duplication); // IDXGIOutput1::DuplicateOutput
                if (Lost(hr)) Drop(luid, gpu, hr);
                if (hr < 0) return Fail($"DuplicateOutput 0x{hr:X8}", out why);
                var px = AcquireFrame(duplication, gpu, bounds, rotation, wait, out why, out var lost);
                if (lost != 0) Drop(luid, gpu, lost);
                return px;
            }
        }
        catch (Exception ex) when (ex is DllNotFoundException or EntryPointNotFoundException or SEHException or MarshalDirectiveException)
        {
            return Fail(ex.GetType().Name + ": " + ex.Message, out why);
        }
        finally
        {
            Release(ref duplication);
            Release(ref output1);
            Release(ref output);
            Release(ref adapter);
            Release(ref factory);
        }
    }

    /// <summary>The adapter and output that drive this display (each one AddRef'd, released by the caller)</summary>
    static bool FindOutput(IntPtr factory, IntPtr monitor, out IntPtr adapter, out IntPtr output, out int rotation)
    {
        rotation = 0;
        var enumAdapters = Slot<EnumFn>(factory, 12); // IDXGIFactory1::EnumAdapters1
        for (uint a = 0; enumAdapters(factory, a, out var ad) != DXGI_ERROR_NOT_FOUND; a++)
        {
            if (ad == 0) continue;
            var enumOutputs = Slot<EnumFn>(ad, 7); // IDXGIAdapter::EnumOutputs
            for (uint o = 0; enumOutputs(ad, o, out var op) != DXGI_ERROR_NOT_FOUND; o++)
            {
                if (op == 0) continue;
                if (Slot<OutputGetDescFn>(op, 7)(op, out var desc) >= 0 && desc.Monitor == monitor) // IDXGIOutput::GetDesc
                {
                    adapter = ad;
                    output = op;
                    rotation = desc.Rotation;
                    return true;
                }
                Marshal.Release(op);
            }
            Marshal.Release(ad);
        }
        adapter = output = 0;
        return false;
    }

    static bool HasOutputs(IntPtr adapter)
    {
        if (Slot<EnumFn>(adapter, 7)(adapter, 0, out var output) < 0 || output == 0) return false; // IDXGIAdapter::EnumOutputs
        Marshal.Release(output);
        return true;
    }

    /// <summary>The adapter's LUID (stays the same while the adapter is there), null if it cannot be read</summary>
    static long? Luid(IntPtr adapter) => Slot<AdapterGetDesc1Fn>(adapter, 10)(adapter, out var desc) >= 0 ? desc.Luid : null; // IDXGIAdapter1::GetDesc1

    /// <summary>Waits for the first frame the compositor presents after the duplication opened and copies it out. lost: the HRESULT if the device was lost on the way, else 0</summary>
    static int[]? AcquireFrame(IntPtr duplication, Gpu gpu, RECT bounds, int rotation, TimeSpan wait, out string? why, out int lost)
    {
        lost = 0;
        var acquire = Slot<AcquireNextFrameFn>(duplication, 8); // IDXGIOutputDuplication::AcquireNextFrame
        var releaseFrame = Slot<ReleaseFrameFn>(duplication, 14); // IDXGIOutputDuplication::ReleaseFrame
        var clock = Stopwatch.StartNew();
        while (true)
        {
            var left = (int)Math.Max(0, (wait - clock.Elapsed).TotalMilliseconds);
            var hr = acquire(duplication, (uint)left, out var info, out var resource);
            if (hr == DXGI_ERROR_WAIT_TIMEOUT) return Fail($"no new frame within {wait.TotalMilliseconds:0} ms", out why);
            if (hr < 0) return Fail($"AcquireNextFrame 0x{hr:X8}", out why);
            try
            {
                // The first frame of a new duplication can be an empty placeholder, and one that only moved the pointer carries no picture: only a frame
                // the compositor presented (LastPresentTime set) holds the desktop
                if (info.LastPresentTime != 0) return Copy(resource, gpu, bounds, rotation, out why, out lost);
            }
            finally
            {
                if (resource != 0) Marshal.Release(resource);
                _ = releaseFrame(duplication);
            }
            if (clock.Elapsed >= wait) return Fail($"no new frame within {wait.TotalMilliseconds:0} ms", out why);
        }
    }

    /// <summary>Copies the acquired desktop texture into memory the CPU can read, then into upright Bgra32 pixels</summary>
    static int[]? Copy(IntPtr resource, Gpu gpu, RECT bounds, int rotation, out string? why, out int lost)
    {
        lost = 0;
        IntPtr texture = 0, staging = 0;
        try
        {
            var hr = Marshal.QueryInterface(resource, in IID_ID3D11Texture2D, out texture);
            if (hr < 0) return Fail($"ID3D11Texture2D 0x{hr:X8}", out why);
            Slot<TextureGetDescFn>(texture, 10)(texture, out var desc); // ID3D11Texture2D::GetDesc
            if (desc.Format is not (DXGI_FORMAT_B8G8R8A8_UNORM or DXGI_FORMAT_B8G8R8A8_UNORM_SRGB)) return Fail($"desktop format {desc.Format}", out why);
            var (w, h) = (bounds.Right - bounds.Left, bounds.Bottom - bounds.Top);
            var (uw, uh) = Turns(rotation) % 2 == 1 ? (desc.Height, desc.Width) : (desc.Width, desc.Height);
            if (uw != w || uh != h) return Fail($"frame is {desc.Width}×{desc.Height} (rotation {rotation}), the display {w}×{h}", out why);
            var stagingDesc = new TextureDesc
            {
                Width = desc.Width,
                Height = desc.Height,
                MipLevels = 1,
                ArraySize = 1,
                Format = desc.Format,
                SampleCount = 1,
                Usage = D3D11_USAGE_STAGING,
                CPUAccessFlags = D3D11_CPU_ACCESS_READ,
            };
            hr = Slot<CreateTexture2DFn>(gpu.Device, 5)(gpu.Device, in stagingDesc, 0, out staging); // ID3D11Device::CreateTexture2D
            if (Lost(hr)) lost = hr;
            if (hr < 0) return Fail($"CreateTexture2D 0x{hr:X8}", out why);
            Slot<CopyResourceFn>(gpu.Context, 47)(gpu.Context, staging, texture); // ID3D11DeviceContext::CopyResource
            hr = Slot<MapFn>(gpu.Context, 14)(gpu.Context, staging, 0, D3D11_MAP_READ, 0, out var mapped); // ID3D11DeviceContext::Map, waits for the copy to finish
            if (Lost(hr)) lost = hr;
            if (hr < 0) return Fail($"Map 0x{hr:X8}", out why);
            int[] px;
            try
            {
                px = new int[desc.Width * desc.Height];
                for (var y = 0; y < desc.Height; y++) Marshal.Copy(mapped.Data + y * (int)mapped.RowPitch, px, y * desc.Width, desc.Width);
            }
            finally
            {
                Slot<UnmapFn>(gpu.Context, 15)(gpu.Context, staging, 0); // ID3D11DeviceContext::Unmap
            }
            px = Upright(px, desc.Width, desc.Height, rotation);
            Screens.Opaque(px);
            why = null;
            return px;
        }
        finally
        {
            Release(ref staging);
            Release(ref texture);
        }
    }

    /// <summary>
    /// How many quarter turns clockwise the duplicated image must be turned to stand the way the desktop is shown (DXGI_MODE_ROTATION: 2 = ROTATE90, 3 = ROTATE180, 4 = ROTATE270;
    /// 1 = IDENTITY and 0 = UNSPECIFIED need none). The duplicated image comes in the panel's own orientation, not the desktop's
    /// </summary>
    internal static int Turns(int rotation) => rotation switch
    {
        2 => 1,
        3 => 2,
        4 => 3,
        _ => 0,
    };

    /// <summary>
    /// The duplicated image (w × h pixels, top row first) turned upright for a display rotated by <paramref name="rotation"/> (DXGI_MODE_ROTATION);
    /// the same array when no turn is needed
    /// </summary>
    internal static int[] Upright(int[] px, int w, int h, int rotation)
    {
        var turns = Turns(rotation);
        if (turns == 0) return px;
        var outW = turns == 2 ? w : h;
        var outH = turns == 2 ? h : w;
        var result = new int[px.Length];
        for (var y = 0; y < outH; y++)
        {
            var row = y * outW;
            for (var x = 0; x < outW; x++)
            {
                // (x, y) in the upright image comes from (sx, sy) in the duplicated one
                var (sx, sy) = turns switch
                {
                    1 => (y, h - 1 - x), // a quarter turn clockwise
                    2 => (w - 1 - x, h - 1 - y),
                    _ => (w - 1 - y, x), // a quarter turn counterclockwise
                };
                result[row + x] = px[sy * w + sx];
            }
        }
        return result;
    }

    static int[]? Fail(string reason, out string? why)
    {
        why = reason;
        return null;
    }

    static void Release(ref IntPtr p)
    {
        if (p != 0) Marshal.Release(p);
        p = 0;
    }

    /// <summary>A method of a COM object, by its slot in the vtable (slots counted from QueryInterface = 0, base interfaces first, as in the SDK headers)</summary>
    static T Slot<T>(IntPtr com, int slot) where T : Delegate =>
        Marshal.GetDelegateForFunctionPointer<T>(Marshal.ReadIntPtr(Marshal.ReadIntPtr(com), slot * IntPtr.Size));

    // ---------- The COM methods used (dxgi.h, dxgi1_2.h, d3d11.h) ----------

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate int EnumFn(IntPtr self, uint index, out IntPtr item);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate int AdapterGetDesc1Fn(IntPtr self, out AdapterDesc1 desc);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate int OutputGetDescFn(IntPtr self, out OutputDesc desc);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate int DuplicateOutputFn(IntPtr self, IntPtr device, out IntPtr duplication);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate int AcquireNextFrameFn(IntPtr self, uint timeoutMs, out FrameInfo info, out IntPtr resource);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate int ReleaseFrameFn(IntPtr self);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate void TextureGetDescFn(IntPtr self, out TextureDesc desc);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate int CreateTexture2DFn(IntPtr self, in TextureDesc desc, IntPtr initialData, out IntPtr texture);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate void CopyResourceFn(IntPtr self, IntPtr destination, IntPtr source);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate int MapFn(IntPtr self, IntPtr resource, uint subresource, int mapType, uint flags, out MappedSubresource mapped);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    delegate void UnmapFn(IntPtr self, IntPtr resource, uint subresource);

    /// <summary>DXGI_ADAPTER_DESC1 (only the LUID is read)</summary>
    [StructLayout(LayoutKind.Explicit, Size = 312)]
    struct AdapterDesc1
    {
        [FieldOffset(296)] public long Luid;
    }

    /// <summary>DXGI_OUTPUT_DESC (the device name, WCHAR[32], is skipped)</summary>
    [StructLayout(LayoutKind.Explicit, Size = 96)]
    struct OutputDesc
    {
        [FieldOffset(64)] public RECT DesktopCoordinates;
        [FieldOffset(80)] public int AttachedToDesktop;
        [FieldOffset(84)] public int Rotation;
        [FieldOffset(88)] public IntPtr Monitor;
    }

    /// <summary>DXGI_OUTDUPL_FRAME_INFO</summary>
    [StructLayout(LayoutKind.Sequential)]
    struct FrameInfo
    {
        public long LastPresentTime, LastMouseUpdateTime;
        public uint AccumulatedFrames;
        public int RectsCoalesced, ProtectedContentMaskedOut;
        public POINT PointerPosition;
        public int PointerVisible;
        public uint TotalMetadataBufferSize, PointerShapeBufferSize;
    }

    /// <summary>D3D11_TEXTURE2D_DESC</summary>
    [StructLayout(LayoutKind.Sequential)]
    struct TextureDesc
    {
        public int Width, Height, MipLevels, ArraySize, Format, SampleCount, SampleQuality, Usage;
        public uint BindFlags, CPUAccessFlags, MiscFlags;
    }

    /// <summary>D3D11_MAPPED_SUBRESOURCE</summary>
    [StructLayout(LayoutKind.Sequential)]
    struct MappedSubresource
    {
        public IntPtr Data;
        public uint RowPitch, DepthPitch;
    }
}
