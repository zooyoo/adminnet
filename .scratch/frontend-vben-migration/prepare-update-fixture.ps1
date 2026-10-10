param([Parameter(Mandatory)][string]$RuntimeRoot)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

$runtime = (Resolve-Path -LiteralPath $RuntimeRoot).Path
if ([IO.Path]::GetDirectoryName($runtime) -ne [IO.Path]::TrimEndingDirectorySeparator([IO.Path]::GetTempPath()) -or
    [IO.Path]::GetFileName($runtime) -notmatch '^adminnet-vben-[a-f0-9]{32}$') { throw 'Unrecognized isolated runtime' }
$run = Get-Content -LiteralPath (Join-Path $runtime 'isolated-run.json') -Encoding UTF8 -Raw | ConvertFrom-Json
if ($run.runtimeRoot -ne $runtime) { throw 'Runtime marker mismatch' }
$config = Get-Content -LiteralPath (Join-Path $runtime 'appsettings.json') -Encoding UTF8 -Raw | ConvertFrom-Json
$targetRoot = [IO.Path]::GetFullPath($config.CDConfig.AllowedDeploymentRoot)
$live = [IO.Path]::GetFullPath($config.CDConfig.BackendOutput)
$expectedTarget = Join-Path ([IO.Path]::GetTempPath()) ('adminnet-update-target-' + [IO.Path]::GetFileName($runtime).Substring('adminnet-vben-'.Length))
if ($targetRoot -ne $expectedTarget -or $live -ne (Join-Path $targetRoot 'live') -or
    (Get-Content -LiteralPath (Join-Path $targetRoot '.adminnet-update-target') -Encoding UTF8 -Raw).Trim() -ne $config.CDConfig.DeploymentId) { throw 'Deployment marker mismatch' }
if ((Get-Item -LiteralPath $live).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Live cannot be a link' }
if (@(Get-ChildItem -LiteralPath $live -Force).Count -ne 0) { throw 'Fixture requires empty isolated target' }

$fixtureRoot = Join-Path $runtime 'update-fixture'
$evidenceRoot = Join-Path $runtime 'evidence'
New-Item -ItemType Directory -Path $fixtureRoot | Out-Null
New-Item -ItemType Directory -Path $evidenceRoot -Force | Out-Null
$projectText = @'
<Project Sdk="Microsoft.NET.Sdk.Web">
  <PropertyGroup>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
    <UseAppHost>false</UseAppHost>
    <SelfContained>false</SelfContained>
  </PropertyGroup>
</Project>
'@
$releases = @()
foreach ($revision in @('release-v1', 'release-v2', 'release-v3', 'broken')) {
    $sourceRoot = Join-Path $fixtureRoot $revision
    $projectRoot = Join-Path $sourceRoot 'Admin.NET/Admin.NET.Web.Entry'
    New-Item -ItemType Directory -Path (Join-Path $projectRoot 'wwwroot') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $projectRoot 'Admin.NET.Web.Entry.csproj') -Value $projectText -Encoding UTF8
    $program = 'var builder = WebApplication.CreateBuilder(args);' + "`n" +
        'var app = builder.Build();' + "`n" + 'app.MapGet("/health", () => "' + $revision + '");' + "`n" + 'app.Run();'
    if ($revision -eq 'broken') { $program = '#error Isolated_publish_failure_fixture' }
    Set-Content -LiteralPath (Join-Path $projectRoot 'Program.cs') -Value $program -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $projectRoot 'appsettings.json') -Value '{"DeploymentSetting":"package-must-not-overwrite-live"}' -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $projectRoot 'wwwroot/version.txt') -Value $revision -Encoding UTF8
    if ($revision -ne 'release-v1') { Set-Content -LiteralPath (Join-Path $projectRoot 'wwwroot/introduced.txt') -Value $revision -Encoding UTF8 }
    $archive = Join-Path $fixtureRoot ($revision + '.zip')
    [IO.Compression.ZipFile]::CreateFromDirectory($sourceRoot, $archive)
    $releases += @{ revision = $revision; archive = $archive }
}

$initialProject = Join-Path $fixtureRoot 'release-v1/Admin.NET/Admin.NET.Web.Entry'
& dotnet publish $initialProject -c Release -f net10.0 -r win-x64 --output $live --disable-build-servers -m:1 -p:UseSharedCompilation=false *> (Join-Path $evidenceRoot 'initial-publish.log')
if ($LASTEXITCODE -ne 0) { throw 'Initial isolated release publish failed' }
$liveSecret = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(24))
@{ DeploymentSetting = 'preserve-live-setting'; FixtureSecret = $liveSecret } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $live 'appsettings.json') -Encoding UTF8
Set-Content -LiteralPath (Join-Path $live 'keep.txt') -Value 'preserve-existing-deployment-file' -Encoding UTF8
$snapshot = @{}
Get-ChildItem -LiteralPath $live -Recurse -File | ForEach-Object {
    $relative = [IO.Path]::GetRelativePath($live, $_.FullName).Replace('\', '/')
    $snapshot[$relative] = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
}
@{ runtimeRoot = $runtime; targetRoot = $targetRoot; live = $live; deploymentId = $config.CDConfig.DeploymentId; releases = $releases; initialSnapshot = $snapshot } |
    ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $fixtureRoot 'fixture.json') -Encoding UTF8
Write-Output 'Prepared: compiled initial release, three source archives and real compiler failure archive.'
