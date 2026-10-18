# @vben/types

前端共享类型包，在 `@vben-core/typings` 的基础上导出业务通用类型。公开类型以 [src/index.ts](src/index.ts) 与 [package.json](package.json) 为准。

当前 `apps/web-antdv-next` 已通过 `workspace:*` 依赖本包。使用类型导入：

```ts
import type { SelectOption } from '@vben/types';
```

新增消费包时，从 `Web/` 使用 `pnpm --filter <目标包名> add @vben/types --workspace`。类型契约变化需要核对调用方；根 `pnpm check:type` 检查当前业务应用，按影响范围补充其他消费包的类型验证。

环境、目录与命令说明见[前端说明](../../README.md)。
