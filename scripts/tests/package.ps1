param([Parameter(Mandatory)][string]$Archive)
$ErrorActionPreference = 'Stop'
if (!(Test-Path -LiteralPath $Archive)) { throw "Release archive not found: $Archive" }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Archive).Path)
try {
    $names = @($zip.Entries | ForEach-Object { $_.FullName })
    foreach ($required in @('SidePanel.exe', 'SidePanel.dll', 'wwwroot/index.html', 'licenses/SidePanel-MIT.txt')) {
        if ($required -notin $names) { throw "Release archive is missing '$required'." }
    }
    if ($names | Where-Object { $_ -match '(^|/)(data|wallpaper)(/|$)' }) { throw 'Release archive contains user data.' }
    if ($names | Where-Object { $_ -match '\\' }) { throw 'Release archive contains Windows-style entry paths.' }
    Write-Output "Package check passed: $($names.Count) files in $Archive."
} finally { $zip.Dispose() }
