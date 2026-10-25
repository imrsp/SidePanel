param(
    [string]$ProjectFile = 'backend/SidePanel.csproj',
    [string]$ChangelogFile = 'Changelog.md',
    [string]$ArchiveName,
    [string]$OutputFile = 'work/release-metadata.json'
)
$ErrorActionPreference = 'Stop'
$project = [xml](Get-Content -LiteralPath $ProjectFile -Raw)
$version = [string]$project.Project.PropertyGroup.Version | Where-Object { $_ } | Select-Object -First 1
if (!$version) { throw "No Version value found in '$ProjectFile'." }
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "Version '$version' is not a stable three-part version." }
if (!$ArchiveName) { $ArchiveName = "SidePanel-v$version-win-x64.zip" }

$changelog = Get-Content -LiteralPath $ChangelogFile -Raw
$section = [regex]::Match($changelog, '(?ms)^##\s+(v' + [regex]::Escape($version) + '[^\r\n]*)\s*\r?\n(.*?)(?=^##\s|\z)')
if (!$section.Success) { throw "No Changelog.md section found for current version $version." }
$changelogTitle = $section.Groups[1].Value.Trim()
$body = $section.Groups[2].Value.Trim()
if (!$body) { throw "Changelog section '$changelogTitle' has no release description." }

$metadata = [ordered]@{
    version = $version
    tag = "v$version"
    title = "SidePanel $changelogTitle"
    body = $body
    archive = $ArchiveName
}
$outputDirectory = Split-Path -Parent $OutputFile
if ($outputDirectory -and !(Test-Path -LiteralPath $outputDirectory)) {
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
}
$json = $metadata | ConvertTo-Json -Depth 4
Set-Content -LiteralPath $OutputFile -Value $json -Encoding utf8

Write-Output 'GitHub Release preview:'
Write-Output "Tag:      $($metadata.tag)"
Write-Output "Title:    $($metadata.title)"
Write-Output "Archive:  $($metadata.archive)"
Write-Output 'Description:'
Write-Output $metadata.body
