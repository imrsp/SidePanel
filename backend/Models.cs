using System.Text.Json;

namespace SidePanel;
public record Probe(string Name, string Url);
public record Settings(int Version, string Theme, bool Scanlines, double? Latitude, double? Longitude, string Location, string NetworkId, Probe[] Services, int FontScale = 100, string WorkstationName = "WORKSTATION", bool StartAtLogin = false, HomeSettings? HomeAssistant = null, CustomCommand[]? Commands = null, string LogLevel = "Warn")
{
    public static Settings Default => new(1, "terminal", true, null, null, "", "", [new("SidePanel API", $"http://127.0.0.1:{(Environment.GetEnvironmentVariable("SIDE_PANEL_PORT") ?? "3220")}/api/v1/state")]);
    public bool Valid() => (Commands == null || Commands.Length <= 24 && Commands.All(c => c != null && c.Valid()) && Commands.Select(c => c.Name).Distinct(StringComparer.OrdinalIgnoreCase).Count() == Commands.Length) && Version == 1 && !string.IsNullOrWhiteSpace(WorkstationName) && WorkstationName.Length <= 40 && !WorkstationName.Any(char.IsControl) && FontScale is 100 or 125 or 150 or 200 && (LogLevel is "Trace" or "Debug" or "Info" or "Warn" or "Error") && (Theme is "terminal" or "graphite") && (Latitude is null || Latitude is >= -90 and <= 90) && (Longitude is null || Longitude is >= -180 and <= 180) && Location is { Length: <= 100 } && NetworkId is { Length: <= 200 } && Services is { Length: <= 12 } && Services.All(p => p != null && !string.IsNullOrWhiteSpace(p.Name) && p.Name.Length <= 60 && Uri.TryCreate(p.Url, UriKind.Absolute, out var u) && (u.Scheme is "http" or "https" or "tcp"));
}
public record Sensor(string Id, string Hardware, string Type, string Name, float? Value);
public record Metric(double? Value, string Unit, string Source);
public record ServiceStatus(string Name, string Url, bool? Online);
public record LogLine(DateTimeOffset Time, string Level, string Message);
public record DiskStatus(string Name, double UsedGb, double TotalGb);
public record Weather(double? Temperature, int? Code, DateTimeOffset? Updated, string Status);
public record Snapshot(DateTimeOffset Time, long UptimeSeconds, Dictionary<string, Metric> Metrics, Sensor[] Sensors, DiskStatus[] Disks, ServiceStatus[] Services, LogLine[] Logs, Weather Weather, string HardwareStatus, object[] Networks, HomeStatus? HomeAssistant = null);
public sealed class ConsoleState
{
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    public static string DataPath => Environment.GetEnvironmentVariable("SIDE_PANEL_DATA") is { Length: > 0 } path
        ? Path.GetFullPath(path)
        : Path.Combine(AppContext.BaseDirectory, "data");
    readonly object configGate = new();
    Settings config = Settings.Default;
    public Settings Config => config with { StartAtLogin = StartupRegistration.Enabled };
    public Settings PublicConfig => Config with { HomeAssistant = (Config.HomeAssistant ?? HomeSettings.Default).Public() };
    public HomeAssistantClient HomeAssistant { get; }
    public SessionMemory Session { get; } = new(Path.Combine(DataPath, "command-history.json"));
    public Snapshot LiveSnapshot => Snapshot with { HomeAssistant = HomeAssistant.Status };
    public string ConfigRevision { get; private set; } = Guid.NewGuid().ToString("N");
    public Snapshot Snapshot { get; set; } = new(DateTimeOffset.Now, 0, [], [], [], [], [], new(null, null, null, "NOT CONFIGURED"), "INITIALIZING", []);
    public ConsoleState() {
        AppLog.ConfigureFromSettings(DataPath);
        var settingsMissing = !File.Exists(Path.Combine(DataPath, "settings.json"));
        try {
            var value = JsonSerializer.Deserialize<Settings>(File.ReadAllText(Path.Combine(DataPath, "settings.json")), Json);
            if(value?.FontScale is 175) value = value with { FontScale = 150 };
            if(value?.Valid() == true && (value.HomeAssistant?.Valid() ?? true)) {
                config = value;
                if (value.HomeAssistant is { } home) {
                    string token;
                    try { token = HomeSettings.Unprotect(home.Token); } catch { token = ""; }
                    config = value with { HomeAssistant = home with { Token = token } };
                }
            }
        } catch (Exception e) {
            if (!settingsMissing) AppLog.Warn("Could not read settings; defaults will be used", exception: e);
        }
        HomeAssistant = new(this);
        AppLog.SetLevel(config.LogLevel);
        // Windows is authoritative: a rebuilt or missing settings file must not
        // lose an existing startup registration or re-enable a disabled one.
        var startupEnabled = StartupRegistration.Enabled;
        if (settingsMissing || config.StartAtLogin != startupEnabled) {
            config = config with { StartAtLogin = startupEnabled };
            try { Save(config); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }
    public void SetStartAtLogin(bool enabled) { lock (configGate) Save(Config with { StartAtLogin = enabled }); }
    public void Save(Settings value) {
        lock (configGate) {
            if (value.HomeAssistant is { } home) value = value with { HomeAssistant = home with { Token = string.IsNullOrEmpty(home.Token) ? config.HomeAssistant?.Token ?? "" : home.Token } };
            else value = value with { HomeAssistant = config.HomeAssistant };
            var stored = value with { HomeAssistant = value.HomeAssistant is { } h ? h with { Token = HomeSettings.Protect(h.Token), HasToken = false } : null };
            Directory.CreateDirectory(DataPath);
            var path = Path.Combine(DataPath, "settings.json");
            File.WriteAllText(path + ".tmp", JsonSerializer.Serialize(stored, Json));
            var previous = StartupRegistration.Capture();
            try {
                if (StartupRegistration.Enabled != value.StartAtLogin) StartupRegistration.SetEnabled(value.StartAtLogin);
                File.Move(path + ".tmp", path, true);
            } catch {
                StartupRegistration.Restore(previous);
                throw;
            }
            config = value; ConfigRevision = Guid.NewGuid().ToString("N");
            AppLog.SetLevel(value.LogLevel);
            AppLog.Info("Application log level updated", new { value.LogLevel });
        }
    }
}

