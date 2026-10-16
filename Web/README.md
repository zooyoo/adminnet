# Admin.NET 前端

当前应用位于 `apps/web-antdv-next`，使用 Vue 3、TypeScript、Vben Admin 和 Antdv Next。

在本目录使用 `package.json` 指定的 pnpm 版本运行：

```powershell
pnpm install --frozen-lockfile
pnpm dev
pnpm check:type
pnpm lint
pnpm build
```

生产产物统一输出到 `Web/dist`。API SDK 通过 `pnpm build-api-ps` 生成到目标应用；代码生成器的前端文件也写入目标应用。

运行时 API、Nginx、SignalR、SSE、上传和缓存配置见 [部署说明](scripts/deploy/README.md)。

媒体、PDF、Office、富文本和调度看板使用各自已经验证的专业引擎。`Sundial.Dashboard` 由后端提供，随 API 部署保留。

项目及上游许可证分别见 `LICENSE` 和 `LICENSE-VBEN`。
