# Set the shortcut's Windows Shell identity to match the toolkit-launched window.
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$ShortcutPath,
  [Parameter(Mandatory)][string]$AppId
)

$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;

public static class ToolkitShell
{
    [StructLayout(LayoutKind.Sequential)]
    private struct PropertyKey
    {
        public Guid Format;
        public uint Id;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PropVariant
    {
        public ushort Type;
        private ushort reserved1, reserved2, reserved3;
        public IntPtr Data;
        private IntPtr extra;
    }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
    private interface IPropertyStore
    {
        void GetCount(out uint count);
        void GetAt(uint index, out PropertyKey key);
        void GetValue(ref PropertyKey key, out PropVariant value);
        void SetValue(ref PropertyKey key, ref PropVariant value);
        void Commit();
    }

    [DllImport("ole32.dll")]
    private static extern int PropVariantClear(ref PropVariant variant);

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern void SHChangeNotify(int eventId, uint flags, string path, IntPtr unused);

    private static void SetString(IPropertyStore store, uint id, string text)
    {
        var key = new PropertyKey { Format = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), Id = id };
        var value = new PropVariant { Type = 31, Data = Marshal.StringToCoTaskMemUni(text) }; // VT_LPWSTR
        try { store.SetValue(ref key, ref value); }
        finally { PropVariantClear(ref value); }
    }

    public static void SetShortcut(string path, string appId)
    {
        var link = Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("00021401-0000-0000-C000-000000000046")));
        try
        {
            var file = (IPersistFile)link;
            file.Load(path, 2);
            var store = (IPropertyStore)link;
            SetString(store, 5, appId);
            store.Commit();
            file.Save(path, true);
        }
        finally { Marshal.ReleaseComObject(link); }
        SHChangeNotify(0x2000, 0x0005, path, IntPtr.Zero);
        // Explorer caches icons by file path, so a reinstall with a new icon can keep showing the old
        // one on the running taskbar button. Tell the shell that icons changed.
        SHChangeNotify(0x08000000, 0x1000, null, IntPtr.Zero); // SHCNE_ASSOCCHANGED, SHCNF_FLUSH
    }

}
'@

[ToolkitShell]::SetShortcut($ShortcutPath, $AppId)

# Also rebuild the per-user icon cache (no Explorer restart needed).
$refresh = Join-Path $env:SystemRoot 'System32\ie4uinit.exe'
if (Test-Path -LiteralPath $refresh) { & $refresh -show }
