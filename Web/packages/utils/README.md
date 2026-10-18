# @vben/utils

前端共享工具包，在 `@vben-core/shared/utils` 的基础上导出业务通用工具。公开入口见 [package.json](package.json) 与 [src/index.ts](src/index.ts)。框架无关的基础实现优先放在 core 层；业务工具放在本包，避免在页面中重复实现。

当前 `apps/web-antdv-next` 已通过 `workspace:*` 依赖本包，在应用中直接使用：

```ts
import { isString } from '@vben/utils';
```

新增消费包时，从 `Web/` 使用 `pnpm --filter <目标包名> add @vben/utils --workspace`，将依赖明确关联到本 workspace；不要按照旧模板进入不存在的 `apps/xxxx-app`。

改动共享工具后检查调用方与现有测试。根 `pnpm check:type` 和 `pnpm lint` 仅以业务应用为目标，不代表本包全部逻辑已验证。环境和检查边界见[前端说明](../../README.md)。
