# @vben/styles

前端共享样式包，在 `@vben-core/design` 的基础上提供业务通用样式。入口与子路径以 [package.json](package.json) 和 [src/index.ts](src/index.ts) 为准。

当前 `apps/web-antdv-next` 已通过 `workspace:*` 依赖本包，在应用初始化阶段加载：

```ts
import '@vben/styles';
```

新增消费包时，从 `Web/` 使用 `pnpm --filter <目标包名> add @vben/styles --workspace`。业务局部样式放在所属组件，通用样式再放入本包；主题修改同时遵守[前端规则](../../AGENTS.md)中的 Token 与样式接口约定。

环境与检查命令见[前端说明](../../README.md)。
