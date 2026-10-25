param(
    [Parameter(Mandatory)][string]$AppDirectory,
    [int]$Port = 0
)
$ErrorActionPreference = 'Stop'
$exe = Join-Path $AppDirectory 'SidePanel.exe'
if (!(Test-Path -LiteralPath $exe)) { throw "Published app not found: $exe" }
if ($Port -eq 0) {
    $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $probe.Start(); $Port = $probe.LocalEndpoint.Port; $probe.Stop()
}
$repoRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$runRoot = Join-Path $repoRoot ('work/smoke-' + [guid]::NewGuid().ToString('N'))
$data = Join-Path $runRoot 'data'
New-Item -ItemType Directory -Path (Split-Path $runRoot -Parent) -Force | Out-Null
New-Item -ItemType Directory -Path $data -Force | Out-Null
$process = $null
$smokeSucceeded = $false
try {
    $stdout = Join-Path $runRoot 'stdout.log'
    $stderr = Join-Path $runRoot 'stderr.log'
    $process = Start-Process -FilePath $exe -WorkingDirectory $AppDirectory -PassThru -RedirectStandardOutput $stdout -RedirectStandardError $stderr -Environment @{ SIDE_PANEL_DATA = $data; SIDE_PANEL_PORT = [string]$Port }
    $base = "http://127.0.0.1:$Port"
    $ready = $false
    $listenerDenied = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        if ($process.HasExited) {
            $log = Join-Path $data 'sidepanel.log'
            $details = if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Raw } else { '' }
            if (Test-Path -LiteralPath $stderr) { $details += Get-Content -LiteralPath $stderr -Raw }
    if ($details -match 'HttpListenerException \(6\)|handle is invalid' -and $env:CODEX_WINDOWS_SANDBOX_PACKAGE_FAMILY) { $listenerDenied = $true; break }
            throw "SidePanel exited during startup (code $($process.ExitCode)). $details"
        }
        try {
            $app = Invoke-RestMethod -Uri "$base/api/v1/app" -TimeoutSec 2
            if (!$app.version -or !$app.repositoryUrl) { throw 'Application info response is incomplete.' }
            $ready = $true; break
        } catch { Start-Sleep -Milliseconds 500 }
    }
    if ($listenerDenied) {
        Write-Warning 'HTTP smoke check skipped: this host denies the app local HTTP listener. GitHub Windows runners must pass this check.'
        return
    }
    if (!$ready) { throw 'SidePanel did not become ready on its loopback HTTP port.' }
    $page = Invoke-WebRequest -Uri "$base/" -TimeoutSec 5
    if ($page.StatusCode -ne 200 -or $page.Content -notmatch '<html') { throw 'The published home page did not load.' }
    $config = Invoke-RestMethod -Uri "$base/api/v1/config" -TimeoutSec 5
    if ($null -eq $config) { throw 'The configuration API returned no response.' }
    Write-Output "Smoke test passed: app $($app.version), port $Port, home page and config API responded."
    $smokeSucceeded = $true
} finally {
    if ($process -and !$process.HasExited) { Stop-Process -Id $process.Id -Force; $process.WaitForExit() }
    if ($smokeSucceeded) {
        Remove-Item -LiteralPath $runRoot -Recurse -Force -ErrorAction SilentlyContinue
    } else {
        Write-Warning "Smoke test diagnostics retained at $runRoot."
    }
}
