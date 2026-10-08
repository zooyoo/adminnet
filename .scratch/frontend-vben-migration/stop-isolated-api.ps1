param(
    [Parameter(Mandatory)]
    [string]$RuntimeRoot,
    [switch]$RemoveRuntime
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$resolvedRoot = (Resolve-Path -LiteralPath $RuntimeRoot).Path.TrimEnd('\', '/')
$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\', '/')
if ([IO.Path]::GetDirectoryName($resolvedRoot) -ne $temporaryRoot -or
    [IO.Path]::GetFileName($resolvedRoot) -notmatch '^adminnet-vben-[a-f0-9]{32}$') {
    throw 'The target must be a direct isolated-run directory under the temporary directory.'
}
if ((Get-Item -LiteralPath $resolvedRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'Refusing to clean a reparse point.'
}
$marker = Get-Content -LiteralPath (Join-Path $resolvedRoot 'isolated-run.json') -Raw -Encoding UTF8 | ConvertFrom-Json -DateKind String
if ([IO.Path]::GetFullPath($marker.runtimeRoot).TrimEnd('\', '/') -ne $resolvedRoot) {
    throw 'The isolated-run marker does not match the target.'
}
$process = Get-Process -Id $marker.processId -ErrorAction SilentlyContinue
if ($process) {
    $expectedStart = [DateTimeOffset]::Parse($marker.startedAt).UtcDateTime
    if ($process.ProcessName -ne 'dotnet' -or
        [Math]::Abs(($process.StartTime.ToUniversalTime() - $expectedStart).TotalSeconds) -gt 2) {
        throw 'The recorded PID belongs to a different process; refusing to stop it.'
    }
    Stop-Process -Id $process.Id
    $process.WaitForExit()
}
if ($RemoveRuntime) {
    Remove-Item -LiteralPath $resolvedRoot -Recurse -Force
    if (Test-Path -LiteralPath $resolvedRoot) { throw 'Runtime cleanup was incomplete.' }
    Write-Output 'Isolated process stopped and runtime directory removed.'
}
else {
    Write-Output 'Isolated process stopped; database and evidence retained.'
}
