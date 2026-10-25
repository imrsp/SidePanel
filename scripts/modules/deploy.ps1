param(
    [string]$ProjectRoot,
    [Parameter(Mandatory)][string]$Staging,
    [string]$InstallPath,
    [ValidateRange(0, 1000)][int]$KeepBackups = 5
)
$ErrorActionPreference = 'Stop'
if (!$ProjectRoot) { $ProjectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent }
if (!(Test-Path -LiteralPath $Staging)) { throw "Missing staging directory: $Staging" }
if (!(Test-Path -LiteralPath (Join-Path $Staging 'SidePanel.exe'))) { throw "Staging directory has no SidePanel.exe: $Staging" }
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'common.ps1')
$distPath = Join-Path $ProjectRoot 'dist'

if ($InstallPath) {
    $installPath = Resolve-DeploymentTarget -Path $InstallPath -ProjectRoot $ProjectRoot -DistPath $distPath
    $null = Stop-PublishedApp -DistPath $installPath
    Install-ProgramFiles -Staging $Staging -Target $installPath
    $mode = Start-PublishedApp -DistPath $installPath
    Write-Output "Deployed: $installPath (data and wallpaper preserved; started via $mode)"
    return
}

$running = @(Get-PublishedAppProcesses -DistPath $distPath)
if ($running.Count -gt 0) {
    throw "dist is in use (PID $($running.Id -join ',')). Stop it first; -InstallPath is the only automatic stop/start path."
}
Replace-DistDirectory -Staging $Staging -ProjectRoot $ProjectRoot -DistPath $distPath
$workDirectory = Join-Path $ProjectRoot 'work'
if (Test-Path -LiteralPath $workDirectory) {
    try { Remove-OldDistBackups -WorkDirectory $workDirectory -Keep $KeepBackups }
    catch { Write-Warning "Deployment succeeded, but old backup cleanup failed: $($_.Exception.Message)" }
}
Write-Output "Deployed: $distPath (data and wallpaper preserved; not started)"
