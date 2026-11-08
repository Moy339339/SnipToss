using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using static SnipToss.App.Native;

namespace SnipToss.App;

/// <summary>
/// Where the UI thread is stuck, written to the log (started by HangWatch). Runs as a second copy of the app (SnipToss.exe --hang-report &lt;process&gt; &lt;thread&gt;):
/// reading a stuck process from inside itself can get caught on the same lock or loader that it is stuck on, and one more stuck thread would make it worse.
/// It stops the UI thread only for as long as it takes to copy its registers and stack (about a millisecond), then works on the copy:
/// .NET frames come from the runtime's own data access library (mscordaccore.dll next to coreclr.dll, the one debuggers use), which can walk .NET code;
/// the native frames in between (Windows, input methods, drivers) come from dbghelp, named by module and export (no symbol server, nothing is downloaded).
/// Also lists the modules from other vendors loaded into the process (input methods, screen readers, security software hook into every app; a hang often sits in one of them).
/// The report has method and module names only, no data from the app (the log removes the user directory as always)
/// </summary>
static class HangReport
{
    public const string Command = "--hang-report";

    /// <summary>Enough to get from where it is stuck down to what started it</summary>
    const int MaxFrames = 80;

    /// <summary>Copy of the stack above the stack pointer: the UI thread's whole stack is 1 MB at most</summary>
    const int MaxStackBytes = 1 << 20;

    // CONTEXT on x64: 1232 bytes, 16-byte aligned; ContextFlags, Rsp, Rbp and Rip at these offsets
    const int ContextSize = 1232, ContextFlagsAt = 0x30, RspAt = 0x98, RbpAt = 0xA0, RipAt = 0xF8;
    const uint CONTEXT_FULL = 0x10000B;

    /// <summary>Started by the watchdog in the stuck process; does not wait for it</summary>
    public static void Start(uint uiThread)
    {
        try
        {
            var start = new ProcessStartInfo(Environment.ProcessPath!) { UseShellExecute = false, CreateNoWindow = true };
            start.ArgumentList.Add(Command);
            start.ArgumentList.Add(Environment.ProcessId.ToString(CultureInfo.InvariantCulture));
            start.ArgumentList.Add(uiThread.ToString(CultureInfo.InvariantCulture));
            using var _ = Process.Start(start);
        }
        catch (Exception ex) when (ex is Win32Exception or InvalidOperationException or IOException)
        {
            Log.Warn("Could not start the hang report", ex);
        }
    }

    /// <summary>The command line of the second copy: --hang-report &lt;process id&gt; &lt;thread id&gt;</summary>
    public static (int Process, uint Thread)? Of(string[] args) =>
        args is [Command, var p, var t]
        && int.TryParse(p, NumberStyles.None, CultureInfo.InvariantCulture, out var process)
        && uint.TryParse(t, NumberStyles.None, CultureInfo.InvariantCulture, out var thread)
            ? (process, thread)
            : null;

    public static int Run(int processId, uint threadId)
    {
        try
        {
            Log.Warn(Read(processId, threadId));
            return 0;
        }
        catch (Exception ex)
        {
            // This process exists only to write the report: whatever went wrong goes into the log in its place
            Log.Warn("The hang report could not be written", ex);
            return 1;
        }
    }

