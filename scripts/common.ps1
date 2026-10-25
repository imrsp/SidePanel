# Shared helpers for build and deploy modules.
# Dot-source this file; keep compatible with Windows PowerShell 5.1.

function Assert-Toolchain {
    param([Parameter(Mandatory)][string[]]$Tools)
    foreach ($tool in $Tools) {
        if (!(Get-Command $tool -ErrorAction SilentlyContinue)) {
            throw "Missing required tool '$tool'. See docs/DEVELOPMENT.md for the environment setup."
        }
    }
}

function Publish-Backend {
    param(
        [Parameter(Mandatory)][string]$ProjectRoot,
        [Parameter(Mandatory)][string]$Configuration,
        [Parameter(Mandatory)][string]$Staging
    )
    dotnet publish (Join-Path $ProjectRoot 'backend/SidePanel.csproj') -c $Configuration -r win-x64 --self-contained false -o $Staging
    if ($LASTEXITCODE) { throw 'Publish failed.' }
}

function Install-ProgramFiles {
    param(
        [Parameter(Mandatory)][string]$Staging,
        [Parameter(Mandatory)][string]$Target
    )
    if (!(Test-Path -LiteralPath (Join-Path $Staging 'SidePanel.exe'))) {
        throw "Staging directory has no SidePanel.exe: $Staging"
    }
    $preserve = @('data', 'wallpaper')
    New-Item -ItemType Directory -Path $Target -Force | Out-Null
    Get-ChildItem -LiteralPath $Target -Force |
        Where-Object { $_.Name -notin $preserve } |
        Remove-Item -Recurse -Force
    Get-ChildItem -LiteralPath $Staging -Force |
        Where-Object { $_.Name -notin $preserve } |
        Copy-Item -Destination $Target -Recurse -Force
    Write-Output "Program files installed: $Target"
}

