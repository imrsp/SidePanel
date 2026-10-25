using System.Diagnostics;
using SidePanel;

internal static class Program
{
    [STAThread]
    static void Main(string[] args)
    {
        AppLog.ConfigureFromSettings(ConsoleState.DataPath);
        AppLog.Info("Application starting", new { autostart = args.Contains("--autostart"), executable = Environment.ProcessPath, workingDirectory = Environment.CurrentDirectory });
        AppDomain.CurrentDomain.UnhandledException += (_, e) => AppLog.Error("Unhandled application exception", e.ExceptionObject as Exception);
        var mutexName = $"Local\\SidePanel{(Environment.GetEnvironmentVariable("SIDE_PANEL_PORT") ?? "3220")}";
        using var mutex = new Mutex(true, mutexName, out var first);
        if (!first) { AppLog.Warn("A second application instance was started; exiting."); return; }
        ApplicationConfiguration.Initialize();
        var state = new ConsoleState();
        AppLog.SetLevel(state.Config.LogLevel);
        if (args.Contains("--verify-tray")) AppLog.SetLevel("Info");
        Application.ThreadException += (_, e) => AppLog.Error("Unhandled UI thread exception", e.Exception);
        var port = int.TryParse(Environment.GetEnvironmentVariable("SIDE_PANEL_PORT"), out var configuredPort) && configuredPort is > 0 and < 65536 ? configuredPort : 3220;
        var server = new LocalServer(state, port);
        using var stopping = new CancellationTokenSource();
        Task collector = Task.CompletedTask;
        using var iconStream = typeof(Program).Assembly.GetManifestResourceStream("SidePanel.Assets.SidePanel.ico")!;
        using var appIcon = new System.Drawing.Icon(iconStream);
        var appUrl = $"http://127.0.0.1:{port}";
        using var tray = new NotifyIcon { Icon = appIcon, Text = $"SidePanel · localhost:{port}", Visible = true };
        var menu = new ContextMenuStrip();
        menu.Items.Add("打开 SidePanel", null, (_, _) => Open(appUrl));
        menu.Items.Add("设置", null, (_, _) => Open(appUrl + "/settings"));
        var startupItem = new ToolStripMenuItem("开机自启动") { Checked = StartupRegistration.Enabled };
        startupItem.Click += (_, _) => {
            try { state.SetStartAtLogin(!StartupRegistration.Enabled); startupItem.Checked = StartupRegistration.Enabled; }
            catch (Exception ex) { AppLog.Warn("Could not update startup registration", exception: ex); MessageBox.Show($"无法修改开机自启动：{ex.Message}", "SidePanel", MessageBoxButtons.OK, MessageBoxIcon.Error); }
        };
        menu.Items.Add(startupItem);
        menu.Opening += (_, _) => startupItem.Checked = StartupRegistration.Enabled;
        menu.Items.Add(new ToolStripSeparator());
        var exitItem = menu.Items.Add("退出", null, (_, _) => Application.Exit());
        tray.ContextMenuStrip = menu;
        tray.DoubleClick += (_, _) => Open(appUrl);
        try {
            server.Start();
            AppLog.Info("Application ready", new { port, trayVisible = tray.Visible });
            collector = Task.WhenAll(Task.Run(() => new Collector(state).RunAsync(stopping.Token)), Task.Run(() => state.HomeAssistant.RunAsync(stopping.Token)));
            using var verifyTimer = new System.Windows.Forms.Timer { Interval = 3000 };
            if(args.Contains("--verify-tray")) {
                verifyTimer.Tick += (_, _) => {
                    verifyTimer.Stop();
                    AppLog.Info("Tray verification completed", new { trayVisible = tray.Visible, menuItems = menu.Items.OfType<ToolStripMenuItem>().Select(i => i.Text), mainWindowHandle = Process.GetCurrentProcess().MainWindowHandle.ToInt64(), exitInvoked = true });
                    exitItem.PerformClick();
                };
                verifyTimer.Start();
            }
            Application.Run();
        } catch (Exception ex) {
            AppLog.Error("Application listener or UI initialization failed", ex);
            tray.ShowBalloonTip(5000, "SidePanel 启动失败", "请在设置页诊断区域下载日志以排查问题。", ToolTipIcon.Error);
        } finally {
            AppLog.Info("Application stopping");
            tray.Visible = false;
            stopping.Cancel();
            server.DisposeAsync().AsTask().GetAwaiter().GetResult();
            try { collector.Wait(TimeSpan.FromSeconds(10)); } catch (AggregateException e) when(e.InnerExceptions.All(x => x is OperationCanceledException)) { }
        }
    }
    static void Open(string url) => Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
}

