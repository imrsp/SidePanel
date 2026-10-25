param(
    [string]$ProjectRoot,
    [Parameter(Mandatory)][string]$Staging,
    [string]$Output
)
$ErrorActionPreference = 'Stop'
if (!$ProjectRoot) { $ProjectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent }
if (!$Output) {
    $project = [xml](Get-Content -LiteralPath (Join-Path $ProjectRoot 'backend/SidePanel.csproj') -Raw)
    $version = [string]$project.Project.PropertyGroup.Version | Where-Object { $_ } | Select-Object -First 1
    if (!$version) { throw 'Could not read package version from backend/SidePanel.csproj.' }
    $Output = Join-Path $ProjectRoot "releases/SidePanel-v$version-win-x64.zip"
}
if (!(Test-Path -LiteralPath $Staging)) { throw "Missing staging directory: $Staging" }
if (!(Test-Path -LiteralPath (Join-Path $Staging 'SidePanel.exe'))) { throw "Staging directory has no SidePanel.exe: $Staging" }
if (Test-Path -LiteralPath (Join-Path $Staging 'data')) { throw 'Publish output must not contain runtime data.' }
$outputDir = Split-Path $Output -Parent
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
$zipTemp = Join-Path $outputDir ('SidePanel-' + [guid]::NewGuid().ToString('N') + '.zip')
$zipStream = [IO.File]::Open($zipTemp, [IO.FileMode]::Create)
try {
    $archive = [IO.Compression.ZipArchive]::new($zipStream, [IO.Compression.ZipArchiveMode]::Create)
    try {
        $stagingRoot = (Resolve-Path -LiteralPath $Staging).Path
        Get-ChildItem -LiteralPath $stagingRoot -Recurse -File | ForEach-Object {
            $relative = $_.FullName.Substring($stagingRoot.Length + 1).Replace('\', '/')
            [void][IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $relative, [IO.Compression.CompressionLevel]::Optimal)
        }
    } finally { $archive.Dispose() }
} finally { $zipStream.Dispose() }
Move-Item -LiteralPath $zipTemp -Destination $Output -Force
Write-Output "Package: $Output"
