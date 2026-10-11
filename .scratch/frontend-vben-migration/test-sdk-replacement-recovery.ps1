param(
    [Parameter(Mandatory)][string]$RuntimeRoot,
    [Parameter(Mandatory)][string]$JavaPath
)
$ErrorActionPreference = 'Stop'
$runtime = (Resolve-Path -LiteralPath $RuntimeRoot).Path
if ([IO.Path]::GetDirectoryName($runtime) -ne [IO.Path]::GetTempPath().TrimEnd('\') -or [IO.Path]::GetFileName($runtime) -notmatch '^adminnet-vben-[a-f0-9]{32}$') { throw 'Invalid isolated runtime.' }
$web = Join-Path $runtime 'sdk-copy/Web'
$destination = Join-Path $web 'apps/web-antdv-next/src/api-services'
$generator = Join-Path $web 'api_build/build.ps1'
$swagger = Join-Path $runtime 'evidence/swagger-Default.json'
$reportPath = Join-Path $runtime 'evidence/sdk-replacement-recovery.json'
$report = @{ passed = $false; restored = $false; stagingClean = $false }
$sdkRecoveryState = @{ Injected = $false; Destination = [IO.Path]::GetFullPath($destination) }
function Get-SdkDigest {
    $entries = Get-ChildItem -LiteralPath $destination -File -Recurse | Sort-Object FullName | ForEach-Object {
        $_.FullName.Substring($destination.Length) + ':' + (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
    }
    return ($entries -join "`n")
}
# 仅在此测试进程内拦截生成副本的发布步骤；真实文件操作仍由 PowerShell 执行。
function Move-Item {
    param([string]$LiteralPath, [string]$Destination)
    $sourcePath = [IO.Path]::GetFullPath($LiteralPath)
    $targetPath = [IO.Path]::GetFullPath($Destination)
    if ($targetPath -eq $sdkRecoveryState.Destination -and [IO.Path]::GetFileName($sourcePath) -match '^apiServices-[a-f0-9]{32}$') {
        $sdkRecoveryState.Injected = $true
        throw 'SDK35_EXPECTED_PUBLICATION_FAILURE'
    }
    Microsoft.PowerShell.Management\Move-Item -LiteralPath $sourcePath -Destination $targetPath
}
try {
    if (-not (Test-Path -LiteralPath $destination) -or -not (Test-Path -LiteralPath $swagger)) { throw 'Successful isolated generation required first.' }
    $before = Get-SdkDigest
    $sdkRecoveryState.Injected = $false
    $caught = $false
    try { & $generator -Module apiServices -ApiUrl ([uri]$swagger) -JavaPath $JavaPath | Out-Null }
    catch {
        if ($_.Exception.Message -notlike '*SDK35_EXPECTED_PUBLICATION_FAILURE*') { throw }
        $caught = $true
    }
    if (-not $caught -or -not $sdkRecoveryState.Injected) { throw 'Expected publication failure was not exercised.' }
    if ((Get-SdkDigest) -ne $before) { throw 'Original SDK was not restored byte-for-byte.' }
    $report.restored = $true
    $remaining = @(Get-ChildItem -LiteralPath (Join-Path $web 'node_modules/.cache/api-generation'))
    if ($remaining.Count) { throw 'Staging or backup remains.' }
    $report.stagingClean = $true
    $report.passed = $true
} catch {
    $report.error = $_.Exception.Message
    throw
} finally {
    $report | ConvertTo-Json | Set-Content -LiteralPath $reportPath -Encoding UTF8
}
Write-Output 'SDK replacement failure restored original files.'
