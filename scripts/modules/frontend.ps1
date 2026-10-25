param(
    [string]$ProjectRoot
)
$ErrorActionPreference = 'Stop'
if (!$ProjectRoot) { $ProjectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent }
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'common.ps1')
Assert-Toolchain -Tools @('node', 'pnpm')
Push-Location (Join-Path $ProjectRoot 'frontend')
try {
    pnpm install --frozen-lockfile
    if ($LASTEXITCODE) { throw 'Dependency installation failed' }
    node node_modules/typescript/bin/tsc --noEmit
    if ($LASTEXITCODE) { throw 'Type checking failed' }
    node node_modules/vite/bin/vite.js build
    if ($LASTEXITCODE) { throw 'Frontend build failed' }
} finally { Pop-Location }
Write-Output "Frontend built: $(Join-Path $ProjectRoot 'backend/wwwroot')"


