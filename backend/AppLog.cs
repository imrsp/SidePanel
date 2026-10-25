using System.IO.Compression;
using System.Text.Json;

namespace SidePanel;

public enum AppLogLevel { Trace, Debug, Info, Warn, Error }

public static class AppLog
{
    const long MaxFileSize = 1024 * 1024;
    const int RetainedFiles = 7;
    static readonly object Gate = new();
    static readonly Dictionary<string, DateTimeOffset> RecentMessages = [];
    static string dataPath = AppContext.BaseDirectory;
    static AppLogLevel threshold = AppLogLevel.Warn;
    static int writes;

    public static void Configure(string directory, string level = "Warn")
    {
        lock (Gate)
        {
            dataPath = Path.GetFullPath(directory);
            threshold = ParseLevel(level);
        }
    }

    public static void ConfigureFromSettings(string directory)
    {
        var level = "Warn";
        try
        {
            var settingsPath = Path.Combine(directory, "settings.json");
            using var document = JsonDocument.Parse(File.ReadAllText(settingsPath));
            if (document.RootElement.TryGetProperty("logLevel", out var value) && value.ValueKind == JsonValueKind.String)
                level = value.GetString() ?? level;
        }
        catch { }
        Configure(directory, level);
    }

    public static void SetLevel(string level)
    {
        lock (Gate) threshold = ParseLevel(level);
    }

    static AppLogLevel ParseLevel(string? level) => Enum.TryParse<AppLogLevel>(level, true, out var parsed) ? parsed : AppLogLevel.Warn;

    public static void Trace(string message, object? details = null) => Write(AppLogLevel.Trace, message, details);
    public static void Debug(string message, object? details = null) => Write(AppLogLevel.Debug, message, details);
    public static void Info(string message, object? details = null) => Write(AppLogLevel.Info, message, details);
    public static void Warn(string message, object? details = null, Exception? exception = null) => Write(AppLogLevel.Warn, message, details, exception);
    public static void Error(string message, Exception? exception = null, object? details = null) => Write(AppLogLevel.Error, message, details, exception);

    static void Write(AppLogLevel level, string message, object? details = null, Exception? exception = null)
    {
        lock (Gate)
        {
            if (level < threshold) return;
            var now = DateTimeOffset.Now;
            if (level >= AppLogLevel.Warn)
            {
                var key = $"{level}:{message}";
                if (RecentMessages.TryGetValue(key, out var last) && now - last < TimeSpan.FromMinutes(1)) return;
                RecentMessages[key] = now;
                if (++writes % 256 == 0)
                    foreach (var stale in RecentMessages.Where(x => now - x.Value > TimeSpan.FromHours(1)).Select(x => x.Key).ToArray()) RecentMessages.Remove(stale);
            }

            try
            {
                Directory.CreateDirectory(dataPath);
                var path = Path.Combine(dataPath, "sidepanel.log");
                if (File.Exists(path) && new FileInfo(path).Length >= MaxFileSize) Rotate(path);
                var record = new { timestamp = now, level = level.ToString().ToLowerInvariant(), message, details, exception = exception?.ToString() };
                File.AppendAllText(path, JsonSerializer.Serialize(record, ConsoleState.Json) + Environment.NewLine);
            }
            catch { }
        }
    }

    static void Rotate(string path)
    {
        var oldest = $"{path}.{RetainedFiles}";
        if (File.Exists(oldest)) File.Delete(oldest);
        for (var index = RetainedFiles - 1; index >= 1; index--)
        {
            var source = $"{path}.{index}";
            if (File.Exists(source)) File.Move(source, $"{path}.{index + 1}");
        }
        File.Move(path, $"{path}.1");
    }

    public static void WriteArchive(Stream destination)
    {
        lock (Gate)
        {
            using var archive = new ZipArchive(destination, ZipArchiveMode.Create, leaveOpen: true);
            var files = Directory.Exists(dataPath)
                ? Directory.GetFiles(dataPath, "sidepanel.log*").OrderBy(x => x, StringComparer.OrdinalIgnoreCase).ToArray()
                : Array.Empty<string>();
            foreach (var file in files)
                archive.CreateEntryFromFile(file, Path.GetFileName(file), CompressionLevel.Optimal);
        }
    }
}
