# 提案 43：代码生成预览、ZIP 与真实 CRUD

Status: ready-for-agent
Execution: completed

依赖提案 35 和 42。预览与 ZIP 下载采用已保存配置，产物使用 Vben、Antdv Next、公共 AdminTable 和真实生成 SDK。

## 验收

- [x] 预览与 ZIP 的全部、仅前端、仅后端清单及文件内容一致。
- [x] 前端输出无旧 UI 依赖，真实 SDK、前端与后端产物均可编译。
- [x] 隔离 PostgreSQL 代表实体生成并接入后完成浏览器真实新增、编辑、查询、删除。
- [x] 原查询、排序、字典、外键、导入导出、上传及打印配置的生成契约保持。
- [x] 失败、重复生成、取消与缓存离页可恢复，回执和下载不跨身份。
- [x] 生产桌面明暗截图、类型检查、构建与全部清理证据齐备。

## 完成证据

129 项后端回归、8 项前端回归、ESLint、目标应用类型检查、Core net8 与生产构建通过。最终报告 `C:\Users\zoyo\AppData\Local\Temp\adminnet-vben-8a314f4ee9954c84b15060ec7a9d7645\evidence\codegen-zip-browser-baseline.json` 的 14 个阶段及清理均通过，详情和源码 SHA256 见 `../codegen-zip-acceptance.json`。

已保存配置的七模板预览与 ZIP 逐字节、CRC、清单和 SHA256 一致；全部、仅前端、仅后端生成清单正确。四个 C# 文件接入隔离 Application 后实际编译，真实 Default Swagger 使用提案 35 工具生成 SDK，临时应用类型检查及生产构建通过。

生产 Edge 与真实 PostgreSQL 完成 CRUD、唯一约束失败保留草稿并重试、0 / false 持久化、空值双向查询、日期范围及布尔查询、状态更新、真实 Excel 内容和模板导入、错误明细、附件鉴权下载字节核验、PDF 文本及原生打印调用。缓存离页清草稿和 API 停机保存失败恢复均通过。明暗首列与附件视角截图已实际查看，页面无横向溢出。

业务记录、配置、菜单四关联表、附件元数据及物理文件、临时应用、所属 API 和 PostgreSQL 全部回收；摘要恢复，browserErrors 与 cleanupErrors 均为空。第 41 项真实播放仍按用户指令暂缓，不因本提案闭票而计完成。第 44 项直接生成边界另行推进。
