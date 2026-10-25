param(
    [string]$ProjectRoot,
    [string]$OutputDirectory,
    [string]$CacheFrom
)
$ErrorActionPreference = 'Stop'
if (!$ProjectRoot) { $ProjectRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent }
if (!$OutputDirectory) { $OutputDirectory = Join-Path $ProjectRoot 'dist' }
# Rebuild licenses from the current lock file, current shipped assets and the
# three external notices. Only those external notices may come from CacheFrom;
# the old licenses directory is never copied wholesale, so removed packages
# cannot leave stale files in the release.
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$licenseDir = Join-Path $OutputDirectory 'licenses'
$tempLicenseDir = Join-Path $OutputDirectory ('.licenses-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tempLicenseDir -Force | Out-Null
try {
    Copy-Item (Join-Path $ProjectRoot 'LICENSE') (Join-Path $tempLicenseDir 'SidePanel-MIT.txt')
    $frontendLock = Get-Content (Join-Path $ProjectRoot 'frontend/pnpm-lock.yaml') -Raw
    foreach ($entry in @(@("'lit'",'lit','Lit-BSD.txt'),@("'@fontsource/share-tech-mono'",'@fontsource/share-tech-mono','ShareTechMono-OFL.txt'),@("'@fontsource/vt323'",'@fontsource/vt323','VT323-OFL.txt'))) {
        if ($frontendLock -notmatch ('(?m)^      ' + [regex]::Escape($entry[0]) + ':$')) { continue }
        $licensePath = Join-Path $ProjectRoot "frontend/node_modules/$($entry[1])/LICENSE"
        if (!(Test-Path -LiteralPath $licensePath)) { throw "Missing frontend license for $($entry[1]): $licensePath" }
        Copy-Item -LiteralPath $licensePath -Destination (Join-Path $tempLicenseDir $entry[2])
    }
    $lock = Get-Content (Join-Path $ProjectRoot 'backend/packages.lock.json') -Raw | ConvertFrom-Json
    $packageCache = if ($env:NUGET_PACKAGES) { $env:NUGET_PACKAGES } else { Join-Path $env:USERPROFILE '.nuget/packages' }
    $notice = [System.Collections.Generic.List[string]]::new()
    $notice.Add('# NuGet dependency notices and source locations')
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $seen = @{}
    foreach ($target in $lock.dependencies.PSObject.Properties) {
        foreach ($dependency in $target.Value.PSObject.Properties) {
            if ($dependency.Value.type -eq 'Project') { continue }
            $name = $dependency.Name
            $version = $dependency.Value.resolved
            $key = "$name/$version"
            if ($seen.ContainsKey($key)) { continue }
            $seen[$key] = $true
            $dir = Join-Path $packageCache "$($name.ToLowerInvariant())/$version"
            $nuspec = Get-ChildItem -LiteralPath $dir -Filter '*.nuspec' | Select-Object -First 1
            if (!$nuspec) { throw "Missing nuspec for $key in $dir" }
            [xml]$xml = Get-Content -LiteralPath $nuspec.FullName
            $meta = $xml.package.metadata
            $notice.Add("`n## $key`nLicense: $($meta.license.InnerText)$($meta.license.'#text')`nLicense URL: $($meta.licenseUrl)`nProject: $($meta.projectUrl)`nSource: $($meta.repository.url) $($meta.repository.commit)`nCopyright: $($meta.copyright)")
            Copy-Item -LiteralPath $nuspec.FullName -Destination (Join-Path $tempLicenseDir "$name-$version.nuspec")
            $package = Get-ChildItem -LiteralPath $dir -Filter '*.nupkg' | Select-Object -First 1
            if (!$package) { throw "Missing nupkg for $key in $dir" }
            $zip = [System.IO.Compression.ZipFile]::OpenRead($package.FullName)
            try {
                foreach ($entry in $zip.Entries) {
                    if ($entry.Name -match '^(LICENSE|LICENCE|COPYING|NOTICE|THIRD.PARTY)' -and $entry.Length -lt 2MB) {
                        $destination = Join-Path $tempLicenseDir "$name-$version-$($entry.Name)"
                        [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$destination,$true)
                    }
                }
            } finally { $zip.Dispose() }
        }
    }
    $notice | Set-Content (Join-Path $tempLicenseDir 'NuGet-notices.md')
    foreach($entry in @(@('https://raw.githubusercontent.com/LibreHardwareMonitor/LibreHardwareMonitor/master/LICENSE','LibreHardwareMonitor-MPL-2.0.txt'),@('https://raw.githubusercontent.com/dotnet/runtime/main/LICENSE.TXT','dotnet-MIT.txt'),@('https://raw.githubusercontent.com/dotnet/runtime/main/THIRD-PARTY-NOTICES.TXT','dotnet-THIRD-PARTY-NOTICES.txt'))) {
        $destination=Join-Path $tempLicenseDir $entry[1]
        $cached=$null
        if ($CacheFrom) { $cached=Join-Path $CacheFrom $entry[1] }
        if (!$cached -or !(Test-Path -LiteralPath $cached)) { $cached = Join-Path $ProjectRoot "scripts/licenses/$($entry[1])" }
        if ($cached -and (Test-Path -LiteralPath $cached)) {
            Copy-Item -LiteralPath $cached -Destination $destination
        } else {
            throw "Missing cached third-party notice '$($entry[1])'. Restore it from the existing licenses directory before building; license collection does not download files."
        }
    }
    if (Test-Path -LiteralPath $licenseDir) {
        $resolvedOutput = (Resolve-Path -LiteralPath $OutputDirectory).Path
        $resolvedLicense = (Resolve-Path -LiteralPath $licenseDir).Path
        if ((Split-Path $resolvedLicense -Parent) -ne $resolvedOutput) {
            throw "Unsafe license cleanup target: $resolvedLicense"
        }
        Remove-Item -LiteralPath $resolvedLicense -Recurse -Force
    }
    Move-Item -LiteralPath $tempLicenseDir -Destination $licenseDir
    $tempLicenseDir = $null
} finally {
    if ($tempLicenseDir -and (Test-Path -LiteralPath $tempLicenseDir)) {
        Remove-Item -LiteralPath $tempLicenseDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
Write-Output "Licenses collected: $licenseDir"


