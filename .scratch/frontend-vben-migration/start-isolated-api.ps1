param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 5016,
    [switch]$CrudFixture,
    [switch]$AuthFixture,
    [switch]$OnlineFixture,
    [string]$BuildRoot
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
if (([int]$CrudFixture.IsPresent + [int]$AuthFixture.IsPresent + [int]$OnlineFixture.IsPresent) -gt 1) { throw 'Select only one isolated fixture.' }

$repositoryRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$buildRoot = if ($BuildRoot) { [IO.Path]::GetFullPath($BuildRoot) } else { Join-Path $repositoryRoot 'Admin.NET/Admin.NET.Web.Entry/bin/Debug/net10.0' }
$configurationRoot = Join-Path $repositoryRoot 'Admin.NET/Admin.NET.Application/Configuration'
if (-not (Test-Path -LiteralPath (Join-Path $buildRoot 'Admin.NET.Web.Entry.dll'))) {
    throw 'Build Admin.NET.Web.Entry in Debug before starting the isolated API.'
}
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) {
    throw "Port $Port is already occupied."
}

$runtimeRoot = Join-Path ([IO.Path]::GetTempPath()) ('adminnet-vben-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $runtimeRoot | Out-Null
New-Item -ItemType Directory -Path (Join-Path $runtimeRoot 'wwwroot') | Out-Null

# 仅复制程序及运行库，不复制开发配置、业务数据库、上传文件或插件目录。
Get-ChildItem -LiteralPath $buildRoot -File | Where-Object {
    $_.Extension -in @('.dll', '.pdb', '.mmdb') -or
    $_.Name -in @('Admin.NET.Web.Entry.deps.json', 'Admin.NET.Web.Entry.runtimeconfig.json', 'ip2region.db')
} | Copy-Item -Destination $runtimeRoot
foreach ($directoryName in @('runtimes', 'zh-Hans')) {
    $source = Join-Path $buildRoot $directoryName
    if (Test-Path -LiteralPath $source) {
        Copy-Item -LiteralPath $source -Destination $runtimeRoot -Recurse
    }
}

$configuration = [ordered]@{
    ConfigurationScanDirectories = @()
    Urls = "http://127.0.0.1:$Port"
    AllowedHosts = 'localhost;127.0.0.1'
}
foreach ($fileName in @('App.json', 'Enum.json', 'Captcha.json', 'Limit.json')) {
    $source = Get-Content -LiteralPath (Join-Path $configurationRoot $fileName) -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable
    foreach ($key in $source.Keys) {
        if ($key -notin @('$schema', 'Urls', 'AllowedHosts', 'AppSettings', 'JobSchedule')) {
            $configuration[$key] = $source[$key]
        }
    }
}
$configuration['AppSettings'] = @{ InjectSpecificationDocument = $false }
$configuration['FriendlyExceptionSettings']['LogError'] = $true
$configuration['Cache'] = @{ CacheType = 'Memory' }
$configuration['OAuth'] = @{
    Weixin = @{ ClientId = 'isolated-unused'; ClientSecret = 'isolated-unused' }
    Gitee = @{ ClientId = 'isolated-unused'; ClientSecret = 'isolated-unused' }
}
$configuration['Logging'] = @{
    LogLevel = @{ Default = 'Warning'; 'Microsoft.AspNetCore' = 'Error' }
    File = @{ Enabled = $false }
    Database = @{ Enabled = $false }
    ElasticSearch = @{ Enabled = $false }
    Monitor = @{ GlobalEnabled = $false; WithReturnValue = $false; ConsoleLog = $true }
}
$configuration['JWTSettings'] = @{
    ValidateIssuerSigningKey = $true
    IssuerSigningKey = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32))
    ValidateIssuer = $true
    ValidIssuer = 'Admin.NET.Isolated'
    ValidateAudience = $true
    ValidAudience = 'Admin.NET.Isolated'
    ValidateLifetime = $true
    ExpiredTime = 20
    ClockSkew = 5
    Algorithm = 'HS256'
}
$configuration['OSSProvider'] = @{
    Provider = 'Minio'
    Endpoint = '127.0.0.1:1'
    AccessKey = 'isolated-unused'
    SecretKey = 'isolated-unused'
    IsEnableCache = $false
}
$configuration['DbConnection'] = @{
    EnableConsoleSql = $false
    SuperAdminIgnoreIDeletedFilter = $false
    ConnectionConfigs = @(
        foreach ($database in @(
            @{ Id = '1300000000001'; Name = 'main' },
            @{ Id = '1300000000002'; Name = 'log' }
        )) {
            @{
                ConfigId = $database.Id
                DbType = 'Sqlite'
                ConnectionString = "Data Source=$(Join-Path $runtimeRoot ($database.Name + '.db'))"
                DbSettings = @{
                    EnableInitDb = $true
                    EnableInitView = $false
                    EnableDiffLog = $false
                    EnableUnderLine = $false
                    EnableConnStringEncrypt = $false
                }
                TableSettings = @{ EnableInitTable = $true; EnableIncreTable = $false }
                SeedSettings = @{ EnableInitSeed = $true; EnableIncreSeed = $false }
            }
        }
    )
}
$configuration | ConvertTo-Json -Depth 50 | Set-Content -LiteralPath (Join-Path $runtimeRoot 'appsettings.json') -Encoding UTF8

