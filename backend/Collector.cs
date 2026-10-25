using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text.Json;
using LibreHardwareMonitor.Hardware;

namespace SidePanel;
public sealed class Collector(ConsoleState state)
{
    readonly Computer computer = new() { IsCpuEnabled = true, IsGpuEnabled = true, IsMemoryEnabled = true, IsMotherboardEnabled = true, IsStorageEnabled = true, IsNetworkEnabled = false };
    readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(6) };
    readonly Queue<LogLine> logs = new();
    Dictionary<string, (long Down, long Up)> previous = [];
    readonly Dictionary<string, bool> previousServiceStates = [];
    DateTimeOffset lastSample = DateTimeOffset.Now, lastWeather = DateTimeOffset.MinValue, lastProbe = DateTimeOffset.MinValue;
    string status = "ONLINE";
    string? loggedHomeRevision, loggedHomeStatus;
    void Log(string level, string message, Exception? exception = null) {
        logs.Enqueue(new(DateTimeOffset.Now, level, message)); while (logs.Count > 40) logs.Dequeue();
        if (level == "WARN") AppLog.Warn("Collector: " + message, exception: exception);
        else if (level == "ERROR") AppLog.Error("Collector: " + message, exception);
        else if (level == "INFO") AppLog.Info("Collector: " + message);
        else AppLog.Debug("Collector: " + message);
    }
    public async Task RunAsync(CancellationToken token)
    {
        await Task.Yield();
        DateTimeOffset? bootTime = null;
        try { bootTime = BootUptime.ReadBootTime(); }
        catch (Exception e) { Log("WARN", "Boot event unavailable; uptime uses system counter: " + e.Message, e); }
        if (bootTime is null) Log("WARN", "No readable boot event; uptime uses system counter (may span Fast Startup shutdowns).");
        try { computer.Open(); Log("INFO", "Hardware collector initialized"); } catch (Exception e) { status = "LIMITED"; Log("WARN", "Hardware access: " + e.Message, e); }
        while (!token.IsCancellationRequested) {
            try {
                var sensors = new List<Sensor>();
                foreach (var hardware in computer.Hardware) Read(hardware, sensors);
                var metrics = new Dictionary<string, Metric>();
                void Pick(string key, string unit, Func<Sensor, bool> match) {
                    var sensor = sensors.FirstOrDefault(s => s.Value.HasValue && match(s));
                    metrics[key] = new(sensor?.Value, unit, sensor?.Id ?? "unavailable");
                }
                Pick("cpu", "%", s => s.Hardware == "Cpu" && s.Type == "Load" && s.Name == "CPU Total");
                Pick("gpu", "%", s => s.Hardware.StartsWith("Gpu") && s.Type == "Load" && s.Name == "GPU Core");
                Pick("cpuTemp", "°C", s => s.Hardware == "Cpu" && s.Type == "Temperature" && (s.Name.Contains("Package") || s.Name.Contains("Tctl") || s.Name == "Core (Tctl/Tdie)"));
                Pick("gpuTemp", "°C", s => s.Hardware.StartsWith("Gpu") && s.Type == "Temperature" && s.Name == "GPU Core");
                Pick("ssdTemp", "°C", s => s.Hardware == "Storage" && s.Type == "Temperature");
                Pick("cpuPower", "W", s => s.Hardware == "Cpu" && s.Type == "Power" && s.Name.Contains("Package"));
                Pick("gpuPower", "W", s => s.Hardware.StartsWith("Gpu") && s.Type == "Power" && (s.Name == "GPU Power" || s.Name.Contains("Package") || s.Name.Contains("Board")));
                // Sum one throughput sensor per physical disk; never treat missing sensors as zero.
                foreach (var (key, direction) in new[] { ("diskRead", "Read"), ("diskWrite", "Write") }) {
                    var rates = sensors.Where(s => s.Hardware == "Storage" && s.Type == "Throughput" && s.Name.Contains(direction) && s.Value.HasValue)
                        .DistinctBy(s => s.Id).ToArray();
                    metrics[key] = new(rates.Length > 0 ? rates.Sum(s => Math.Max(0, s.Value!.Value)) / 1_000_000 : null,
                        "MB/s", rates.Length > 0 ? "All disks: " + string.Join(", ", rates.Select(s => s.Id)) : "unavailable");
                }
                var mem = new MemoryStatus(); mem.Length = (uint)Marshal.SizeOf<MemoryStatus>();
                if (GlobalMemoryStatusEx(ref mem)) {
                    metrics["memory"] = new(mem.Load, "%", "GlobalMemoryStatusEx");
                    metrics["memoryUsed"] = new((mem.TotalPhysical - mem.AvailablePhysical) / 1073741824d, "GB", "Windows");
                    metrics["memoryTotal"] = new(mem.TotalPhysical / 1073741824d, "GB", "Windows");
                }
                // Record the first resolved HA initialization result once per configuration.
                var homeRevision = state.ConfigRevision;
                var homeStatus = state.HomeAssistant.Status;
                if ((loggedHomeRevision != homeRevision || loggedHomeStatus != homeStatus.Status) && homeStatus.Status != "CONNECTING") {
                    Log("INFO", $"Home Assistant initialized: {homeStatus.Status} - {homeStatus.Message}");
                    if (homeStatus.Status is "OFFLINE" or "ERROR") AppLog.Warn("Home Assistant connection unavailable", new { status = homeStatus.Status, homeStatus.Message });
                    loggedHomeRevision = homeRevision;
                    loggedHomeStatus = homeStatus.Status;
                }
                var now = DateTimeOffset.Now;
                var networks = NetworkInterface.GetAllNetworkInterfaces().Where(n => n.OperationalStatus == OperationalStatus.Up && n.NetworkInterfaceType != NetworkInterfaceType.Loopback).ToArray();
                var selected = networks.FirstOrDefault(n => n.Id == state.Config.NetworkId) ?? networks.OrderByDescending(n => n.Speed).FirstOrDefault();
                var elapsed = Math.Max(.1, (now-lastSample).TotalSeconds);
                foreach (var n in networks) {
                    var stats = n.GetIPStatistics();
                    if (n == selected && previous.TryGetValue(n.Id, out var old)) {
                        metrics["download"] = new(Math.Max(0, stats.BytesReceived-old.Down)*8/elapsed/1_000_000, "Mbps", n.Name);
                        metrics["upload"] = new(Math.Max(0, stats.BytesSent-old.Up)*8/elapsed/1_000_000, "Mbps", n.Name);
                    }
                    previous[n.Id] = (stats.BytesReceived, stats.BytesSent);
                }
                lastSample = now;
                AppLog.Debug("Telemetry sample collected", new { sensorCount = sensors.Count, hardwareStatus = status });
                if ((now-lastProbe).TotalSeconds >= 30) { await ProbeServices(token); lastProbe = now; }
                if ((now-lastWeather).TotalMinutes >= 15) { await UpdateWeather(token); lastWeather = now; }
                var disks = DriveInfo.GetDrives().Where(d => d.IsReady && d.DriveType == DriveType.Fixed).Select(d => new DiskStatus(d.Name, (d.TotalSize-d.TotalFreeSpace)/1073741824d, d.TotalSize/1073741824d)).ToArray();
                state.Session.AddTelemetry(now, metrics);
                state.Snapshot = state.Snapshot with { Time = now, UptimeSeconds = bootTime is { } boot ? BootUptime.SecondsSince(boot, DateTimeOffset.Now) : Environment.TickCount64/1000, Sensors = sensors.ToArray(), Metrics = metrics, Disks = disks, Logs = logs.Reverse().ToArray(), HardwareStatus = status, Networks = networks.Select(n => (object)new { n.Id, n.Name }).ToArray() };
            } catch (Exception e) when (!token.IsCancellationRequested) { Log("WARN", "Collection cycle failed: " + e.Message, e); }
            try { await Task.Delay(2000, token); } catch (OperationCanceledException) { break; }
        }
        computer.Close(); http.Dispose();
    }
    void Read(IHardware hardware, List<Sensor> output) {
        try { hardware.Update(); foreach (var s in hardware.Sensors) output.Add(new(s.Identifier.ToString(), hardware.HardwareType.ToString(), s.SensorType.ToString(), s.Name, s.Value is float v && float.IsFinite(v) ? v : null)); foreach(var h in hardware.SubHardware) Read(h, output); }
        catch (Exception e) { status = "LIMITED"; if(!logs.Any(l => l.Message == e.Message)) Log("WARN", "Hardware sensor read failed: " + e.Message, e); }
    }
    async Task ProbeServices(CancellationToken token) {
        var result = new List<ServiceStatus>();
        foreach(var p in state.Config.Services) {
            bool online;
            try { var uri = new Uri(p.Url); if(uri.Scheme == "tcp") { using var client = new TcpClient(); await client.ConnectAsync(uri.Host, uri.Port, token).AsTask().WaitAsync(TimeSpan.FromSeconds(4), token); online = true; } else { using var response = await http.GetAsync(uri, HttpCompletionOption.ResponseHeadersRead, token); online = response.IsSuccessStatusCode; } } catch { online = false; }
            if (!previousServiceStates.TryGetValue(p.Name, out var wasOnline) || wasOnline != online) {
                if (!online) AppLog.Warn("Configured service is unreachable", new { name = p.Name });
                else AppLog.Info("Configured service is reachable again", new { name = p.Name });
                previousServiceStates[p.Name] = online;
            }
            result.Add(new(p.Name,p.Url,online));
        }
        state.Snapshot = state.Snapshot with { Services = result.ToArray() };
        AppLog.Trace("Service probe cycle completed", new { serviceCount = result.Count });
    }
    async Task UpdateWeather(CancellationToken token) {
        var c = state.Config;
        if(c.Latitude is null || c.Longitude is null) { state.Snapshot = state.Snapshot with { Weather = new(null,null,null,"NOT CONFIGURED") }; return; }
        try {
            var url = FormattableString.Invariant($"https://api.open-meteo.com/v1/forecast?latitude={c.Latitude}&longitude={c.Longitude}&current=temperature_2m,weather_code");
            using var doc = JsonDocument.Parse(await http.GetStringAsync(url,token)); var current = doc.RootElement.GetProperty("current");
            state.Snapshot = state.Snapshot with { Weather = new(current.GetProperty("temperature_2m").GetDouble(),current.GetProperty("weather_code").GetInt32(),DateTimeOffset.Now,"ONLINE") };
        } catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
        catch (Exception e) { AppLog.Warn("Weather refresh failed", exception: e); state.Snapshot = state.Snapshot with { Weather = state.Snapshot.Weather with { Status = "OFFLINE" } }; }
    }
    [StructLayout(LayoutKind.Sequential)] struct MemoryStatus { public uint Length,Load; public ulong TotalPhysical,AvailablePhysical,TotalPage,AvailablePage,TotalVirtual,AvailableVirtual,AvailableExtended; }
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool GlobalMemoryStatusEx(ref MemoryStatus status);
}
