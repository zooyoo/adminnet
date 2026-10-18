# 前端 API SDK 生成

当前脚本使用 Swagger Codegen 的 `typescript-axios` 生成器，将 SDK 写入 `Web/apps/web-antdv-next/src/api-services/`。入口为 [`build.ps1`](build.ps1)，生成后由 [`normalize-sdk.mjs`](normalize-sdk.mjs) 做严格类型后处理。不要再向旧的 `Web/src/api-services/` 拷贝文件。

## 环境准备

- 使用 PowerShell 7+ 和前端 [README](../README.md) 要求的 Node、pnpm。
- 准备可运行 Swagger Codegen JAR 的 Java，并确保 `java` 在 PATH 中；也可通过 `-JavaPath` 指定 Java 可执行文件。
- 将项目使用的 Swagger Codegen JAR 放在本目录并命名为 `swagger-codegen-cli.jar`。沿用现有工具版本，不为更新 SDK 顺带升级生成器；切换版本需核对生成差异和后处理兼容性。
- 启动 API，确认目标 Swagger 文档可以访问。默认地址为 `http://localhost:5005/swagger/Default/swagger.json`。

Swagger Codegen 的上游仓库为 <https://github.com/swagger-api/swagger-codegen>。本仓库旧版生成器使用过 `3.0.41`，对应 [JAR 下载地址](https://repo1.maven.org/maven2/io/swagger/codegen/v3/swagger-codegen-cli/3.0.41/swagger-codegen-cli-3.0.41.jar)；实际运行前核对本机文件与 Java 兼容性。

## 执行生成

在 `Web/` 执行默认生成：

```powershell
$ErrorActionPreference = 'Stop'
pnpm build-api-ps
if ($LASTEXITCODE -ne 0) { throw 'API SDK 生成失败' }
```

需要指定 Swagger 文档或 Java 时，在 `Web/` 调用脚本：

```powershell
$ErrorActionPreference = 'Stop'
pwsh -NoProfile -File api_build/build.ps1 -Module apiServices -ApiUrl http://localhost:5005/swagger/Default/swagger.json -JavaPath java
if ($LASTEXITCODE -ne 0) { throw 'API SDK 生成失败' }
```

`-Module` 当前只接受 `apiServices`。`-ApiUrl` 支持 HTTP、HTTPS 和本地文件 URI；传入的是完整 Swagger 文档地址，不是 API 根地址。可先加 `-WhatIf` 核对替换目标，该模式只预览操作，不验证 Java、JAR 或 Swagger 内容。

脚本先在 `Web/node_modules/.cache/api-generation/` 暂存并验证 Swagger，要求 `paths` 非空；随后生成、移除脚手架文件并执行类型后处理。只有这些步骤成功后才替换目标目录，替换失败时尝试恢复本次备份。生成目录属于自动输出，不在其中维护会被下一次覆盖的业务逻辑。

生成完成后在 `Web/` 运行 `pnpm check:type`，并检查 `apps/web-antdv-next/src/api-services/` 的 Git 差异。涉及接口契约变化时补充相应逻辑或真实 API 验证；单纯生成成功不能证明后端业务行为正确。

## 其他入口

`build.bat` 与 `build.sh` 是现有兼容入口，调用行为以文件内容为准。Windows 开发优先使用 `pnpm build-api-ps` 或 PowerShell 7 脚本，不使用旧版 Windows PowerShell。

手动下载客户端可以用于对照生成结果；不要把第三方生成器产物直接覆盖当前 SDK，绕过输入校验和 `normalize-sdk.mjs` 后处理。日常更新使用上述脚本，保留可复现的生成方式。
