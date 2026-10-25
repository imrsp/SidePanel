using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace SidePanel;

public record HomeItem(string EntityId, string Name);
public record HomeSettings(string Url, string Token, string TemperatureEntity, string HumidityEntity, HomeItem[] Entities, bool HasToken = false)
{
    public static HomeSettings Default => new("http://homeassistant.local/", "", "", "", []);
    public static bool EntityValid(string? id) => id != null && id.Length <= 200 && Regex.IsMatch(id, @"^[a-z_]+\.[a-z0-9_]+$");
    public bool Valid() => Url is { Length: <= 2048 } && (Url == "" || Uri.TryCreate(Url, UriKind.Absolute, out var u) && u.Scheme is "http" or "https" && u.UserInfo == "" && u.Query == "" && u.Fragment == "") && Token is { Length: <= 8192 } && !Token.Any(char.IsControl) && (TemperatureEntity == "" || EntityValid(TemperatureEntity)) && (HumidityEntity == "" || EntityValid(HumidityEntity)) && Entities is { Length: <= 12 } && Entities.All(x => x != null && EntityValid(x.EntityId) && x.Name is { Length: <= 60 } && !x.Name.Any(char.IsControl)) && Entities.Select(x => x.EntityId).Distinct().Count() == Entities.Length;
    public HomeSettings Public() => this with { Token = "", HasToken = Token.Length > 0 };
    public static string Protect(string token) => token.Length == 0 ? "" : "dpapi:" + Convert.ToBase64String(ProtectedData.Protect(Encoding.UTF8.GetBytes(token), null, DataProtectionScope.CurrentUser));
    public static string Unprotect(string token) => token.StartsWith("dpapi:") ? Encoding.UTF8.GetString(ProtectedData.Unprotect(Convert.FromBase64String(token[6..]), null, DataProtectionScope.CurrentUser)) : token;
}
public record HomeEntity(string EntityId, string Name, string State, string Unit, bool IsSwitch, bool Available);
public record HomeStatus(string Status, string Message, DateTimeOffset? Updated, HomeEntity? Temperature, HomeEntity? Humidity, HomeEntity[] Entities);
public record HomeAction(string EntityId, bool On);

public sealed class HomeAssistantClient(ConsoleState state)
{
    readonly HttpClient http = new(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(6) };
    readonly SemaphoreSlim gate = new(1);
    HomeStatus status = new("NOT CONFIGURED", "Configure Home Assistant in Settings", null, null, null, []);
    string? revision;
    public HomeStatus Status => revision == state.ConfigRevision ? status : new("CONNECTING", "Loading configuration", null, null, null, []);
    public static bool IsSwitch(string id) => id.Split('.')[0] is "light" or "switch" or "input_boolean" or "fan";
    static HomeEntity Read(HomeItem item, Dictionary<string, JsonElement> states)
    {
        if (!states.TryGetValue(item.EntityId, out var e)) return new(item.EntityId, item.Name.Length > 0 ? item.Name : item.EntityId, "missing", "", IsSwitch(item.EntityId), false);
        var value = e.GetProperty("state").GetString() ?? "unknown";
        var attrs = e.GetProperty("attributes");
        string Attr(string key) => attrs.TryGetProperty(key, out var a) && a.ValueKind == JsonValueKind.String ? a.GetString() ?? "" : "";
        return new(item.EntityId, item.Name.Length > 0 ? item.Name : Attr("friendly_name") is { Length: > 0 } name ? name : item.EntityId, value, Attr("unit_of_measurement"), IsSwitch(item.EntityId), value is not ("unknown" or "unavailable"));
    }
    async Task<JsonDocument> Send(HomeSettings c, string path, object? body, CancellationToken token)
    {
        using var request = new HttpRequestMessage(body == null ? HttpMethod.Get : HttpMethod.Post, c.Url.TrimEnd('/') + "/api/" + path);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", c.Token);
        if (body != null) request.Content = JsonContent.Create(body);
        using var response = await http.SendAsync(request, token);
        if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden) throw new InvalidOperationException("Authentication failed. Check token and account permissions.");
        if (!response.IsSuccessStatusCode) throw new InvalidOperationException($"Home Assistant returned HTTP {(int)response.StatusCode}");
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync(token));
    }
    public async Task<HomeStatus> RefreshAsync(CancellationToken token)
    {
        await gate.WaitAsync(token);
        try {
            var currentRevision = state.ConfigRevision;
            var c = state.Config.HomeAssistant ?? HomeSettings.Default;
            HomeStatus next;
            if (c.Url.Length == 0 || c.Token.Length == 0) next = new("NOT CONFIGURED", "Enter the URL and token in Settings", null, null, null, []);
            else try {
                using var doc = await Send(c, "states", null, token);
                var states = doc.RootElement.EnumerateArray().ToDictionary(e => e.GetProperty("entity_id").GetString()!, e => e);
                HomeEntity? Fixed(string id, string name) => id.Length == 0 ? null : Read(new(id, name), states);
                var temp = Fixed(c.TemperatureEntity, "INDOOR"); var humidity = Fixed(c.HumidityEntity, "HUMIDITY");
                var entities = c.Entities.Select(x => Read(x, states)).ToArray();
                var missing = entities.Concat(new[] { temp, humidity }.OfType<HomeEntity>()).Count(x => !x.Available);
                next = new(missing > 0 ? "PARTIAL" : "ONLINE", missing > 0 ? $"{missing} entities missing or unavailable" : "Connected.", DateTimeOffset.Now, temp, humidity, entities);
            } catch (OperationCanceledException) when (token.IsCancellationRequested) { throw; }
            catch (InvalidOperationException e) { next = new("ERROR", e.Message, null, null, null, []); }
            catch { next = new("OFFLINE", "Connection failed. Check the HA URL, network and service.", null, null, null, []); }
            if (currentRevision == state.ConfigRevision) { status = next; revision = currentRevision; }
            return Status;
        } finally { gate.Release(); }
    }
    public async Task SetAsync(HomeAction action, CancellationToken token)
    {
        var c = state.Config.HomeAssistant;
        if (c == null || !c.Entities.Any(x => x.EntityId == action.EntityId) || !IsSwitch(action.EntityId)) throw new InvalidOperationException("Only configured switches can be controlled");
        var current = Status;
        if (current.Status is not ("ONLINE" or "PARTIAL") || !current.Entities.Any(x => x.EntityId == action.EntityId && x.Available && x.State is "on" or "off")) throw new InvalidOperationException("Device unavailable. Wait for the next refresh.");
        using var result = await Send(c, $"services/{action.EntityId.Split('.')[0]}/{(action.On ? "turn_on" : "turn_off")}", new { entity_id = action.EntityId }, token);
        await RefreshAsync(token);
    }
    public async Task RunAsync(CancellationToken token)
    {
        try { while (!token.IsCancellationRequested) { await RefreshAsync(token); await Task.Delay(2000, token); } }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { }
        finally { http.Dispose(); }
    }
}
