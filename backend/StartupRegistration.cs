using System.Buffers.Binary;
using System.Runtime.InteropServices;
using Microsoft.Win32;

namespace SidePanel;

public static class StartupRegistration
{
    static StartupRegistrationStore Store => new(Registry.CurrentUser,
        Environment.ProcessPath ?? throw new InvalidOperationException("无法确定应用路径"),
        Environment.GetFolderPath(Environment.SpecialFolder.Startup));
    public static bool Enabled => Store.Enabled;
    public static void SetEnabled(bool enabled) => Store.SetEnabled(enabled);
    internal static StartupRegistrationSnapshot Capture() => Store.Capture();
    internal static void Restore(StartupRegistrationSnapshot snapshot) => Store.Restore(snapshot);
}

// Use the real per-user Startup folder: unlike inherited, virtualized Run registry writes,
// the shortcut can be independently verified by Windows' startup application enumeration.
internal sealed class StartupRegistrationStore(RegistryKey root, string executable, string startupFolder)
{
    internal const string RunPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    internal const string RunApprovalPath = @"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
    internal const string ApprovalPath = @"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\StartupFolder";
    internal const string ValueName = "SidePanel.lnk";
    internal const string LegacyValueName = "SidePanel";
    string ShortcutPath => Path.Combine(startupFolder, ValueName);

    public bool Enabled
    {
        get
        {
            if (!File.Exists(ShortcutPath)) return false;
            var target = WithShortcut(link => (string)link.TargetPath);
            if (!string.Equals(target, executable, StringComparison.OrdinalIgnoreCase)) return false;
            using var approval = root.OpenSubKey(ApprovalPath);
            var value = approval?.GetValue(ValueName);
            if (value is null) return true;
            if (value is not byte[] bytes || bytes.Length < 4) return false;
            return BinaryPrimitives.ReadUInt32LittleEndian(bytes) is 0 or 2 or 6;
        }
    }

    T WithShortcut<T>(Func<dynamic, T> action)
    {
        var shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell")!)!;
        object? shortcut = null;
        try { shortcut = ((dynamic)shell).CreateShortcut(ShortcutPath); return action((dynamic)shortcut); }
        finally
        {
            if (shortcut != null) Marshal.FinalReleaseComObject(shortcut);
            Marshal.FinalReleaseComObject(shell);
        }
    }

    public void SetEnabled(bool enabled)
    {
        var previous = Capture();
        try
        {
            Directory.CreateDirectory(startupFolder);
            WithShortcut(link => {
                link.TargetPath = executable;
                link.Arguments = "--autostart";
                link.WorkingDirectory = Path.GetDirectoryName(executable)!;
                link.Description = "SidePanel";
                link.IconLocation = executable + ",0";
                link.Save();
                return true;
            });
            using var approval = root.CreateSubKey(ApprovalPath);
            // New shortcuts are enabled by default. Avoid creating unnecessary approval overrides.
            if (!enabled || approval.GetValue(ValueName) != null)
            {
                var bytes = new byte[12];
                BinaryPrimitives.WriteUInt32LittleEndian(bytes, enabled ? 2u : 3u);
                if (!enabled) BinaryPrimitives.WriteInt64LittleEndian(bytes.AsSpan(4), DateTime.UtcNow.ToFileTimeUtc());
                approval.SetValue(ValueName, bytes, RegistryValueKind.Binary);
            }
            // Retire only our matching legacy registration to avoid launching twice.
            using var run = root.OpenSubKey(RunPath, writable: true);
            if (string.Equals(run?.GetValue(LegacyValueName) as string, $"\"{executable}\"", StringComparison.OrdinalIgnoreCase))
            {
                run!.DeleteValue(LegacyValueName, false);
                using var legacyApproval = root.OpenSubKey(RunApprovalPath, writable: true);
                legacyApproval?.DeleteValue(LegacyValueName, false);
            }
        }
        catch { Restore(previous); throw; }
    }

    public StartupRegistrationSnapshot Capture() => new(
        File.Exists(ShortcutPath) ? File.ReadAllBytes(ShortcutPath) : null,
        Read(ApprovalPath, ValueName), Read(RunPath, LegacyValueName), Read(RunApprovalPath, LegacyValueName));
    RegistryEntry? Read(string path, string name)
    {
        using var key = root.OpenSubKey(path);
        var value = key?.GetValue(name, null, RegistryValueOptions.DoNotExpandEnvironmentNames);
        return value is null ? null : new(value, key!.GetValueKind(name));
    }
    public void Restore(StartupRegistrationSnapshot snapshot)
    {
        if (snapshot.Shortcut is null) File.Delete(ShortcutPath);
        else { Directory.CreateDirectory(startupFolder); File.WriteAllBytes(ShortcutPath, snapshot.Shortcut); }
        Write(ApprovalPath, ValueName, snapshot.Approval);
        Write(RunPath, LegacyValueName, snapshot.LegacyRun);
        Write(RunApprovalPath, LegacyValueName, snapshot.LegacyApproval);
    }
    void Write(string path, string name, RegistryEntry? entry)
    {
        if (entry is null) { using var key = root.OpenSubKey(path, writable: true); key?.DeleteValue(name, false); }
        else { using var key = root.CreateSubKey(path); key.SetValue(name, entry.Value, entry.Kind); }
    }
}
internal sealed record RegistryEntry(object Value, RegistryValueKind Kind);
internal sealed record StartupRegistrationSnapshot(byte[]? Shortcut, RegistryEntry? Approval, RegistryEntry? LegacyRun, RegistryEntry? LegacyApproval);
