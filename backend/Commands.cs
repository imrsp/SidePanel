using System.Diagnostics;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace SidePanel;

public record CustomCommand(string Name, string Type, string Target, string Arguments = "", string WorkingDirectory = "")
{
    public static readonly string[] Builtins = ["help", "commands", "status", "clear", "refresh", "services", "ha", "weather", "uptime", "settings", "focus", "expand", "collapse"];
    public static bool NameValid(string? name) => name != null && Regex.IsMatch(name, "^[a-z][a-z0-9_-]{0,31}$") && !Builtins.Contains(name);
    public bool Valid() => NameValid(Name) && Type is "app" or "cmd" or "url" or "folder"
        && Target is { Length: > 0 and <= 4096 } && !string.IsNullOrWhiteSpace(Target) && !Target.Contains('\0')
        && Arguments is { Length: <= 2048 } && !Arguments.Contains('\0')
        && WorkingDirectory is { Length: <= 1024 } && !WorkingDirectory.Any(char.IsControl)
        && (Type != "url" || Uri.TryCreate(Target, UriKind.Absolute, out var uri) && uri.Scheme is "http" or "https")
        && (Type != "app" || Path.IsPathFullyQualified(Environment.ExpandEnvironmentVariables(Target)) && Path.GetExtension(Target).Equals(".exe", StringComparison.OrdinalIgnoreCase))
        && (Type != "folder" || Path.IsPathFullyQualified(Environment.ExpandEnvironmentVariables(Target)))
        && (WorkingDirectory == "" || Path.IsPathFullyQualified(Environment.ExpandEnvironmentVariables(WorkingDirectory)))
        && (Type is "app" or "cmd" || Arguments == "" && WorkingDirectory == "");
}
public record CommandRequest(string Name);
public record CommandResult(bool Success, string Output, int? ExitCode = null);

public sealed class CommandRunner
{
    readonly SemaphoreSlim gate = new(1);
    const int OutputLimit = 16_384;
    public async Task<CommandResult> RunAsync(CustomCommand command, CancellationToken token)
    {
        if (!command.Valid()) return new(false, "Invalid saved command.");
        if (!await gate.WaitAsync(0, token)) return new(false, "Another command is running. Try again when it finishes.");
        try {
            var target = Environment.ExpandEnvironmentVariables(command.Target);
            var directory = command.WorkingDirectory.Length > 0 ? Environment.ExpandEnvironmentVariables(command.WorkingDirectory) : AppContext.BaseDirectory;
            if (!Directory.Exists(directory)) return new(false, "Working directory does not exist.");
            if (command.Type is "url" or "folder") {
                if (command.Type == "folder" && !Directory.Exists(target)) return new(false, "Folder does not exist.");
                using var opened = Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
                return new(true, command.Type == "url" ? "Website opened." : "Folder opened.");
            }
            if (command.Type == "app") {
                if (!File.Exists(target)) return new(false, "Application does not exist.");
                using var opened = Process.Start(new ProcessStartInfo(target, command.Arguments) { UseShellExecute = false, WorkingDirectory = directory });
                return new(true, "Application launched.");
            }
            // Only the saved script is executed. Request input cannot supply shell text or arguments.
            Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
            var encoding = Encoding.GetEncoding(CultureInfo.CurrentCulture.TextInfo.OEMCodePage);
            var start = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "cmd.exe")) {
                Arguments = "/d /s /c \"" + command.Target + "\"", WorkingDirectory = directory,
                UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
                RedirectStandardInput = true, StandardOutputEncoding = encoding, StandardErrorEncoding = encoding
            };
            using var process = Process.Start(start) ?? throw new InvalidOperationException("Process could not start.");
            process.StandardInput.Close();
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
            timeout.CancelAfter(TimeSpan.FromSeconds(20));
            var output = new StringBuilder();
            var truncated = false;
            async Task Drain(StreamReader reader) {
                var chunk = new char[1024];
                int length;
                while ((length = await reader.ReadAsync(chunk.AsMemory(), timeout.Token)) > 0) {
                    lock (output) {
                        var remaining = OutputLimit - output.Length;
                        if (length > remaining) truncated = true;
                        if (remaining > 0) output.Append(chunk, 0, Math.Min(length, remaining));
                    }
                }
            }
            var drain = Task.WhenAll(Drain(process.StandardOutput), Drain(process.StandardError));
            try {
                await process.WaitForExitAsync(timeout.Token);
                await drain;
            } catch (OperationCanceledException) {
                try { process.Kill(entireProcessTree: true); } catch (InvalidOperationException) { }
                try { await drain; } catch (OperationCanceledException) { }
                return new(false, output + "\nCommand stopped after 20 seconds or server shutdown.");
            }
            var text = output.ToString().TrimEnd();
            if (truncated) text += "\n[Output truncated at 16 KB]";
            return new(process.ExitCode == 0, text.Length > 0 ? text : $"Command finished (exit {process.ExitCode}).", process.ExitCode);
        } catch (Exception e) when (e is System.ComponentModel.Win32Exception or IOException or InvalidOperationException or UnauthorizedAccessException) {
            return new(false, "Could not run command: " + e.Message);
        } finally { gate.Release(); }
    }
}
