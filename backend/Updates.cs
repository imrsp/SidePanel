using System.Net;
using System.Reflection;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace SidePanel;

public record UpdateResult(string Status, string CurrentVersion, string Message, string? LatestVersion = null, string? ReleaseUrl = null, DateTimeOffset? CheckedAt = null);

public sealed class UpdateChecker
{
    static readonly HttpClient SharedClient = new(new HttpClientHandler { AllowAutoRedirect = false }) { Timeout = TimeSpan.FromSeconds(10) };
    public static string AppVersion => typeof(UpdateChecker).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()!.InformationalVersion.Split('+')[0];
    public static string RepositoryUrl => typeof(UpdateChecker).Assembly.GetCustomAttributes<AssemblyMetadataAttribute>().FirstOrDefault(x => x.Key == "RepositoryUrl")?.Value ?? "";
    readonly HttpClient client;
    readonly string repositoryUrl;
    readonly string currentVersion;

    public UpdateChecker(HttpClient? client = null, string? repositoryUrl = null, string? currentVersion = null)
    {
        this.client = client ?? SharedClient;
        this.repositoryUrl = repositoryUrl ?? RepositoryUrl;
        this.currentVersion = currentVersion ?? AppVersion;
    }

    static bool TryVersion(string value, out Version version)
    {
        // Stable release tags are vMAJOR.MINOR.PATCH (optional build metadata).
        var match = Regex.Match(value, @"^[vV]?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$", RegexOptions.CultureInvariant);
        version = new Version(0, 0, 0);
        return match.Success && Version.TryParse($"{match.Groups[1].Value}.{match.Groups[2].Value}.{match.Groups[3].Value}", out version!);
    }

    public async Task<UpdateResult> CheckAsync(CancellationToken cancellationToken = default)
    {
        UpdateResult Result(string status, string message, string? latest = null, string? url = null) =>
            new(status, currentVersion, message, latest, url, DateTimeOffset.UtcNow);
        if (!Uri.TryCreate(repositoryUrl, UriKind.Absolute, out var repository) ||
            repository.Scheme != "https" || repository.Host != "github.com" || !repository.IsDefaultPort ||
            repository.UserInfo.Length != 0 || repository.Query.Length != 0 || repository.Fragment.Length != 0 ||
            !Regex.IsMatch(repository.AbsolutePath, @"^/[A-Za-z0-9_-]+/[A-Za-z0-9_.-]+/?$"))
            return Result("unconfigured", "此版本尚未配置有效的更新地址。");
        var path = repository.AbsolutePath.Trim('/');
        if (!TryVersion(currentVersion, out var current)) return Result("error", "无法识别当前版本号，请到项目发行页面查看更新。");
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeout.CancelAfter(TimeSpan.FromSeconds(10));
            using var request = new HttpRequestMessage(HttpMethod.Get, $"https://api.github.com/repos/{path}/releases/latest");
            request.Headers.UserAgent.ParseAdd($"SidePanel/{currentVersion}");
            request.Headers.Accept.ParseAdd("application/vnd.github+json");
            request.Headers.Add("X-GitHub-Api-Version", "2026-03-10");
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, timeout.Token);
            if (response.StatusCode == HttpStatusCode.NotFound)
                return Result("unpublished", "暂无可用的公开正式发行版，请在项目发布 Release 后重试。");
            if (response.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.TooManyRequests)
                return Result("error", "GitHub 暂时拒绝了请求，可能已达到访问频率限制，请稍后重试。");
            if (!response.IsSuccessStatusCode) return Result("error", $"更新服务暂不可用（HTTP {(int)response.StatusCode}），请稍后重试。");
            const int limit = 1024 * 1024;
            if (response.Content.Headers.ContentLength > limit) return Result("error", "更新信息过大，无法读取。");
            using var input = await response.Content.ReadAsStreamAsync(timeout.Token);
            using var buffer = new MemoryStream();
            var chunk = new byte[8192];
            int read;
            while ((read = await input.ReadAsync(chunk, timeout.Token)) > 0)
            {
                if (buffer.Length + read > limit) return Result("error", "更新信息过大，无法读取。");
                buffer.Write(chunk, 0, read);
            }
            using var document = JsonDocument.Parse(buffer.ToArray());
            var release = document.RootElement;
            if (release.ValueKind != JsonValueKind.Object ||
                !release.TryGetProperty("tag_name", out var tagValue) || tagValue.ValueKind != JsonValueKind.String ||
                !release.TryGetProperty("draft", out var draft) || draft.ValueKind != JsonValueKind.False ||
                !release.TryGetProperty("prerelease", out var prerelease) || prerelease.ValueKind != JsonValueKind.False)
                return Result("error", "未获取到有效的正式发行版信息，请稍后重试。");
            var tag = tagValue.GetString()!;
            if (!TryVersion(tag, out var latest)) return Result("error", "无法识别发行版的版本号，请到项目发行页面查看。");
            var releaseUrl = $"https://github.com/{path}/releases/tag/{Uri.EscapeDataString(tag)}";
            return latest > current
                ? Result("available", $"发现新版本 v{latest}，可前往发行页面下载。", latest.ToString(), releaseUrl)
                : Result("current", latest == current ? $"当前已是最新版本 v{currentVersion}。" : $"当前版本 v{currentVersion} 高于最新公开版本 v{latest}，无需更新。", latest.ToString());
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        { return Result("error", "检查更新超时，请检查网络后重试。"); }
        catch (HttpRequestException)
        { return Result("error", "无法连接 GitHub，请检查网络后重试。"); }
        catch (IOException)
        { return Result("error", "读取更新信息失败，请检查网络后重试。"); }
        catch (JsonException)
        { return Result("error", "更新服务返回了无法解析的信息，请稍后重试。"); }
    }
}
