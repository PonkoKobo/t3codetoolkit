using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;

[assembly: AssemblyTitle("T3 Code + Toolkit")]
[assembly: AssemblyProduct("T3CodeToolkit")]

internal static class ToolkitLauncher
{
    private static void Main()
    {
        var folder = AppDomain.CurrentDomain.BaseDirectory;
        var powershell = Path.Combine(Environment.SystemDirectory, @"WindowsPowerShell\v1.0\powershell.exe");
        var starter = Path.Combine(folder, "start.ps1");
        var start = new ProcessStartInfo(powershell,
            "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"" + starter + "\"")
        {
            WorkingDirectory = folder,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        using (Process.Start(start)) { }
    }
}
