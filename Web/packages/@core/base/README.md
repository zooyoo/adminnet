# 基础共享包

本目录提供框架最底层的能力：

| 目录 | 包 |
| --- | --- |
| `design/` | `@vben-core/design` |
| `icons/` | `@vben-core/icons` |
| `shared/` | `@vben-core/shared` |
| `typings/` | `@vben-core/typings` |

保持基础层独立，沿用现有不引入其他 workspace 包的边界；不要反向依赖业务应用或上层 effects 包。各包的第三方依赖、导出与构建入口以对应 `package.json` 为准。

共享工具与类型变更需核对所有调用方。缓存实现的职责与用法见[缓存说明](shared/src/cache/README.md)，分层原则见 [core 说明](../README.md)。
