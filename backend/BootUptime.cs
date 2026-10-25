using System.Diagnostics.Eventing.Reader;

namespace SidePanel;

internal static class BootUptime
{
    // Ignore BootType 2 (hibernation resume): it continues the same power-on session.
    public static DateTimeOffset? ReadBootTime()
    {
        const string query = "*[System[Provider[@Name='Microsoft-Windows-Kernel-Boot'] and EventID=27]] and *[EventData[Data[@Name='BootType']='0' or Data[@Name='BootType']='1']]";
        using var reader = new EventLogReader(new EventLogQuery("System", PathType.LogName, query) { ReverseDirection = true });
        using var record = reader.ReadEvent();
        return record?.TimeCreated is DateTime time ? new DateTimeOffset(time) : null;
    }

    public static long SecondsSince(DateTimeOffset bootTime, DateTimeOffset now) =>
        Math.Max(0, (long)(now - bootTime).TotalSeconds);
}
