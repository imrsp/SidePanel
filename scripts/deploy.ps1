param(
    [string]$InstallPath,
    [ValidateRange(0, 1000)][int]$KeepBackups = 5
)
$ErrorActionPreference = 'Stop'
# Backend-only deployment. Omit -InstallPath to keep the default dist/ target.
$buildArgs = @{ BackendOnly = $true; KeepBackups = $KeepBackups }
if ($InstallPath) { $buildArgs.InstallPath = $InstallPath }
& (Join-Path $PSScriptRoot 'build.ps1') @buildArgs
