# @vben/constants

前端共享常量包，在 `@vben-core/shared/constants` 的基础上维护业务通用常量。公开导出见 [src/index.ts](src/index.ts)。跨模块使用时导入公共常量，避免各页面重复声明。

当前 `apps/web-antdv-next` 已通过 `workspace:*` 依赖本包：

```ts
import { LOGIN_PATH } from '@vben/constants';
```

新增消费包时，从 `Web/` 使用 `pnpm --filter <目标包名> add @vben/constants --workspace`。修改登录路径等共享契约前核对路由与调用方，并按实际影响验证。

环境与检查命令见[前端说明](../../README.md)。