function Start-IsolatedProcess {
    $apiProcess = Start-Process -FilePath (Get-Command dotnet).Source `
        -ArgumentList @('Admin.NET.Web.Entry.dll', '--environment', 'IsolatedIntegration') `
        -WorkingDirectory $runtimeRoot -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $runtimeRoot 'stdout.log') `
        -RedirectStandardError (Join-Path $runtimeRoot 'stderr.log')
    [ordered]@{
        runtimeRoot = $runtimeRoot
        processId = $apiProcess.Id
        baseUrl = "http://127.0.0.1:$Port"
        startedAt = $apiProcess.StartTime.ToUniversalTime().ToString('O')
    } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeRoot 'isolated-run.json') -Encoding UTF8
    return $apiProcess
}

function Wait-IsolatedApi([Diagnostics.Process]$ApiProcess) {
    $deadline = [DateTime]::UtcNow.AddSeconds(90)
    while ([DateTime]::UtcNow -lt $deadline) {
        $ApiProcess.Refresh()
        if ($ApiProcess.HasExited) {
            throw "Isolated API exited. Inspect logs under $runtimeRoot."
        }
        try {
            $response = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/sysConfig/sysInfo" -TimeoutSec 3
            if ($response.code -eq 200) { return }
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }
    throw "Isolated API readiness timed out. Inspect logs under $runtimeRoot."
}

$process = Start-IsolatedProcess
try {
    Wait-IsolatedApi $process
    if ($CrudFixture -or $AuthFixture -or $OnlineFixture) {
        Stop-Process -Id $process.Id
        $process.WaitForExit()
        $fixtureScript = if ($AuthFixture) { 'prepare-auth-db.mjs' } elseif ($OnlineFixture) { 'prepare-online-db.mjs' } else { 'prepare-crud-db.mjs' }
        & node (Join-Path $PSScriptRoot $fixtureScript) $runtimeRoot
        if ($LASTEXITCODE -ne 0) { throw 'Isolated fixture preparation failed.' }
        $process = Start-IsolatedProcess
        Wait-IsolatedApi $process
    }
}
catch {
    if (-not $process.HasExited) { Stop-Process -Id $process.Id }
    throw
}
Write-Output "Runtime: $runtimeRoot"
Write-Output "PID: $($process.Id)"
Write-Output "URL: http://127.0.0.1:$Port"
Write-Output 'Ready: real sysConfig/sysInfo returned code 200.'
