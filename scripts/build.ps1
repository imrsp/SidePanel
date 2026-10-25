param(
    [switch]$BackendOnly,
    [string]$InstallPath,
    [ValidateRange(0, 1000)][int]$KeepBackups = 5
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot 'common.ps1')
$modules = Join-Path $PSScriptRoot 'modules'

if ($BackendOnly) {
    Assert-Toolchain -Tools @('dotnet')
    if (!(Test-Path -LiteralPath (Join-Path $projectRoot 'backend/wwwroot/index.html'))) {
        throw 'Missing backend/wwwroot/index.html. Run scripts/build.ps1 once to build the frontend.'
    }
} else {
    Assert-Toolchain -Tools @('node', 'pnpm', 'dotnet')
}

$staging = Join-Path $projectRoot ('work/publish-' + [guid]::NewGuid().ToString('N'))
$deployStarted = $false
try {
    if (!$BackendOnly) {
        & (Join-Path $modules 'frontend.ps1') -ProjectRoot $projectRoot
    }
    & (Join-Path $modules 'backend.ps1') -ProjectRoot $projectRoot -Configuration 'Release' -Staging $staging
    if (!$BackendOnly) {
        & (Join-Path $modules 'licenses.ps1') -ProjectRoot $projectRoot -OutputDirectory $staging -CacheFrom (Join-Path $projectRoot 'dist/licenses')
        & (Join-Path $modules 'package.ps1') -ProjectRoot $projectRoot -Staging $staging
    } else {
        $licenseSource = Join-Path $projectRoot 'dist/licenses'
        if (!(Test-Path -LiteralPath $licenseSource)) { throw 'Missing dist/licenses. Run a full build first to create the release license set.' }
        Copy-Item -LiteralPath $licenseSource -Destination (Join-Path $staging 'licenses') -Recurse
    }
    $deployStarted = $true
    $deployScript = Join-Path $modules 'deploy.ps1'
    if ($InstallPath) {
        & $deployScript -ProjectRoot $projectRoot -Staging $staging -InstallPath $InstallPath -KeepBackups $KeepBackups
    }
    & $deployScript -ProjectRoot $projectRoot -Staging $staging -KeepBackups $KeepBackups
} catch {
    # Never delete a staging directory after the deploy step started; it may be the only copy of the build.
    if (!$deployStarted -and (Test-Path -LiteralPath $staging)) {
        Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
    }
    throw
}
if (Test-Path -LiteralPath $staging) {
    Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Output 'Done.'
