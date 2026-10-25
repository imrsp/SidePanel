param(
    [Parameter(Mandatory)][string]$ProjectDirectory,
    [Parameter(Mandatory)][string]$Configuration,
    [Parameter(Mandatory)][string]$TargetFramework
)
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath $ProjectDirectory).Path
$repository = (Resolve-Path -LiteralPath (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent)).Path
$backend = Join-Path $repository 'backend'
$tests = Join-Path $repository 'tests'
if ($project -ne $backend -and (Split-Path $project -Parent) -ne $tests) {
    Write-Output "Skipping cleanup outside build scope: $project"; return
}
$projectFiles = @(Get-ChildItem -LiteralPath $project -File -Filter '*.csproj')
if (!$projectFiles) {
    throw "Missing project file: $project"
}
$projectName = [IO.Path]::GetFileNameWithoutExtension($projectFiles[0].Name)
foreach ($name in @($Configuration, $TargetFramework)) {
    if ($name -notmatch '^[a-zA-Z0-9_.-]+$' -or $name -in @('.', '..')) {
        throw "Invalid build directory name: $name"
    }
}
foreach ($kind in @('bin', 'obj')) {
    $root = Join-Path $project $kind
    if (!(Test-Path -LiteralPath $root)) { continue }
    if ((Get-Item -LiteralPath $root).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw "Refusing linked build directory: $root"
    }
    $obsolete = @()
    foreach ($config in Get-ChildItem -LiteralPath $root -Directory) {
        if ($config.Name -ne $Configuration) {
            $obsolete += $config
        } elseif (!($config.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            $obsolete += Get-ChildItem -LiteralPath $config.FullName -Directory |
                Where-Object { $_.Name -like 'net*' -and $_.Name -ne $TargetFramework }
        }
    }
    foreach ($directory in $obsolete) {
        $target = (Resolve-Path -LiteralPath $directory.FullName).Path
        if (!$target.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
            ($directory.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
            (Get-ChildItem -LiteralPath $target -Recurse -Force -Attributes ReparsePoint)) {
            throw "Unsafe build cleanup target: $target"
        }
        Remove-Item -LiteralPath $target -Recurse -Force
        Write-Output "Removed obsolete build output: $target"
    }
}
$objRoot = Join-Path $project 'obj'
if (!(Test-Path -LiteralPath $objRoot)) { return }
# NuGet writes restore metadata per project name; a rename leaves the old files behind.
Get-ChildItem -LiteralPath $objRoot -File -Filter '*.csproj.nuget.*' |
    Where-Object { $_.Name -notlike "$projectName.csproj.nuget.*" } |
    ForEach-Object {
        Remove-Item -LiteralPath $_.FullName -Force
        Write-Output "Removed stale NuGet file: $($_.FullName)"
    }
# Publish records only describe the newest publish; staged publishes always start from a fresh directory.
Get-ChildItem -LiteralPath $objRoot -Recurse -Force -File -Filter 'PublishOutputs.*.txt' |
    Group-Object { $_.Directory.FullName } |
    ForEach-Object {
        $_.Group | Sort-Object LastWriteTime -Descending | Select-Object -Skip 1 | ForEach-Object {
            Remove-Item -LiteralPath $_.FullName -Force
            Write-Output "Removed old publish record: $($_.FullName)"
        }
    }



