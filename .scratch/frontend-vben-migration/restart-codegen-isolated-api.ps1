param(
    [Parameter(Mandatory)] [string]$RuntimeRoot,
    [Parameter(Mandatory)] [string]$BuildRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$resolvedRoot = (Resolve-Path -LiteralPath $RuntimeRoot).Path.TrimEnd('\', '/')
$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/')
if ([IO.Path]::GetDirectoryName($resolvedRoot) -ne $temporaryRoot -or
    [IO.Path]::GetFileName($resolvedRoot) -notmatch '^adminnet-vben-[a-f0-9]{32}$' -or
    (Get-Item -LiteralPath $resolvedRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'The API runtime must be a direct owned temporary directory.'
}
$resolvedBuild = (Resolve-Path -LiteralPath $BuildRoot).Path.TrimEnd('\', '/')
if ([IO.Path]::GetDirectoryName($resolvedBuild) -ne $resolvedRoot -or
    [IO.Path]::GetFileName($resolvedBuild) -ne 'generated-api-build' -or
    (Get-Item -LiteralPath $resolvedBuild).Attributes -band [IO.FileAttributes]::ReparsePoint -or
    -not (Test-Path -LiteralPath (Join-Path $resolvedBuild 'Admin.NET.Web.Entry.dll'))) {
    throw 'The generated API build must be the owned runtime child.'
}
$marker = Get-Content -LiteralPath (Join-Path $resolvedRoot 'isolated-run.json') -Raw -Encoding UTF8 | ConvertFrom-Json -DateKind String
$postgres = Get-Content -LiteralPath (Join-Path $resolvedRoot 'isolated-postgres.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($marker.runtimeRoot -ne $resolvedRoot -or $postgres.runtimeRoot -ne $resolvedRoot -or
    $postgres.containerName -notmatch '^adminnet-vben-pg-[a-f0-9]{32}$') {
    throw 'The runtime and PostgreSQL markers must agree.'
}
$label = & docker inspect --format '{{ index .Config.Labels "adminnet.isolated-runtime" }}' $postgres.containerName
if ($LASTEXITCODE -ne 0 -or $label -ne $resolvedRoot) { throw 'The PostgreSQL ownership label must match.' }
$base = [uri]$marker.baseUrl
if ($base.Scheme -ne 'http' -or $base.Host -ne '127.0.0.1' -or $base.AbsolutePath -ne '/' -or $base.Query -or $base.Fragment) {
    throw 'The runtime API address must be the recorded local endpoint.'
}

# 正式停止脚本校验 PID 及启动时间，保留同一隔离 PostgreSQL 和证据。
& (Join-Path $PSScriptRoot 'stop-isolated-api.ps1') -RuntimeRoot $resolvedRoot
Get-ChildItem -LiteralPath $resolvedBuild -File | Where-Object {
    $_.Extension -in @('.dll', '.pdb') -or $_.Name.EndsWith('.deps.json') -or $_.Name.EndsWith('.runtimeconfig.json')
} | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $resolvedRoot $_.Name) -Force }

$apiProcess = $null
try {
    $apiProcess = Start-Process -FilePath (Get-Command dotnet).Source `
        -ArgumentList @('Admin.NET.Web.Entry.dll', '--environment', 'IsolatedIntegration') `
        -WorkingDirectory $resolvedRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $resolvedRoot 'generated-stdout.log') `
        -RedirectStandardError (Join-Path $resolvedRoot 'generated-stderr.log')
    [ordered]@{
        runtimeRoot = $resolvedRoot
        processId = $apiProcess.Id
        baseUrl = $marker.baseUrl
        startedAt = $apiProcess.StartTime.ToUniversalTime().ToString('O')
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $resolvedRoot 'isolated-run.json') -Encoding UTF8
    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    while ([DateTime]::UtcNow -lt $deadline) {
        $apiProcess.Refresh()
        if ($apiProcess.HasExited) { throw 'Generated isolated API exited; inspect its runtime logs.' }
        try {
            $response = Invoke-RestMethod -Uri ($marker.baseUrl + '/api/sysConfig/sysInfo') -TimeoutSec 3
            if ($response.code -eq 200) {
                Write-Output 'Ready: real sysConfig/sysInfo returned code 200.'
                return
            }
        }
        catch { Start-Sleep -Milliseconds 500 }
    }
    throw 'Generated isolated API readiness timed out; inspect its runtime logs.'
}
catch {
    if ($apiProcess -and -not $apiProcess.HasExited) {
        Stop-Process -Id $apiProcess.Id
        $apiProcess.WaitForExit()
    }
    throw
}
