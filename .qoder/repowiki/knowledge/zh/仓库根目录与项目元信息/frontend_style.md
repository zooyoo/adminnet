## 1. 采用的样式系统

前端工程 `Web/apps/web-antdv-next` 基于 Vben Admin（`vue-vben-admin`）脚手架，采用以下技术栈：

- **CSS 方法论**：**Tailwind CSS v4**（依赖 `tailwindcss`、`@iconify/tailwind4`、`tw-animate-css`），通过内部包 `@vben/tailwind-config` 集中配置。
- **UI 组件库**：**Ant Design Vue Next**（依赖 `antdv-next`），作为业务组件层。
- **样式入口**：应用启动时通过 `bootstrap.ts` 顺序导入 `@vben/styles` 与 `@vben/styles/antdv-next`，将 Antd 组件样式注入到 Tailwind 的 `@layer antd`，使 Tailwind 工具类可覆盖组件默认样式（见 `app.vue` 注释）。
- **构建与开发**：使用 Vite（`@vben/vite-config`），Tailwind 样式由该共享 vite 配置集成。
- **样式规范工具链**：Stylelint 通过根级 `stylelint.config.mjs` 继承 `@vben/stylelint-config`；Prettier 通过 `.prettierrc.cjs` 统一格式化；ESLint/Oxlint 分别通过 `eslint.config.mjs`、`oxlint.config.ts`、`oxfmt.config.ts` 管理代码风格。

## 2. 关键文件与包

| 路径 | 作用 |
|---|---|
| `Web/internal/tailwind-config/package.json` | 定义 `@vben/tailwind-config` 包，暴露 `./theme`（`src/theme.css`）与主入口 `index.ts`，依赖 `tailwindcss`、`@iconify/tailwind4`、`tw-animate-css`、`@tailwindcss/typography` |
| `Web/apps/web-antdv-next/src/bootstrap.ts` | 应用启动入口，顺序引入 `@vben/styles`、`@vben/styles/antdv-next` |
| `Web/apps/web-antdv-next/src/app.vue` | 包含关于 `@layer antd` 的注释，说明 Tailwind 工具类覆盖 Antd 样式的约定 |
| `Web/apps/web-antdv-next/vite.config.ts` | 使用 `@vben/vite-config` 的 `defineConfig`，未在此处重复 Tailwind 配置 |
| `Web/stylelint.config.mjs` | 根 Stylelint 配置，仅 `extends: ['@vben/stylelint-config']` |
| `Web/apps/web-antdv-next/package.json` | 应用包，声明 `antdv-next` 为运行时依赖 |
| `Web/package.json` | Monorepo 根，声明 `tailwindcss`、`@vben/tailwind-config` 等 devDependencies |

## 3. 架构与约定

- **Monorepo 结构**：样式相关能力被拆分为独立 workspace 包——`internal/tailwind-config`（Tailwind 预设）、`packages/@core` 下的通用 UI 包、以及应用 `apps/web-antdv-next`。Tailwind 的配置不直接写在应用内，而是通过 `@vben/tailwind-config` 提供。
- **主题层隔离**：Antd 组件样式被注入到 Tailwind 自定义层 `@layer antd`，以便业务代码中的 Tailwind 工具类能按正常优先级覆盖其样式。这是项目明确约定的样式优先级策略。
- **设计令牌与主题**：主题变量集中在 `@vben/tailwind-config` 包的 `src/theme.css`（通过 `exports['./theme']` 暴露），由 Tailwind 配置引用。业务侧不直接维护全局 CSS 变量。
- **响应式策略**：通过 Tailwind 内置断点（如 `lg:`）在模板中直接编写响应式类，例如 `flex flex-col lg:flex-row`、`w-full lg:w-3/5`。
- **动画与图标**：启用 `tw-animate-css` 提供现成动画工具类；图标通过 `@iconify/tailwind4` 以 Tailwind 工具类形式使用。

## 4. 观察到的约定与约束

- **样式入口固定**：所有页面样式均经由 `bootstrap.ts` 中导入的 `@vben/styles` 与 `@vben/styles/antdv-next` 加载，业务组件不应绕过此入口自行引入底层样式。
- **覆盖 Antd 样式的方式**：应优先使用 Tailwind 工具类进行覆盖，而非编写新的 CSS 规则（依据 `app.vue` 中 `@layer antd` 的设计意图）。
- **Tailwind 工具类优先**：业务模板中使用 Tailwind 原子类（如 `mb-5`、`p-5`、`flex`、`mt-5`、`gap-4`、`!w-16` 等），仅在无法用工具类表达时才退回到自定义 CSS（如 `template-editor/index.vue`、`profile-images.vue` 中的少量 `.template-rich-*`、`.profile-avatar-*` 类）。
- **Stylelint 规则来源**：所有样式检查规则来自 `@vben/stylelint-config`，根配置仅做继承，禁止各子项目自行扩展或重写规则。
- **Node/pnpm 版本约束**：`package.json` 的 `engines` 字段要求 Node `^22.18.0 || ^24.12.0`，pnpm `>=11.0.0`，`packageManager` 锁定为 `pnpm@11.16.0`，确保样式构建环境一致。
- **构建目标**：Vite 构建 target 设为 `es2022`，意味着现代浏览器特性可用，无需额外 polyfill 影响样式输出。

综上，该项目的前端样式体系是“Tailwind CSS v4 原子类 + Ant Design Vue Next 组件库”的组合，通过内部 `@vben/tailwind-config` 和 `@vben/styles` 包统一分发，并在启动阶段将 Antd 样式注册到 Tailwind 的 `@layer antd`，从而保证业务样式可自然覆盖组件默认样式。