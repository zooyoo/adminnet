# ECharts 图表适配

通过 `@vben/plugins/echarts` 子路径提供图表容器和组合式函数。公开入口为 [index.ts](index.ts)，预置注册见 [echarts.ts](echarts.ts)。

| 导出 | 类型 | 说明 |
| --- | --- | --- |
| `EchartsUI` | 组件 | 图表容器组件 |
| `useEcharts` | 函数 | 图表初始化与更新的组合式函数 |
| `ECOption` | 类型 | 项目预置图表的配置类型 |

```ts
import type { ECOption } from '@vben/plugins/echarts';

import { EchartsUI, useEcharts } from '@vben/plugins/echarts';
```

该子路径公开命名导出；内部 `echarts.ts` 的默认导出没有被 `index.ts` 转为包级默认导出。不要从 `@vben/plugins/echarts` 使用默认导入。

## 当前预置能力

- 组件：`TitleComponent`、`TooltipComponent`、`GridComponent`、`LegendComponent`、`ToolboxComponent`、`DatasetComponent`、`TransformComponent`、`GraphicComponent`。
- 图表：`BarChart`、`LineChart`、`PieChart`、`RadarChart`。
- 功能：`LabelLayout`、`LegacyGridContainLabel`、`UniversalTransition`。
- 渲染器：`CanvasRenderer`。

新增图表类型或功能时，核对注册和 `ECOption` 类型是否同时覆盖，并检查实际构建体积与调用页面。使用方式可参考当前应用的 `apps/web-antdv-next/src/views/dashboard/analytics/`；外部 ECharts API 以匹配依赖版本的官方资料为准。

环境与验证边界见[前端说明](../../../../../README.md)。