    static string Read(int processId, uint threadId)
    {
        if (RuntimeInformation.ProcessArchitecture != Architecture.X64) return $"Hang report: not available on {RuntimeInformation.ProcessArchitecture}";
        using var target = Process.GetProcessById(processId);
        // Only another copy of this app: the command must not become a way to read other programs
        if (!string.Equals(target.MainModule?.FileName, Environment.ProcessPath, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("The process to report on is not this app");
        var modules = Module.Of(target);
        var process = OpenProcess(PROCESS_QUERY_INFORMATION | PROCESS_VM_READ, false, processId);
        if (process == IntPtr.Zero) throw new Win32Exception();
        try
        {
            var thread = OpenThread(THREAD_SUSPEND_RESUME | THREAD_GET_CONTEXT | THREAD_QUERY_INFORMATION, false, threadId);
            if (thread == IntPtr.Zero) throw new Win32Exception();
            Snapshot snapshot;
            try
            {
                snapshot = Snapshot.Take(process, thread, threadId);
            }
            finally
            {
                CloseHandle(thread);
            }
            return Format(snapshot, modules);
        }
        finally
        {
            CloseHandle(process);
        }
    }

    static string Format(Snapshot snapshot, IReadOnlyList<Module> modules)
    {
        var text = new StringBuilder().Append(CultureInfo.InvariantCulture, $"Hang report: where the UI thread (thread {snapshot.ThreadId}) is stuck");
        var frames = new List<string>();
        // The modules native frames are in, with their exact versions: without symbols the names are only the nearest export, and the version is what finds the matching symbols later
        var native = new List<Module>();
        using (var symbols = new Symbols(snapshot))
        {
            using var dac = ManagedCode.Open(snapshot, modules, out var dacError);
            if (dac is null) text.Append(CultureInfo.InvariantCulture, $" (.NET frames unavailable: {dacError})");
            // From the top down to the first .NET method: native code (Windows, an input method, the runtime itself). Without the data access library this is all there is
            var firstManaged = NativeRun(snapshot.Context, top: true);
            if (dac is not null)
                // The runtime's walk starts at that first .NET method, with the registers dbghelp unwound to there. On its own it starts from the thread's registers and,
                // when they are in the runtime's own native code (a busy loop calling into it), it can only pick up again at the last switch it recorded, further down, and skips the frames between
                foreach (var frame in dac.Walk(firstManaged))
                {
                    if (frames.Count >= MaxFrames) break;
                    if (frame.Method is { } method) frames.Add($"{method}+0x{frame.Offset:x}");
                    // Where native code calls into .NET or the other way round: the native frames below it come from dbghelp, starting from this frame's registers.
                    // Started from the thread's own registers (no .NET method found from the top), the walk's first frame is the top again: those frames are already there
                    else if (!snapshot.IsTop(frame.Context)) NativeRun(frame.Context, top: false);
                }

            // Native frames from the given registers until the next .NET method (which the data access library names in its own walk); returns the registers at that method, if one was reached
            byte[]? NativeRun(byte[] context, bool top)
            {
                foreach (var (pc, registers, i) in symbols.Walk(context).Select((f, i) => (f.Pc, f.Registers, i)))
                {
                    if (frames.Count >= MaxFrames) break;
                    var returnAddress = !top || i > 0;
                    var at = Before(pc, returnAddress);
                    if (dac?.IsManaged(at) == true) return registers;
                    frames.Add(symbols.Name(pc, returnAddress, modules));
                    if (modules.FirstOrDefault(m => m.Contains(at)) is { } module && !native.Contains(module)) native.Add(module);
                }
                return null;
            }
        }
        for (var i = 0; i < frames.Count; i++) text.Append(CultureInfo.InvariantCulture, $"\n  #{i:00} {frames[i]}");
        if (frames.Count >= MaxFrames) text.Append(CultureInfo.InvariantCulture, $"\n  (stopped after {MaxFrames} frames)");
        if (native.Count > 0) text.Append("\n  Native modules on the stack: ").Append(string.Join(", ", native.Select(m => $"{m.Name} {m.Version}")));
        var others = modules.Where(m => m.OtherVendor).Select(m => m.Describe()).ToList();
        text.Append("\n  Modules from other vendors: ").Append(others.Count == 0 ? "none" : string.Join(", ", others));
        return text.ToString();
    }

    /// <summary>
    /// The address to look a frame up by. A return address (every frame but the very top) points to the instruction after the call,
    /// which can already belong to the next function, so it is looked up one byte earlier
    /// </summary>
    static ulong Before(ulong pc, bool returnAddress) => returnAddress ? pc - 1 : pc;

    /// <summary>An address in the other process as a pointer (user-mode addresses on x64 fit in the low half, so nothing is lost)</summary>
    static IntPtr Ptr(ulong address) => new(unchecked((long)address));

    /// <summary>The UI thread's registers and stack, copied while it was stopped for a moment</summary>
    sealed class Snapshot
    {
        public required IntPtr Process { get; init; }
        public required uint ThreadId { get; init; }
        public required byte[] Context { get; init; }
        public required ulong Low { get; init; }
        public required byte[] Stack { get; init; }

        public ulong Rip => BitConverter.ToUInt64(Context, RipAt);

        /// <summary>The registers are the thread's own at the moment it was stopped (same instruction, same stack pointer)</summary>
        public bool IsTop(byte[] context) =>
            BitConverter.ToUInt64(context, RipAt) == Rip && BitConverter.ToUInt64(context, RspAt) == BitConverter.ToUInt64(Context, RspAt);

        public static Snapshot Take(IntPtr process, IntPtr thread, uint threadId)
        {
            var memory = Marshal.AllocHGlobal(ContextSize + 15);
            try
            {
                var aligned = Aligned(memory);
                Marshal.Copy(new byte[ContextSize], 0, aligned, ContextSize);
                Marshal.WriteInt32(aligned, ContextFlagsAt, (int)CONTEXT_FULL);
                // Stopped only while copying the registers and the stack: everything after works on the copy, so the thread runs on even if reading it goes wrong
                if (SuspendThread(thread) == uint.MaxValue) throw new Win32Exception();
                try
                {
                    if (!GetThreadContext(thread, aligned)) throw new Win32Exception();
                    var context = new byte[ContextSize];
                    Marshal.Copy(aligned, context, 0, ContextSize);
                    var rsp = BitConverter.ToUInt64(context, RspAt);
                    // From the stack pointer up to the top of the stack (the committed region the stack pointer is in)
                    if (VirtualQueryEx(process, Ptr(rsp), out var region, Marshal.SizeOf<MEMORY_BASIC_INFORMATION>()) == IntPtr.Zero) throw new Win32Exception();
                    var top = (ulong)region.BaseAddress + (ulong)region.RegionSize;
                    var stack = new byte[(int)Math.Min(top - rsp, MaxStackBytes)];
                    if (!ReadProcessMemory(process, Ptr(rsp), stack, stack.Length, out var read)) throw new Win32Exception();
                    return new() { Process = process, ThreadId = threadId, Context = context, Low = rsp, Stack = stack[..(int)read] };
                }
                finally
                {
                    _ = ResumeThread(thread);
                }
            }
            finally
            {
                Marshal.FreeHGlobal(memory);
            }
        }

        /// <summary>Reads inside the copied stack come from the copy; anything else (code, unwind data, the runtime's own data) is read from the process</summary>
        public bool Read(ulong address, IntPtr buffer, uint size, out uint read)
        {
            if (address >= Low && address + size <= Low + (ulong)Stack.Length)
            {
                Marshal.Copy(Stack, (int)(address - Low), buffer, (int)size);
                read = size;
                return true;
            }
            var ok = ReadProcessMemory(Process, Ptr(address), buffer, (IntPtr)size, out var n);
            read = (uint)n;
            return ok;
        }
    }

    /// <summary>A CONTEXT has to be 16-byte aligned: allocate 15 bytes more and start at the next multiple of 16</summary>
    static IntPtr Aligned(IntPtr memory) => Ptr(((ulong)memory + 15) & ~15UL);

    /// <summary>A module loaded in the stuck process</summary>
    sealed record Module(string Name, string Path, ulong Base, ulong Size, string Version, string? Company)
    {
        /// <summary>The shared .NET runtimes (dotnet\shared\Microsoft.NETCore.App\…, Microsoft.WindowsDesktop.App\…): some of their files carry no company name</summary>
        static readonly Regex SharedRuntime = new(@"\\shared\\Microsoft\.[A-Za-z]+\.App\\", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

        static readonly string System32 = Environment.GetFolderPath(Environment.SpecialFolder.System);

        /// <summary>
        /// Not Microsoft's, nor part of the .NET runtime or this app (its own folder). What is left is code other programs put into every app: input methods,
        /// screen readers, security software, graphics drivers (their version is worth knowing too). ICU comes with Windows under its own project's name
        /// </summary>
        public bool OtherVendor =>
            !(Company ?? "").Contains("Microsoft", StringComparison.OrdinalIgnoreCase)
            && !Path.StartsWith(AppContext.BaseDirectory, StringComparison.OrdinalIgnoreCase)
            && !SharedRuntime.IsMatch(Path)
            && !Path.Equals(System.IO.Path.Combine(System32, "icu.dll"), StringComparison.OrdinalIgnoreCase);

        public string Describe() => $"{Name} {Version}{(string.IsNullOrWhiteSpace(Company) ? "" : $" ({Company.Trim()})")}";

        public bool Contains(ulong address) => address >= Base && address < Base + Size;

        public static List<Module> Of(Process process) =>
            process.Modules.Cast<ProcessModule>()
                .Select(m =>
                {
                    var v = m.FileVersionInfo;
                    var version = string.Create(CultureInfo.InvariantCulture, $"{v.FileMajorPart}.{v.FileMinorPart}.{v.FileBuildPart}.{v.FilePrivatePart}");
                    return new Module(m.ModuleName, m.FileName, (ulong)m.BaseAddress, (ulong)m.ModuleMemorySize, version, v.CompanyName);
                })
                .ToList();
    }

    /// <summary>dbghelp for the stuck process: walking native frames and naming them by export. dbghelp is not thread-safe; this process has only the one thread using it</summary>
    sealed class Symbols : IDisposable
    {
        const uint SYMOPT_UNDNAME = 0x2, SYMOPT_DEFERRED_LOADS = 0x4, SYMOPT_FAIL_CRITICAL_ERRORS = 0x200, SYMOPT_IGNORE_NT_SYMPATH = 0x1000, SYMOPT_NO_PROMPTS = 0x80000;
        const uint IMAGE_FILE_MACHINE_AMD64 = 0x8664;
        const int AddrModeFlat = 3;
        // SYMBOL_INFOW: the name starts at offset 84 (NameLen at 76, MaxNameLen at 80); SizeOfStruct is the size without the name, 88
        const int SymbolInfoSize = 88, NameLenAt = 76, MaxNameLenAt = 80, NameAt = 84, MaxNameLength = 512;

        readonly Snapshot snapshot;
        readonly ReadMemoryRoutine read;
        readonly IntPtr tableAccess, moduleBase;
        readonly IntPtr symbolInfo = Marshal.AllocHGlobal(SymbolInfoSize + MaxNameLength * 2);

        public Symbols(Snapshot snapshot)
        {
            this.snapshot = snapshot;
            read = (_, address, buffer, size, out bytes) => snapshot.Read(address, buffer, size, out bytes);
            var dbghelp = NativeLibrary.Load("dbghelp.dll", typeof(Native).Assembly, null);
            tableAccess = NativeLibrary.GetExport(dbghelp, "SymFunctionTableAccess64");
            moduleBase = NativeLibrary.GetExport(dbghelp, "SymGetModuleBase64");
            // Never a symbol server or _NT_SYMBOL_PATH: nothing is downloaded, and it can't wait on the network. Without a PDB dbghelp falls back to the exports, which is what is used
            _ = SymSetOptions(SYMOPT_UNDNAME | SYMOPT_DEFERRED_LOADS | SYMOPT_FAIL_CRITICAL_ERRORS | SYMOPT_IGNORE_NT_SYMPATH | SYMOPT_NO_PROMPTS);
            if (!SymInitializeW(snapshot.Process, AppContext.BaseDirectory, invadeProcess: true))
            {
                var error = new Win32Exception();
                Marshal.FreeHGlobal(symbolInfo);
                throw error;
            }
        }

        public void Dispose()
        {
            SymCleanup(snapshot.Process);
            Marshal.FreeHGlobal(symbolInfo);
        }

        /// <summary>
        /// Frames from the given registers down: the code address and the registers unwound to that frame. dbghelp can't unwind code the .NET runtime compiled at run time
        /// (it has no unwind data for it), so a walk is only trusted down to the first .NET frame; the caller stops there
        /// </summary>
        public List<(ulong Pc, byte[] Registers)> Walk(byte[] registers)
        {
            var memory = Marshal.AllocHGlobal(ContextSize + 15);
            try
            {
                var context = Aligned(memory);
                Marshal.Copy(registers, 0, context, ContextSize);
                var frame = new STACKFRAME64
                {
                    AddrPC = new() { Offset = BitConverter.ToUInt64(registers, RipAt), Mode = AddrModeFlat },
                    AddrFrame = new() { Offset = BitConverter.ToUInt64(registers, RbpAt), Mode = AddrModeFlat },
                    AddrStack = new() { Offset = BitConverter.ToUInt64(registers, RspAt), Mode = AddrModeFlat },
                };
                var frames = new List<(ulong, byte[])>();
                // With a read routine of its own the thread handle is only a token that has to stay the same. On x64 each step leaves the registers of the frame it returns in context
                while (frames.Count < MaxFrames && StackWalk64(IMAGE_FILE_MACHINE_AMD64, snapshot.Process, (IntPtr)snapshot.ThreadId, ref frame, context, read, tableAccess, moduleBase, IntPtr.Zero))
                {
                    if (frame.AddrPC.Offset == 0) break;
                    var unwound = new byte[ContextSize];
                    Marshal.Copy(context, unwound, 0, ContextSize);
                    frames.Add((frame.AddrPC.Offset, unwound));
                }
                return frames;
            }
            finally
            {
                Marshal.FreeHGlobal(memory);
            }
        }

        /// <summary>module!export+offset when an export is near enough to tell the function, else module+offset from the module start (also for a return address, see Before)</summary>
        public string Name(ulong pc, bool returnAddress, IReadOnlyList<Module> modules)
        {
            var at = Before(pc, returnAddress);
            if (modules.FirstOrDefault(m => m.Contains(at)) is not { } module) return $"0x{pc:x}";
            var name = System.IO.Path.GetFileNameWithoutExtension(module.Name);
            // Exports are sparse in some modules: a far one would put the frame in the wrong function, so beyond 64 KB only the module offset is given
            if (At(at) is ({ } symbol, var displacement) && displacement < 0x10000) return $"{name}!{symbol}+0x{displacement + (pc - at):x}";
            return $"{name}+0x{pc - module.Base:x}";
        }

        /// <summary>The nearest symbol at or before the address (an export when there is no PDB) and how far past it the address is</summary>
        (string? Name, ulong Displacement) At(ulong address)
        {
            Marshal.WriteInt32(symbolInfo, 0, SymbolInfoSize);
            Marshal.WriteInt32(symbolInfo, MaxNameLenAt, MaxNameLength);
            if (!SymFromAddrW(snapshot.Process, address, out var displacement, symbolInfo)) return (null, 0);
            var length = Math.Min(Marshal.ReadInt32(symbolInfo, NameLenAt), MaxNameLength);
            return (Marshal.PtrToStringUni(symbolInfo + NameAt, length), displacement);
        }
    }

    /// <summary>
    /// The .NET side, from the runtime's data access library (mscordaccore.dll, the one debuggers use), loaded from the stuck process's runtime folder so it matches that runtime exactly:
    /// walking the thread's .NET frames (it knows how to unwind code compiled at run time) and naming methods by code address, JIT-compiled and precompiled (ReadyToRun) alike
    /// </summary>
    sealed class ManagedCode : IDisposable
    {
        const uint CLRDATA_SIMPFRAME_MANAGED_METHOD = 0x2, AllFrameTypes = 0xF;
        const int S_OK = 0;

        readonly IXCLRDataProcess dac;
        readonly Snapshot snapshot;
        readonly DataTarget target;
        readonly char[] buffer = new char[1024];

        ManagedCode(IXCLRDataProcess dac, Snapshot snapshot, DataTarget target)
        {
            this.dac = dac;
            this.snapshot = snapshot;
            this.target = target;
        }

        [UnmanagedFunctionPointer(CallingConvention.Winapi)]
        delegate int CreateInstance(ref Guid iid, IntPtr target, out IntPtr instance);

        public static ManagedCode? Open(Snapshot snapshot, IReadOnlyList<Module> modules, out string? error)
        {
            error = null;
            if (modules.FirstOrDefault(m => m.Name.Equals("coreclr.dll", StringComparison.OrdinalIgnoreCase)) is not { } runtime)
            {
                error = "coreclr.dll not loaded";
                return null;
            }
            var path = System.IO.Path.Combine(System.IO.Path.GetDirectoryName(runtime.Path)!, "mscordaccore.dll");
            if (!NativeLibrary.TryLoad(path, out var library) || !NativeLibrary.TryGetExport(library, "CLRDataCreateInstance", out var export))
            {
                error = "mscordaccore.dll not found next to coreclr.dll";
                return null;
            }
            var create = Marshal.GetDelegateForFunctionPointer<CreateInstance>(export);
            var target = new DataTarget(snapshot, modules);
            var unknown = Marshal.GetComInterfaceForObject<DataTarget, ICLRDataTarget>(target);
            try
            {
                var iid = typeof(IXCLRDataProcess).GUID;
                var hr = create(ref iid, unknown, out var instance);
                if (hr < 0)
                {
                    error = $"CLRDataCreateInstance returned 0x{hr:x8}";
                    return null;
                }
                try
                {
                    return new ManagedCode((IXCLRDataProcess)Marshal.GetObjectForIUnknown(instance), snapshot, target);
                }
                finally
                {
                    Marshal.Release(instance);
                }
            }
            finally
            {
                Marshal.Release(unknown);
            }
        }

        /// <summary>A frame of the runtime's walk: a .NET method (Method and the offset into it), or a switch between .NET and native code (Method null) with the registers there</summary>
        public readonly record struct Frame(string? Method, ulong Offset, byte[] Context);

        /// <param name="start">Registers to start at (a .NET method's), or null for the thread's own</param>
        public List<Frame> Walk(byte[]? start)
        {
            var frames = new List<Frame>();
            if (dac.GetTaskByOSThreadID(snapshot.ThreadId, out var task) != S_OK) return frames;
            try
            {
                if (task.CreateStackWalk(AllFrameTypes, out var walk) != S_OK) return frames;
                var memory = Marshal.AllocHGlobal(ContextSize);
                try
                {
                    if (start is not null)
                    {
                        Marshal.Copy(start, 0, memory, ContextSize);
                        _ = walk.SetContext(ContextSize, memory); // if it is refused, the walk starts from the thread's registers as usual
                    }
                    do
                    {
                        if (walk.GetContext(CONTEXT_FULL, ContextSize, out _, memory) != S_OK) break;
                        var context = new byte[ContextSize];
                        Marshal.Copy(memory, context, 0, ContextSize);
                        var managed = walk.GetFrameType(out var simple, out _) == S_OK && simple == CLRDATA_SIMPFRAME_MANAGED_METHOD;
                        var ip = BitConverter.ToUInt64(context, RipAt);
                        var at = Before(ip, ip != snapshot.Rip);
                        frames.Add(managed && Name(at) is ({ } method, var offset) ? new(method, offset + (ip - at), context) : new(null, 0, context));
                    }
                    while (frames.Count < MaxFrames && walk.Next() == S_OK);
                }
                finally
                {
                    Marshal.FreeHGlobal(memory);
                    Marshal.ReleaseComObject(walk);
                }
            }
            finally
            {
                Marshal.ReleaseComObject(task);
            }
            return frames;
        }

        public bool IsManaged(ulong address) => Name(address).Method is not null;

        /// <summary>Namespace.Type.Method(arguments) and the offset into it; null for an address outside .NET code</summary>
        (string? Method, ulong Offset) Name(ulong address)
        {
            if (dac.GetRuntimeNameByAddress(address, 0, (uint)buffer.Length, out var length, buffer, out var displacement) != S_OK || length == 0) return (null, 0);
            return (new string(buffer, 0, (int)Math.Min(length, (uint)buffer.Length)).TrimEnd('\0'), displacement);
        }

        public void Dispose()
        {
            Marshal.ReleaseComObject(dac);
            GC.KeepAlive(target);
        }
    }

    /// <summary>What the data access library reads the stuck process through: the copied registers and stack, the rest of its memory, and where its modules are</summary>
    [ComVisible(true)]
    sealed class DataTarget(Snapshot snapshot, IReadOnlyList<Module> modules) : ICLRDataTarget
    {
        const int E_FAIL = unchecked((int)0x80004005), E_NOTIMPL = unchecked((int)0x80004001);

        public int GetMachineType(out uint machineType)
        {
            machineType = 0x8664; // IMAGE_FILE_MACHINE_AMD64
            return 0;
        }

        public int GetPointerSize(out uint pointerSize)
        {
            pointerSize = 8;
            return 0;
        }

        public int GetImageBase(string imagePath, out ulong baseAddress)
        {
            var name = System.IO.Path.GetFileName(imagePath);
            baseAddress = modules.FirstOrDefault(m => m.Name.Equals(name, StringComparison.OrdinalIgnoreCase))?.Base ?? 0;
            return baseAddress == 0 ? E_FAIL : 0;
        }

        public int ReadVirtual(ulong address, IntPtr buffer, uint bytesRequested, out uint bytesRead) =>
            snapshot.Read(address, buffer, bytesRequested, out bytesRead) ? 0 : E_FAIL;

        public int WriteVirtual(ulong address, IntPtr buffer, uint bytesRequested, out uint bytesWritten)
        {
            bytesWritten = 0;
            return E_NOTIMPL; // reading only
        }

        public int GetTLSValue(uint threadId, uint index, out ulong value)
        {
            value = 0;
            return E_NOTIMPL;
        }

        public int SetTLSValue(uint threadId, uint index, ulong value) => E_NOTIMPL;

        public int GetCurrentThreadID(out uint threadId)
        {
            threadId = snapshot.ThreadId;
            return 0;
        }

        /// <summary>Only the UI thread's registers are known: the ones copied when it was stopped</summary>
        public int GetThreadContext(uint threadId, uint contextFlags, uint contextSize, IntPtr context)
        {
            if (threadId != snapshot.ThreadId) return E_FAIL;
            Marshal.Copy(snapshot.Context, 0, context, (int)Math.Min(contextSize, (uint)ContextSize));
            return 0;
        }

        public int SetThreadContext(uint threadId, uint contextSize, IntPtr context) => E_NOTIMPL;

        public int Request(uint reqCode, uint inBufferSize, IntPtr inBuffer, uint outBufferSize, IntPtr outBuffer) => E_NOTIMPL;
    }

    // ---------- The data access library's interfaces (clrdata.idl, xclrdata.idl). Methods that are never called are declared only to keep the slots in order ----------

    [ComImport, Guid("3E11CCEE-D08B-43e5-AF01-32717A64DA03"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface ICLRDataTarget
    {
        [PreserveSig] int GetMachineType(out uint machineType);
        [PreserveSig] int GetPointerSize(out uint pointerSize);
        [PreserveSig] int GetImageBase([MarshalAs(UnmanagedType.LPWStr)] string imagePath, out ulong baseAddress);
        [PreserveSig] int ReadVirtual(ulong address, IntPtr buffer, uint bytesRequested, out uint bytesRead);
        [PreserveSig] int WriteVirtual(ulong address, IntPtr buffer, uint bytesRequested, out uint bytesWritten);
        [PreserveSig] int GetTLSValue(uint threadId, uint index, out ulong value);
        [PreserveSig] int SetTLSValue(uint threadId, uint index, ulong value);
        [PreserveSig] int GetCurrentThreadID(out uint threadId);
        [PreserveSig] int GetThreadContext(uint threadId, uint contextFlags, uint contextSize, IntPtr context);
        [PreserveSig] int SetThreadContext(uint threadId, uint contextSize, IntPtr context);
        [PreserveSig] int Request(uint reqCode, uint inBufferSize, IntPtr inBuffer, uint outBufferSize, IntPtr outBuffer);
    }

    [ComImport, Guid("5c552ab6-fc09-4cb3-8e36-22fa03c798b7"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IXCLRDataProcess
    {
        [PreserveSig] int Flush();
        [PreserveSig] int StartEnumTasks();
        [PreserveSig] int EnumTask();
        [PreserveSig] int EndEnumTasks();
        [PreserveSig] int GetTaskByOSThreadID(uint osThreadId, out IXCLRDataTask task);
        [PreserveSig] int GetTaskByUniqueID();
        [PreserveSig] int GetFlags();
        [PreserveSig] int IsSameObject();
        [PreserveSig] int GetManagedObject();
        [PreserveSig] int GetDesiredExecutionState();
        [PreserveSig] int SetDesiredExecutionState();
        [PreserveSig] int GetAddressType();
        [PreserveSig] int GetRuntimeNameByAddress(ulong address, uint flags, uint bufLen, out uint nameLen,
            [Out, MarshalAs(UnmanagedType.LPArray, SizeParamIndex = 2)] char[] nameBuf, out ulong displacement);
    }

    [ComImport, Guid("A5B0BEEA-EC62-4618-8012-A24FFC23934C"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IXCLRDataTask
    {
        [PreserveSig] int GetProcess();
        [PreserveSig] int GetCurrentAppDomain();
        [PreserveSig] int GetUniqueID();
        [PreserveSig] int GetFlags();
        [PreserveSig] int IsSameObject();
        [PreserveSig] int GetManagedObject();
        [PreserveSig] int GetDesiredExecutionState();
        [PreserveSig] int SetDesiredExecutionState();
        [PreserveSig] int CreateStackWalk(uint flags, out IXCLRDataStackWalk stackWalk);
    }

    [ComImport, Guid("E59D8D22-ADA7-49a2-89B5-A415AFCFC95F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IXCLRDataStackWalk
    {
        [PreserveSig] int GetContext(uint contextFlags, uint contextBufSize, out uint contextSize, IntPtr contextBuf);
        [PreserveSig] int SetContext(uint contextSize, IntPtr context);
        [PreserveSig] int Next();
        [PreserveSig] int GetStackSizeSkipped();
        [PreserveSig] int GetFrameType(out uint simpleType, out uint detailedType);
    }
}
