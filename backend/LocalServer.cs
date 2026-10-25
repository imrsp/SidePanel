using System.Collections.Concurrent;
using System.Net;
using System.Text;
using System.Text.Json;

namespace SidePanel;

/// <summary>Loopback-only HTTP.sys listener. No ASP.NET Core dependency.</summary>
public sealed class LocalServer(ConsoleState state, int port = 3220) : IAsyncDisposable
{
    readonly HttpListener listener = new();
    readonly CancellationTokenSource stopping = new();
    readonly ConcurrentDictionary<long, Task> requests = new();
    readonly CommandRunner commands = new();
    readonly UpdateChecker updates = new();
    readonly SemaphoreSlim configLock = new(1);
    Task? acceptLoop;
    long requestId;
    readonly string root = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "wwwroot"));

    public void Start()
    {
        listener.Prefixes.Add($"http://127.0.0.1:{port}/");
        listener.Start();
        acceptLoop = Task.Run(AcceptAsync);
    }

    async Task AcceptAsync()
    {
        while (!stopping.IsCancellationRequested)
        {
            HttpListenerContext context;
            try { context = await listener.GetContextAsync(); }
            catch (Exception e) when (stopping.IsCancellationRequested && e is HttpListenerException or ObjectDisposedException) { break; }
            var id = Interlocked.Increment(ref requestId);
            var task = HandleAsync(context);
            requests[id] = task;
            _ = task.ContinueWith(completed => { requests.TryRemove(id, out _); }, TaskScheduler.Default);
        }
    }

    async Task HandleAsync(HttpListenerContext context)
    {
        var request = context.Request;
        var response = context.Response;
        try
        {
            AppLog.Trace("HTTP request received", new { method = request.HttpMethod, path = request.Url?.AbsolutePath });
            response.Headers["X-Content-Type-Options"] = "nosniff";
            var origin = request.Headers["Origin"];
            if (request.HttpMethod is not ("GET" or "HEAD") && !string.IsNullOrEmpty(origin) && !IsLocalOrigin(request))
            { await JsonAsync(response, new { error = "Origin not allowed" }, 403); return; }
            var path = request.Url!.AbsolutePath;
            if (path.StartsWith("/api/", StringComparison.Ordinal))
            {
                response.Headers["Cache-Control"] = "no-store";
                switch (request.HttpMethod, path)
                {
                    case ("GET", "/api/v1/app"): await JsonAsync(response, new { version = UpdateChecker.AppVersion, repositoryUrl = UpdateChecker.RepositoryUrl }); return;
                    case ("POST", "/api/v1/updates/check"):
                        if (!IsLocalOrigin(request)) { await JsonAsync(response, new { error = "Same-origin update requests only" }, 403); return; }
                        await JsonAsync(response, await updates.CheckAsync(stopping.Token)); return;
                    case ("GET", "/api/v1/telemetry"): await JsonAsync(response, new { id = state.Session.Id, samples = state.Session.Telemetry() }); return;
                    case ("GET", "/api/v1/console"): await JsonAsync(response, state.Session.Console()); return;
                    case ("DELETE", "/api/v1/console/history"): await ClearHistoryAsync(request, response); return;
                    case ("POST", "/api/v1/console"): await UpdateConsoleAsync(request, response); return;
                    case ("GET", "/api/v1/state"): await JsonAsync(response, state.LiveSnapshot); return;
                    case ("GET", "/api/v1/diagnostics"): await JsonAsync(response, new { state.Snapshot.Sensors, state.Snapshot.HardwareStatus }); return;
                    case ("GET", "/api/v1/logs/download"):
                        if ((request.Headers["Origin"] != null && !IsLocalOrigin(request)) || request.Headers["Sec-Fetch-Site"] is "cross-site")
                        { await JsonAsync(response, new { error = "Same-origin log downloads only" }, 403); return; }
                        await DownloadLogsAsync(response); return;
                    case ("GET", "/api/v1/config"): await JsonAsync(response, state.PublicConfig); return;
                    case ("PUT", "/api/v1/config"): await SaveConfigAsync(request, response); return;
                    case ("POST", "/api/v1/home/test"): await JsonAsync(response, await state.HomeAssistant.RefreshAsync(stopping.Token)); return;
                    case ("POST", "/api/v1/home/action"): await HomeActionAsync(request, response); return;
                    case ("POST", "/api/v1/commands/run"): await RunCommandAsync(request, response); return;
                    case ("GET", "/api/v1/events"): await EventsAsync(response); return;
                    default: await JsonAsync(response, new { error = "Unknown endpoint or method" }, 404); return;
                }
            }
            if (request.HttpMethod is not ("GET" or "HEAD")) { response.StatusCode = 405; response.Headers["Allow"] = "GET, HEAD"; return; }
            await FileAsync(path, request.HttpMethod == "HEAD", response);
        }
        catch (Exception e) when (e is OperationCanceledException or HttpListenerException or IOException or ObjectDisposedException) { }
        catch (Exception e)
        {
            try { await JsonAsync(response, new { error = "Internal server error" }, 500); } catch { }
            AppLog.Error("Unhandled HTTP request exception", e, new { method = request.HttpMethod, path = request.Url?.AbsolutePath });
        }
        finally { response.Close(); }
    }

    async Task DownloadLogsAsync(HttpListenerResponse response)
    {
        using var archive = new MemoryStream();
        AppLog.WriteArchive(archive);
        response.ContentType = "application/zip";
        response.Headers["Content-Disposition"] = "attachment; filename=SidePanel-logs.zip";
        response.ContentLength64 = archive.Length;
        archive.Position = 0;
        await archive.CopyToAsync(response.OutputStream, stopping.Token);
    }

    async Task SaveConfigAsync(HttpListenerRequest request, HttpListenerResponse response)
    {
        if (request.ContentType?.Split(';')[0].Trim() != "application/json") { await JsonAsync(response, new { error = "Expected application/json" }, 415); return; }
        const int limit = 256 * 1024;
        if (request.ContentLength64 > limit) { await JsonAsync(response, new { error = "Body too large" }, 413); return; }
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stopping.Token);
        timeout.CancelAfter(TimeSpan.FromSeconds(10));
        using var buffer = new MemoryStream();
        var chunk = new byte[4096];
        int read;
        while ((read = await request.InputStream.ReadAsync(chunk, timeout.Token)) > 0)
        {
            if (buffer.Length + read > limit) { await JsonAsync(response, new { error = "Body too large" }, 413); return; }
            buffer.Write(chunk, 0, read);
        }
        Settings? config;
        try { config = JsonSerializer.Deserialize<Settings>(buffer.ToArray(), ConsoleState.Json); }
        catch (JsonException) { await JsonAsync(response, new { error = "Invalid JSON" }, 400); return; }
        if (config?.Valid() != true || (config.HomeAssistant?.Valid() == false)) { await JsonAsync(response, new { error = "Invalid settings" }, 400); return; }
        await configLock.WaitAsync(stopping.Token);
        try { state.Save(config); } finally { configLock.Release(); }
        await JsonAsync(response, state.PublicConfig);
    }

    async Task HomeActionAsync(HttpListenerRequest request, HttpListenerResponse response)
    {
        if (request.ContentType?.Split(';')[0].Trim() != "application/json") { await JsonAsync(response, new { error = "Expected application/json" }, 415); return; }
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stopping.Token);
        timeout.CancelAfter(TimeSpan.FromSeconds(15));
        using var buffer = new MemoryStream();
        var chunk = new byte[2048]; int read;
        while ((read = await request.InputStream.ReadAsync(chunk, timeout.Token)) > 0) {
            if (buffer.Length + read > 2048) { await JsonAsync(response, new { error = "Body too large" }, 413); return; }
            buffer.Write(chunk, 0, read);
        }
        try {
            var action = JsonSerializer.Deserialize<HomeAction>(buffer.ToArray(), ConsoleState.Json);
            if (action == null || !HomeSettings.EntityValid(action.EntityId)) { await JsonAsync(response, new { error = "Invalid entity" }, 400); return; }
            await state.HomeAssistant.SetAsync(action, timeout.Token);
            await JsonAsync(response, state.HomeAssistant.Status);
        } catch (JsonException) { await JsonAsync(response, new { error = "Invalid JSON" }, 400); }
        catch (InvalidOperationException e) { await JsonAsync(response, new { error = e.Message }, 400); }
        catch (Exception e) when (e is HttpRequestException or OperationCanceledException) { await JsonAsync(response, new { error = "Action failed. Check the connection and try again." }, 502); }
    }

    async Task ClearHistoryAsync(HttpListenerRequest request, HttpListenerResponse response)
    {
        if (!IsLocalOrigin(request)) { await JsonAsync(response, new { error = "Same-origin history requests only" }, 403); return; }
        try { state.Session.ClearHistory(); await JsonAsync(response, new { success = true }); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { await JsonAsync(response, new { error = "Could not clear command history" }, 503); }
    }

    async Task UpdateConsoleAsync(HttpListenerRequest request, HttpListenerResponse response)
    {
        if (!IsLocalOrigin(request)) { await JsonAsync(response, new { error = "Same-origin console requests only" }, 403); return; }
        if (request.ContentType?.Split(';')[0].Trim() != "application/json") { await JsonAsync(response, new { error = "Expected application/json" }, 415); return; }
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stopping.Token);
        timeout.CancelAfter(TimeSpan.FromSeconds(5));
        using var buffer = new MemoryStream();
        var chunk = new byte[4096]; int read;
        while ((read = await request.InputStream.ReadAsync(chunk, timeout.Token)) > 0) {
            if (buffer.Length + read > 144 * 1024) { await JsonAsync(response, new { error = "Body too large" }, 413); return; }
            buffer.Write(chunk, 0, read);
        }
        try {
            var update = JsonSerializer.Deserialize<ConsoleUpdate>(buffer.ToArray(), ConsoleState.Json);
            if (!SessionMemory.Valid(update)) { await JsonAsync(response, new { error = "Invalid console update" }, 400); return; }
            state.Session.Update(update!);
            await JsonAsync(response, new { success = true });
        } catch (JsonException) { await JsonAsync(response, new { error = "Invalid JSON" }, 400); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { await JsonAsync(response, new { error = "Could not save command history" }, 503); }
    }

    static bool IsLocalOrigin(HttpListenerRequest request) => request.Headers["Origin"] is string origin &&
        (origin == $"http://127.0.0.1:{request.Url?.Port}" || origin == $"http://localhost:{request.Url?.Port}");

    async Task RunCommandAsync(HttpListenerRequest request, HttpListenerResponse response)
    {
        // Reject browser requests from other origins, including null/file origins.
        if (!IsLocalOrigin(request) ||
            request.Headers["Sec-Fetch-Site"] is "cross-site" || request.Url?.Host != "127.0.0.1") {
            await JsonAsync(response, new { error = "Same-origin command requests only" }, 403); return;
        }
        if (request.ContentType?.Split(';')[0].Trim() != "application/json") { await JsonAsync(response, new { error = "Expected application/json" }, 415); return; }
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(stopping.Token);
        timeout.CancelAfter(TimeSpan.FromSeconds(5));
        using var buffer = new MemoryStream();
        var chunk = new byte[512]; int read;
        while ((read = await request.InputStream.ReadAsync(chunk, timeout.Token)) > 0) {
            if (buffer.Length + read > 512) { await JsonAsync(response, new { error = "Body too large" }, 413); return; }
            buffer.Write(chunk, 0, read);
        }
        try {
            var input = JsonSerializer.Deserialize<CommandRequest>(buffer.ToArray(), ConsoleState.Json);
            var command = state.Config.Commands?.FirstOrDefault(c => c.Name == input?.Name);
            if (command == null) { await JsonAsync(response, new { error = "Unknown saved command. Configure it in Settings first." }, 400); return; }
            var result = await commands.RunAsync(command, stopping.Token);
            state.Session.Update(new(Lines: [new(result.Output, result.Success ? "output" : "error")]));
            await JsonAsync(response, result);
        } catch (JsonException) { await JsonAsync(response, new { error = "Invalid JSON" }, 400); }
    }

    async Task EventsAsync(HttpListenerResponse response)
    {
        response.ContentType = "text/event-stream; charset=utf-8";
        response.SendChunked = true;
        string? lastRevision = null;
        var sessionEvent = Encoding.UTF8.GetBytes($"event: session\ndata: {JsonSerializer.Serialize(new { id = state.Session.Id }, ConsoleState.Json)}\n\n");
        await response.OutputStream.WriteAsync(sessionEvent, stopping.Token);
        while (!stopping.IsCancellationRequested)
        {
            var config = state.PublicConfig;
            var revision = $"{state.ConfigRevision}:{config.StartAtLogin}";
            if (revision != lastRevision)
            {
                var configEvent = Encoding.UTF8.GetBytes($"event: config\ndata: {JsonSerializer.Serialize(new { revision, config }, ConsoleState.Json)}\n\n");
                await response.OutputStream.WriteAsync(configEvent, stopping.Token);
                lastRevision = revision;
            }
            var bytes = Encoding.UTF8.GetBytes($"data: {JsonSerializer.Serialize(state.LiveSnapshot, ConsoleState.Json)}\n\n");
            await response.OutputStream.WriteAsync(bytes, stopping.Token);
            await response.OutputStream.FlushAsync(stopping.Token);
            await Task.Delay(2000, stopping.Token);
        }
    }

    async Task FileAsync(string path, bool head, HttpListenerResponse response)
    {
        var relative = Uri.UnescapeDataString(path).Replace('/', Path.DirectorySeparatorChar).TrimStart(Path.DirectorySeparatorChar);
        var file = Path.GetFullPath(Path.Combine(root, relative));
        if (!file.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) && file != root)
        { response.StatusCode = 403; return; }
        if (path is "/" or "/settings") file = Path.Combine(root, "index.html");
        if (!File.Exists(file)) { response.StatusCode = 404; return; }
        response.ContentType = Path.GetExtension(file).ToLowerInvariant() switch {
            ".html" => "text/html; charset=utf-8", ".js" => "text/javascript; charset=utf-8",
            ".css" => "text/css; charset=utf-8", ".json" => "application/json; charset=utf-8",
            ".svg" => "image/svg+xml", ".png" => "image/png", ".ico" => "image/x-icon",
            ".woff" => "font/woff", ".woff2" => "font/woff2", _ => "application/octet-stream"
        };
        response.Headers["Cache-Control"] = "no-cache";
        await using var stream = File.OpenRead(file);
        response.ContentLength64 = stream.Length;
        if (!head) await stream.CopyToAsync(response.OutputStream, stopping.Token);
    }

    static async Task JsonAsync(HttpListenerResponse response, object value, int status = 200)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(value, ConsoleState.Json);
        response.StatusCode = status;
        response.ContentType = "application/json; charset=utf-8";
        response.ContentLength64 = bytes.Length;
        await response.OutputStream.WriteAsync(bytes);
    }

    public async ValueTask DisposeAsync()
    {
        stopping.Cancel();
        listener.Close();
        if (acceptLoop != null) await acceptLoop.ConfigureAwait(false);
        try { await Task.WhenAll(requests.Values).WaitAsync(TimeSpan.FromSeconds(5)).ConfigureAwait(false); } catch (TimeoutException) { }
        stopping.Dispose();
    }
}
