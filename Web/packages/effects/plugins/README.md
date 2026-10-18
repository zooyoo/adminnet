# @vben/plugins

集中维护第三方库的公共适配、组合式函数与组件。当前应用为 `apps/web-antdv-next`，已通过 `workspace:*` 依赖本包。公开子路径以 [package.json](package.json) 的 `exports` 为准。

按需要从子路径导入，避免使用未公开的包内文件：

```ts
import { useEcharts } from '@vben/plugins/echarts';
```

例如，`package.json` 中的 ECharts 导出配置为：

```json
{
  "exports": {
    "./echarts": {
      "types": "./src/echarts/index.ts",
      "default": "./src/echarts/index.ts"
    }
  }
}
```

这里的 `default` 是包导出条件，不等于模块提供 `export default`。可使用的命名导出需要继续核对 `src/echarts/index.ts`。

使用说明见 [ECharts](src/echarts/README.md) 与 [Motion](src/motion/README.md)。新增适配时核对目标依赖版本、许可证与公开导出；子路径能明确依赖边界，最终包体积仍需结合实际导入和构建分析判断。

环境与验证命令见[前端说明](../../../README.md)，组件与外部库的查询规则见[前端规则](../../../AGENTS.md)。
