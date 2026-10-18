# Motion 动画适配

基于 `@vueuse/motion`，通过 `@vben/plugins/motion` 子路径提供当前项目的动画能力。公开入口为 [index.ts](index.ts)。

| 导出 | 类型 | 说明 |
| --- | --- | --- |
| `Motion` | 组件 | 动画组件 |
| `MotionGroup` | 组件 | 动画组组件 |
| `MotionDirective` | 指令 | 动画指令 |
| `MotionPlugin` | 插件 | Vue 插件 |

在应用初始化中按需要注册插件：

```ts
import { MotionPlugin } from '@vben/plugins/motion';

app.use(MotionPlugin);
```

也可以从同一子路径按需导入上述组件或指令。该适配入口当前没有导出 `MotionOptions`、`MotionVariants`；需要类型时先核对已安装 `@vueuse/motion` 的实际公开类型及消费包依赖，再选择导入方式。

第三方 API 以匹配项目依赖版本的官方说明为准。环境与验证边界见[前端说明](../../../../../README.md)。