function Get-NormalizedFullPath {
    param([Parameter(Mandatory)][string]$Path)
    $full = [IO.Path]::GetFullPath($Path)
    $root = [IO.Path]::GetPathRoot($full)
    if ($full.Length -gt $root.Length) { $full = $full.TrimEnd('\','/') }
    return $full
}

function Resolve-DeploymentTarget {
    param([Parameter(Mandatory)][string]$Path,[Parameter(Mandatory)][string]$ProjectRoot,[Parameter(Mandatory)][string]$DistPath)
    if (![IO.Path]::IsPathRooted($Path)) { throw 'InstallPath must be an absolute path.' }
    $target = Get-NormalizedFullPath $Path
    $root = Get-NormalizedFullPath $ProjectRoot
    $dist = Get-NormalizedFullPath $DistPath
    foreach ($parent in @((Split-Path $target -Parent), $target)) {
        if (Test-Path -LiteralPath $parent) {
            $parentItem = Get-Item -LiteralPath $parent -Force
            if ($parentItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "InstallPath traverses a reparse point: $parent" }
        }
    }
    if ($target -ieq $root -or $target.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'InstallPath must be outside the project directory.' }
    if ($target -ieq $dist -or $target.StartsWith($dist + '\', [StringComparison]::OrdinalIgnoreCase) -or $dist.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'InstallPath must not overlap dist.' }
    if (Test-Path -LiteralPath $target) {
        $item = Get-Item -LiteralPath $target -Force
        if (!$item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "InstallPath must be a real directory: $target" }
        $entries = @(Get-ChildItem -LiteralPath $target -Force)
        if ($entries.Count -gt 0 -and !(Test-Path -LiteralPath (Join-Path $target 'SidePanel.exe'))) { throw "InstallPath is not empty and has no SidePanel.exe: $target" }
    }
    return $target
}

function Get-PublishedAppProcesses {
    param([Parameter(Mandatory)][string]$DistPath)
    $exe = Get-NormalizedFullPath (Join-Path $DistPath 'SidePanel.exe')
    return @(Get-Process SidePanel -ErrorAction SilentlyContinue | Where-Object { try { (Get-NormalizedFullPath $_.Path) -ieq $exe } catch { $false } })
}

function Stop-PublishedApp {
    param([Parameter(Mandatory)][string]$DistPath)
    $running = @(Get-PublishedAppProcesses -DistPath $DistPath)
    if (!$running) { return $false }
    foreach ($process in $running) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
    }
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        if (!(Get-PublishedAppProcesses -DistPath $DistPath)) { break }
        Start-Sleep -Milliseconds 200
    }
    if (Get-PublishedAppProcesses -DistPath $DistPath) {
        throw 'Could not stop the running SidePanel process.'
    }
    return $true
}

function Start-PublishedApp {
    param([Parameter(Mandatory)][string]$DistPath)
    $exe = Join-Path $DistPath 'SidePanel.exe'
    $dll = Join-Path $DistPath 'SidePanel.dll'
    if (!(Test-Path -LiteralPath $exe)) { throw "Missing published application: $exe" }
    Start-Process -FilePath $exe -WorkingDirectory $DistPath | Out-Null
    Start-Sleep -Seconds 3
    if (Get-PublishedAppProcesses -DistPath $DistPath) { return 'exe' }
    # Some systems restrict unsigned executables; the Microsoft-signed dotnet host runs the same DLL.
    $dotnet = (Get-Command dotnet -ErrorAction SilentlyContinue).Source
    if (!$dotnet) { throw 'Published application exited and dotnet host is unavailable.' }
    Start-Process -FilePath $dotnet -ArgumentList ('"' + $dll + '"') -WorkingDirectory $DistPath | Out-Null
    Start-Sleep -Seconds 3
    if (!(Get-PublishedAppProcesses -DistPath $DistPath)) { throw 'Published application failed to start (exe and dotnet host).' }
    return 'dotnet'
}

function Replace-DistDirectory {
    param(
        [Parameter(Mandatory)][string]$Staging,
        [Parameter(Mandatory)][string]$ProjectRoot,
        [Parameter(Mandatory)][string]$DistPath
    )
    $archive = $null
    if (Test-Path -LiteralPath $DistPath) {
        $resolved = (Resolve-Path -LiteralPath $DistPath).Path
        if ((Split-Path $resolved -Parent) -ne (Resolve-Path -LiteralPath $ProjectRoot).Path) {
            throw "Invalid publish directory: $resolved"
        }
        foreach ($preserve in @('data', 'wallpaper')) {
            $source = Join-Path $resolved $preserve
            if (Test-Path -LiteralPath $source) {
                Copy-Item -LiteralPath $source -Destination $Staging -Recurse
            }
        }
        $archiveParent = Join-Path $ProjectRoot 'work'
        New-Item -ItemType Directory -Path $archiveParent -Force | Out-Null
        $archive = Join-Path $archiveParent ('previous-dist-' + [guid]::NewGuid().ToString('N'))
        Move-Item -LiteralPath $resolved -Destination $archive
    }
    Move-Item -LiteralPath $Staging -Destination $DistPath
    if ($archive) {
        # Only used to order backups; a file handle released late by the stopped app must not fail the deploy.
        for ($attempt = 0; $attempt -lt 10; $attempt++) {
            try {
                (Get-Item -LiteralPath $archive).LastWriteTimeUtc = [DateTime]::UtcNow
                break
            } catch {
                Start-Sleep -Milliseconds 200
            }
        }
    }
}

function Remove-OldDistBackups {
    param(
        [Parameter(Mandatory)][string]$WorkDirectory,
        [ValidateRange(0, 1000)][int]$Keep = 5
    )
    $root = (Resolve-Path -LiteralPath $WorkDirectory).Path
    $backups = @(Get-ChildItem -LiteralPath $root -Directory -Filter 'previous-dist-*' |
        Where-Object { $_.Name -cmatch '^previous-dist-[0-9a-f]{32}$' } |
        Sort-Object LastWriteTimeUtc -Descending)
    foreach ($backup in ($backups | Select-Object -Skip $Keep)) {
        $target = (Resolve-Path -LiteralPath $backup.FullName).Path
        if ((Split-Path $target -Parent) -ne $root -or
            ($backup.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "Unsafe backup cleanup target: $target"
        }
        Remove-Item -LiteralPath $target -Recurse -Force
        Write-Output "Removed old publish backup: $($backup.Name)"
    }
}
