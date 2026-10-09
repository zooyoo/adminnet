param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 5016,
    [switch]$CrudFixture,
    [switch]$AuthFixture,
    [switch]$OnlineFixture,
    [switch]$JobFixture,
    [switch]$PostgreSqlFixture,
    [switch]$FileDeduplication,
    [switch]$TranslationTestService,
    [uri]$SmsTestService,
    [ValidateRange(1, 120)]
    [int]$SmsTestExpirySeconds = 60,
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
# 种子站点引用公开 Logo；使用仓库静态资源补齐，不复制开发环境上传目录。
New-Item -ItemType Directory -Path (Join-Path $runtimeRoot 'wwwroot/upload') | Out-Null
Copy-Item -LiteralPath (Join-Path $repositoryRoot 'Web/apps/web-antdv-next/public/logo.png') -Destination (Join-Path $runtimeRoot 'wwwroot/upload/logo.png')

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
if ($JobFixture) {
    $configuration['JobSchedule'] = @{ IsolatedOnly = $true; ClusterId = 'isolated-job-cluster' }
}
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
    Enabled = $false
    Provider = 'Minio'
    Endpoint = '127.0.0.1:1'
    AccessKey = 'isolated-unused'
    SecretKey = 'isolated-unused'
    IsEnableCache = $false
}
# 工作簿与个人图片限定在隔离运行目录的 wwwroot，不使用开发上传配置。
$configuration['Upload'] = @{
    Path = 'isolated-upload'
    MaxSize = 10240
    EnableMd5 = $FileDeduplication.IsPresent
    ContentType = @('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/pdf', 'application/octet-stream', 'text/plain', 'application/xml', 'image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/webp', 'video/mp4', 'video/webm', 'audio/mpeg', 'audio/wav', 'audio/mp4', 'video/ogg')
}
if ($SmsTestService) {
    if ($SmsTestService.Scheme -ne 'http' -or $SmsTestService.Host -ne '127.0.0.1' -or
        $SmsTestService.AbsolutePath -ne '/sms' -or $SmsTestService.Query -or $SmsTestService.UserInfo) {
        throw 'SMS test service must be an explicit local HTTP /sms endpoint.'
    }
    $configuration['SMS'] = @{
        VerifyCodeExpireSeconds = $SmsTestExpirySeconds
        SendIntervalSeconds = 2
        Custom = @{
            Enabled = $true
            ApiUrl = $SmsTestService.AbsoluteUri
            Method = 'POST'
            ContentType = 'application/json'
            PostData = '{"mobile":"{mobile}","code":"{code}","template":"{templateId}"}'
            SuccessFlag = 'ISOLATED_SMS_ACCEPTED'
            Templates = @(@{ Id = '0'; Content = 'isolated:{code}' })
        }
    }
    # 保留真实随机图形验证码，仅关闭动画以便稳定读取隔离验收图片。
    $configuration['CaptchaOptions']['ImageOption']['Animation'] = $false
    $configuration['CaptchaOptions']['ExpirySeconds'] = 120
}
if ($TranslationTestService) {
    # 仅按用户授权从本地配置注入隔离进程，不回显密钥、不复制到仓库。
    $translationConfiguration = Get-Content -LiteralPath (Join-Path $configurationRoot 'DeepSeek.example') -Raw -Encoding UTF8 | ConvertFrom-Json -AsHashtable
    $translationSettings = $translationConfiguration['DeepSeekSettings']
    if (-not $translationSettings -or [string]::IsNullOrWhiteSpace($translationSettings['ApiKey']) -or
        [string]::IsNullOrWhiteSpace($translationSettings['ApiUrl'])) { throw 'Translation test settings are incomplete.' }
    $configuration['DeepSeekSettings'] = $translationSettings
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
if ($PostgreSqlFixture) {
    $containerName = 'adminnet-vben-pg-' + [guid]::NewGuid().ToString('N')
    $pgPassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
    $env:POSTGRES_PASSWORD = $pgPassword
    try {
        & docker run --detach --name $containerName --label "adminnet.isolated-runtime=$runtimeRoot" --env POSTGRES_PASSWORD --env POSTGRES_DB=maintenance --publish 127.0.0.1::5432 postgres:18 | Out-Null
        if ($LASTEXITCODE -ne 0) { throw 'Isolated PostgreSQL container start failed.' }
        $deadline = [DateTime]::UtcNow.AddSeconds(90)
        do {
            & docker exec $containerName pg_isready -U postgres -d maintenance *> $null
            if ($LASTEXITCODE -eq 0) { break }
            Start-Sleep -Milliseconds 500
        } while ([DateTime]::UtcNow -lt $deadline)
        if ($LASTEXITCODE -ne 0) { throw 'Isolated PostgreSQL readiness timed out.' }
        $container = & docker inspect $containerName | ConvertFrom-Json
        $pgPort = [int]$container[0].NetworkSettings.Ports.'5432/tcp'[0].HostPort
        $configuration['DbConnection']['ConnectionConfigs'] += @{
            ConfigId = '1300000000003'; DbNickName = '隔离 PostgreSQL'; DbType = 'PostgreSQL'
            ConnectionString = "Host=127.0.0.1;Port=$pgPort;Database=maintenance;Username=postgres;Password=$pgPassword"
            DbSettings = @{ EnableInitDb = $false; EnableInitView = $false; EnableDiffLog = $false; EnableUnderLine = $false; EnableConnStringEncrypt = $false }
            TableSettings = @{ EnableInitTable = $false; EnableIncreTable = $false }
            SeedSettings = @{ EnableInitSeed = $false; EnableIncreSeed = $false }
        }
        @{ containerName = $containerName; runtimeRoot = $runtimeRoot; configId = '1300000000003' } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeRoot 'isolated-postgres.json') -Encoding UTF8
    }
    catch {
        $labels = & docker inspect --format '{{ index .Config.Labels "adminnet.isolated-runtime" }}' $containerName 2>$null
        if ($LASTEXITCODE -eq 0 -and $labels -eq $runtimeRoot) { & docker rm --force --volumes $containerName | Out-Null }
        throw
    }
    finally { Remove-Item Env:POSTGRES_PASSWORD -ErrorAction SilentlyContinue }
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

$process = $null
try {
    $process = Start-IsolatedProcess
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
    if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id }
    if ($PostgreSqlFixture) {
        $label = & docker inspect --format '{{ index .Config.Labels "adminnet.isolated-runtime" }}' $containerName 2>$null
        if ($LASTEXITCODE -eq 0 -and $label -eq $runtimeRoot) {
            & docker rm --force --volumes $containerName | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Isolated PostgreSQL cleanup after startup failure was incomplete.' }
        }
    }
    throw
}
Write-Output "Runtime: $runtimeRoot"
Write-Output "PID: $($process.Id)"
Write-Output "URL: http://127.0.0.1:$Port"
Write-Output 'Ready: real sysConfig/sysInfo returned code 200.'
