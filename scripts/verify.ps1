$ErrorActionPreference = 'Stop'
$url = 'http://127.0.0.1:3220'
$first = Invoke-RestMethod "$url/api/v1/state"
Start-Sleep -Seconds 3
$second = Invoke-RestMethod "$url/api/v1/state"
if ([DateTimeOffset]$second.time -le [DateTimeOffset]$first.time) { throw 'Collector is not updating' }
foreach ($key in @('cpu','gpu','cpuPower','gpuPower','memory','download','upload')) {
    if ($null -eq $second.metrics.$key.value) { throw "Missing hardware metric: $key" }
}
if ($second.metrics.PSObject.Properties.Name -contains 'totalPower') { throw 'Unexpected estimated total power' }
$config = Invoke-RestMethod "$url/api/v1/config"
$invalid = $config | ConvertTo-Json -Depth 5 | ConvertFrom-Json
$invalid.theme = 'invalid-theme'
$response = Invoke-WebRequest "$url/api/v1/config" -Method Put -ContentType 'application/json' -Body ($invalid | ConvertTo-Json -Depth 5) -SkipHttpErrorCheck
if ($response.StatusCode -ne 400) { throw 'Invalid config accepted' }
$response = Invoke-WebRequest "$url/api/v1/config" -Method Put -Headers @{Origin='https://example.com'} -ContentType 'application/json' -Body ($config | ConvertTo-Json -Depth 5) -SkipHttpErrorCheck
if ($response.StatusCode -ne 403) { throw 'Cross-origin write accepted' }
foreach ($body in @('{', 'null', '{"version":1,"theme":"terminal","location":null}')) {
    $response = Invoke-WebRequest "$url/api/v1/config" -Method Put -ContentType 'application/json' -Body $body -SkipHttpErrorCheck
    if ($response.StatusCode -ne 400) { throw 'Malformed or incomplete config accepted' }
}
$response = Invoke-WebRequest "$url/api/v1/config" -Method Put -ContentType 'text/plain' -Body '{}' -SkipHttpErrorCheck
if ($response.StatusCode -ne 415) { throw 'Non-JSON config accepted' }
$response = Invoke-WebRequest "$url/api/v1/not-found" -SkipHttpErrorCheck
if ($response.StatusCode -ne 404) { throw 'Unknown API must return 404' }
$response = Invoke-WebRequest "$url/../SidePanel.runtimeconfig.json" -SkipHttpErrorCheck
if ($response.StatusCode -ne 404 -and $response.StatusCode -ne 403) { throw 'File outside wwwroot was exposed' }
$runtimeConfig = Get-Content (Join-Path $PSScriptRoot '../dist/SidePanel.runtimeconfig.json') -Raw | ConvertFrom-Json
if ($runtimeConfig.runtimeOptions.frameworks.name -contains 'Microsoft.AspNetCore.App') { throw 'ASP.NET runtime dependency remains' }
if ($runtimeConfig.runtimeOptions.frameworks.name -notcontains 'Microsoft.WindowsDesktop.App') { throw 'Desktop framework reference missing' }
$html = Invoke-WebRequest $url
if ($html.Content -notmatch 'sidepanel-app') { throw 'Published HTML missing' }
$diagnostics = Invoke-RestMethod "$url/api/v1/diagnostics"
if ($diagnostics.sensors.Count -lt 1) { throw 'No sensor diagnostics' }
Write-Output "PASS: collector updates; hardware metrics; no estimated total; invalid JSON/config 400; origin 403; content type 415; unknown API/path isolation; no ASP.NET dependency; HTML; $($diagnostics.sensors.Count) diagnostic sensors."
