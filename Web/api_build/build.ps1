[CmdletBinding(SupportsShouldProcess)]
param(
    [ValidateSet('apiServices', 'dingTalk', 'goView')]
    [string]$Module = 'apiServices',
    [uri]$ApiUrl
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$webRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$appSource = Join-Path $webRoot 'apps\web-antdv-next\src'
$cacheRoot = Join-Path $webRoot 'node_modules\.cache\api-generation'
$modules = @{
    apiServices = @{ Path = 'api-services'; Swagger = 'Default' }
    dingTalk = @{ Path = 'api-plugins\dingTalk'; Swagger = 'DingTalk' }
    goView = @{ Path = 'api-plugins\goView'; Swagger = 'GoView' }
}
$settings = $modules[$Module]
$destination = [System.IO.Path]::GetFullPath((Join-Path $appSource $settings.Path))
$id = [guid]::NewGuid().ToString('N')
$staging = [System.IO.Path]::GetFullPath((Join-Path $cacheRoot "$Module-$id"))
$backup = [System.IO.Path]::GetFullPath((Join-Path $cacheRoot "$Module-backup-$id"))

function Assert-ChildPath([string]$Path, [string]$Parent) {
    $absolute = [System.IO.Path]::GetFullPath($Path)
    $prefix = [System.IO.Path]::GetFullPath($Parent).TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    if (-not $absolute.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw '拒绝操作工作区边界之外的路径。'
    }
}

Assert-ChildPath $destination $appSource
Assert-ChildPath $staging $cacheRoot
Assert-ChildPath $backup $cacheRoot
if (-not $ApiUrl) {
    $ApiUrl = [uri]"http://localhost:5005/swagger/$($settings.Swagger)/swagger.json"
}
if (-not $PSCmdlet.ShouldProcess($destination, '重新生成并替换 API SDK')) { return }

$jar = Join-Path $PSScriptRoot 'swagger-codegen-cli.jar'
if (-not (Test-Path -LiteralPath $jar)) { throw '缺少 swagger-codegen-cli.jar。' }
Get-Command java, node -ErrorAction Stop | Out-Null
New-Item -ItemType Directory -Path $staging -Force | Out-Null

try {
    & java -jar $jar generate -i $ApiUrl.AbsoluteUri -l typescript-axios -o $staging
    if ($LASTEXITCODE -ne 0) { throw "Swagger SDK 生成失败，退出代码：$LASTEXITCODE" }

    foreach ($name in @('.swagger-codegen', '.gitignore', '.npmignore', '.swagger-codegen-ignore', 'git_push.sh', 'package.json', 'README.md', 'tsconfig.json')) {
        $path = Join-Path $staging $name
        Assert-ChildPath $path $staging
        if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
    }

    & node (Join-Path $PSScriptRoot 'normalize-sdk.mjs') $staging
    if ($LASTEXITCODE -ne 0) { throw 'SDK 严格类型后处理失败，现有 SDK 未替换。' }

    # 生成和类型后处理成功后才替换原目录，失败时恢复备份。
    Assert-ChildPath $destination $appSource
    Assert-ChildPath $backup $cacheRoot
    if (Test-Path -LiteralPath $destination) { Move-Item -LiteralPath $destination -Destination $backup }
    try {
        Assert-ChildPath $staging $cacheRoot
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Move-Item -LiteralPath $staging -Destination $destination
    } catch {
        if ((Test-Path -LiteralPath $backup) -and -not (Test-Path -LiteralPath $destination)) {
            Move-Item -LiteralPath $backup -Destination $destination
        }
        throw
    }
    if (Test-Path -LiteralPath $backup) {
        Assert-ChildPath $backup $cacheRoot
        Remove-Item -LiteralPath $backup -Recurse -Force
    }
    Write-Output "SDK 已更新：$destination"
} finally {
    if (Test-Path -LiteralPath $staging) {
        Assert-ChildPath $staging $cacheRoot
        Remove-Item -LiteralPath $staging -Recurse -Force
    }
}
