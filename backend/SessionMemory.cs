using System.Text.Json;

namespace SidePanel;

public record ConsoleLine(string Text, string Kind);
public record ConsoleUpdate(string? Command = null, ConsoleLine[]? Lines = null, bool Clear = false);
public record ConsoleMemory(string Id, string[] History, ConsoleLine[] Lines, long ClearedAt);
public record TelemetrySample(DateTimeOffset Time, Dictionary<string, double?> Values);

/// <summary>Only command history survives process exit. Output and charts belong to this process.</summary>
public sealed class SessionMemory(string historyPath, TimeProvider? clock = null)
{
    public string Id => id;
    readonly object gate = new();
    readonly string id = Guid.NewGuid().ToString("N");
    readonly TimeProvider time = clock ?? TimeProvider.System;
    readonly List<ConsoleLine> lines = [];
    readonly List<TelemetrySample> samples = [];
    List<string>? history;
    long clearedAt;
    static readonly string[] Keys = ["cpu", "gpu", "memory", "download", "upload"];

    void LoadHistory()
    {
        if (history != null) return;
        try {
            history = File.Exists(historyPath) && new FileInfo(historyPath).Length <= 256 * 1024
                ? (JsonSerializer.Deserialize<string[]>(File.ReadAllText(historyPath)) ?? []).Where(ValidCommand).TakeLast(500).ToList() : [];
        } catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException) { history = []; }
    }
    static bool ValidCommand(string? text) => !string.IsNullOrWhiteSpace(text) && text.Length <= 256 && !text.Any(char.IsControl);
    public static bool Valid(ConsoleUpdate? update) => update != null
        && (update.Command == null || ValidCommand(update.Command))
        && (update.Lines == null || update.Lines.Length <= 8 && update.Lines.All(l => l != null && l.Kind is "input" or "output" or "error" && l.Text is { Length: <= 17000 }));

    public ConsoleMemory Console()
    {
        lock (gate) { LoadHistory(); return new(id, history!.ToArray(), lines.ToArray(), clearedAt); }
    }
    public void ClearHistory()
    {
        lock (gate) {
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(historyPath))!);
            File.WriteAllText(historyPath + ".tmp", "[]");
            File.Move(historyPath + ".tmp", historyPath, true);
            history = [];
        }
    }
    public ConsoleMemory Update(ConsoleUpdate update)
    {
        if (!Valid(update)) throw new ArgumentException("Invalid console update");
        lock (gate) {
            LoadHistory();
            if (update.Command is string command && history!.LastOrDefault() != command) {
                var next = history!.Append(command).TakeLast(500).ToList();
                Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(historyPath))!);
                File.WriteAllText(historyPath + ".tmp", JsonSerializer.Serialize(next));
                File.Move(historyPath + ".tmp", historyPath, true);
                history = next;
            }
            if (update.Clear) { lines.Clear(); clearedAt = time.GetUtcNow().ToUnixTimeMilliseconds(); }
            if (update.Lines != null) lines.AddRange(update.Lines);
            if (lines.Count > 120) lines.RemoveRange(0, lines.Count - 120);
            return new(id, history!.ToArray(), lines.ToArray(), clearedAt);
        }
    }
    void PruneSamples() => samples.RemoveAll(s => s.Time < time.GetUtcNow().AddMinutes(-5));
    public void AddTelemetry(DateTimeOffset timestamp, IReadOnlyDictionary<string, Metric> metrics)
    {
        lock (gate) {
            if (samples.LastOrDefault()?.Time != timestamp)
                samples.Add(new(timestamp, Keys.ToDictionary(key => key, key => metrics.GetValueOrDefault(key)?.Value)));
            PruneSamples();
            if (samples.Count > 150) samples.RemoveRange(0, samples.Count - 150);
        }
    }
    public TelemetrySample[] Telemetry()
    {
        lock (gate) { PruneSamples(); return samples.ToArray(); }
    }
}
