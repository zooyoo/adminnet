# @vben/icons

前端共享图标包，在 `@vben-core/icons` 的基础上维护业务通用图标。可用名称与公开导出见 [src/index.ts](src/index.ts)，使用前核对真实导出。

当前 `apps/web-antdv-next` 已通过 `workspace:*` 依赖本包：

```ts
import { X } from '@vben/icons';
```

新增消费包时，从 `Web/` 使用 `pnpm --filter <目标包名> add @vben/icons --workspace`。共用图标优先通过本包维护，避免在业务页面引入重复图标来源。

环境与检查命令见[前端说明](../../README.md)。
