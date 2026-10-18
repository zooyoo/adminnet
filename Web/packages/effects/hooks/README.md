# @vben/hooks

前端共享组合式函数包，复用 `@vben-core/composables`，并提供跨页面使用的业务 hooks。完整公开导出见 [src/index.ts](src/index.ts)。

当前 `apps/web-antdv-next` 已通过 `workspace:*` 依赖本包：

```ts
import { useNamespace } from '@vben/hooks';
```

新增消费包时，从 `Web/` 使用 `pnpm --filter <目标包名> add @vben/hooks --workspace`。应用专用逻辑保留在应用目录，真正跨模块复用的逻辑再放入本包；新增 hook 前先核对 core 和本包的已有实现。

修改后检查调用方与相关逻辑测试。根 `pnpm lint`、`pnpm check:type` 主要检查当前业务应用，不表示所有共享 hook 均已覆盖。环境和验证边界见[前端说明](../../../README.md)。
