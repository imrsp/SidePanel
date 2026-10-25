param(
    [string]$ProjectRoot,
    [string]$Configuration = 'Release',
    [string]$Staging
)
$ErrorActionPreference = 'Stop'
if (!$ProjectRoot) { $ProjectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent }
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'common.ps1')
Assert-Toolchain -Tools @('dotnet')
if (!$Staging) {
    $Staging = Join-Path $ProjectRoot ('work/publish-' + [guid]::NewGuid().ToString('N'))
}
Publish-Backend -ProjectRoot $ProjectRoot -Configuration $Configuration -Staging $Staging
if (Test-Path -LiteralPath (Join-Path $Staging 'data')) { throw 'Publish output must not contain runtime data.' }
Write-Output "Backend staged: $Staging"


