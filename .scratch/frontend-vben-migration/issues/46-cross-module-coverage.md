# 46：全量功能对应与连续工作流

- Status: ready-for-agent
- Execution: completed
- Dependencies: 41、44、45 及全部已迁移业务。

当前完成数为 46 / 48。第 46 项按原范围验收通过或获用户明确豁免；原失败记录保持，最终依据见 2026-10-16 闭合记录。

## 验收

- [x] 旧文件已对应到新功能组及编号任务；此映射不代表全部已实现行为验收完成。
- [x] 补齐旧公开拨号地址及编码兼容，新应用 473 项回归、类型和生产构建通过。
- [x] 真实 PostgreSQL、生产桌面管理员和只读普通用户连续工作流通过。
- [x] 两个租户连续切换、授权拒绝、缓存草稿、直达刷新、退出和实时会话回收通过。
- [x] 最终明暗稳定截图实际复核、业务数据及自有资源清理通过。
- [x] 第 41 项按用户明确指令豁免真实播放验收；该豁免不豁免第 46 项其他验收点。
- [x] 汇总各任务最终有效证据，逐行为关联具体操作、断言与报告，复核全部公共组件及插件。
- [x] 汇总后重新运行真实 PostgreSQL 跨模块回归并封存最新结果。
- [x] 逐项核验所有真实集成已通过或明确获准豁免，不用数量或哈希一致替代功能覆盖。

## 尚需材料

无需再索取第 41 项视频凭据。第 46 项已完成逐行为证据复核与最终业务回归，三项 Native 按用户明确豁免。手机端未测试，沿用 AGENTS.md 的仅桌面要求，不声称手机验收通过。

## 首次范围验收记录（历史）

- 103 个旧视图、34 个公共组件、56 个功能组均有逐文件映射；105 个历史证据引用及每层结果保留。钉钉、GoView、支付明确标为已批准删除，两个首页示例及未挂接工具单独标识。见 `../coverage46-matrix.md` 和 `../coverage46-feature-map.json`。
- 新应用 51 文件 / 473 回归通过；拨号路由、旧编码与无效输入、页头退出按钮可访问名称通过。最新 lint、类型检查及生产构建通过（13391 模块，7.67 秒）。
- 真实 Nginx、生产 Edge 桌面及 PostgreSQL 连续链 7 阶段通过：只读用户、跨租户伪造拒绝、本人资料/工作台、深刷新、退出、同文档 A/B 切换清草稿、B 租户新增/PG 反查、明暗及在线连接回收。拒绝端点必须真实存在，404 不作为权限证据。
- 最终报告：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-4c9f63b07b4240b4854ff20b21ac08ff/evidence/coverage46-browser-baseline.json`。`passed` 与 `cleanupPassed` 均为 `true`，`proposalComplete` 为 `false`。10 表及用户关联摘要恢复，菜单/租户/角色/用户/授权、Nginx、PG 卷及自有 API 已清理，错误列表为空。4 张实际截图已复核。
- 封存记录：`../coverage46-acceptance.json`，绑定 5 源码、4 工具、7 日志、报告和 4 图 SHA256。早期混合历史证据不充作本轮 PG 全量重测。
- Execution 保持 `in-progress`；44 / 48 完成数不变。待第 41 项真实首帧/控制补验后，才能关闭完整验收。第 47～48 项尚未执行清理或外部切换。

## 首次闭票决定（已撤回）

2026-10-13：第 41 项验收决定已提交 bd8f9d6ed。重建完整矩阵，仍为 103 旧视图、34 公共组件、56 功能组及 105 证据引用；137 份旧源码、全部当前证据哈希和新实现路径复核通过。已有 473 回归及真实 PostgreSQL 连续链 7 阶段、4 张已审截图和资源清理证据保持。原始浏览器报告 proposalComplete=false 属首次历史范围，文件及哈希未改；最终整项 complete=true 见 coverage46-acceptance.json。

矩阵生成器读取第 41 项实际验收决定，保留 realPlaybackConfirmed=false 和用户豁免，避免重新生成后回到旧暂缓状态。第 46 项 Execution=completed，完成数为 46 / 48，继续第 47 项。已复核，无新增通用浏览器经验。

## Comments

Issue 插件上报 46 返回 not-found，沿用本地编号 Markdown 更新，无远端或新地图写入。

## 验收复核更正

2026-10-13：用户要求按第 46 项验收点解释闭票依据。原真实 PG 连续链及清理证据有效，当前文件级映射仅指向任务报告，尚未逐行为核验完整证据；闭票生成条件也未包含该检查。撤回完整闭票状态，complete=false、Execution=in-progress，完成数为 45 / 48。第 47 项主工作区删除未执行。原 8d86ae8e8 提交和真实报告保留，新提交纠正验收状态。

提案文档第 46 项和本任务文件均真实存在；插件返回 not-found 且该 effort 的列表为 0，表示未识别任务并未记录上报，不表示文档里没有提案。继续使用仓库规定的本地 Markdown，不创建重复票或地图。

## 本轮重新执行的局部证据（整体未闭）

本人资料：最终真实 PostgreSQL 报告 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-8146ae34a2a44c268c87caa1b20d9fac/evidence/coverage46-reexecution-browser-baseline.json` 的 9 个具名场景、后续跨模块链及清理通过。头像 256 PNG、签名绘制／上传／替换／清空、本人资料持久化、改密前后登录已实际验证；9 张深色资料截图已查看，浅色资料图和剩余旧交互、真实停机与生命周期仍待补验。范围封存见 ../coverage46-profile-reexecution.json。

机构与职位：最终报告 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-884d4200cf4346d992defcddb2b5c84e/evidence/coverage46-reexecution-browser-baseline.json` 的 10 场景／28 具体断言、后续跨模块链和清理通过，浏览器错误为空；4 张机构／职位明暗图已查看。字段 CRUD／复制、真正 Splitter 拖动、父级计数、人员主机构及附属机构、业务拒绝错误显示／按钮恢复／同框重试／取消、末页删除回第 1 页已通过。前一轮删除超时的根因尚未确定，原失败报告保留，最新逐请求状态／时长诊断未修改请求或回执。旧 hover 与新版 click 的差异及真实停机等仍待复核。见 ../coverage46-org-position-reexecution.json。

字典类型：最终报告 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-8ff51ab6cd5d4726ad7bb5e697202ec4/evidence/coverage46-reexecution-browser-baseline.json` 中 dict-types 组 23 条具名断言与后继跨模块／清理通过。先前脚本从方法名猜 GET 路由而失败 404，按生成 SDK 修正为 detail/dataList 后，再按 BaseStatusInput 的枚举校验补合法 status 参数通过；生产接口未修改。字典模块明暗图、其余 9 组仍待验。见 ../coverage46-dict-type-reexecution.json。

三份封存都保留 complete=false、proposalComplete=false、behaviorCoverageComplete=false；原表单字段已对应实际场景指针，未关联候选继续 needs-specific-evidence。以上范围成功不替代全部业务验收。当前 45 / 48，第 47、48 项未推进。

每次执行已复核浏览器经验：沿用嵌套定位、双汉字按钮、虚拟列表及稳定截图规则；新增并记录真实 GET 路由和继承 DTO 校验经验，不以 404／400 证明权限拒绝。

### 内置字典与状态缓存局部复验

字典类型、字典值、内置保护与启禁用缓存三个分组共 72 条具体断言，以及后继真实跨模块链和独立清理，通过最终报告 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-db6b75f5ae1a4dbb8db703c381752732/evidence/coverage46-reexecution-browser-baseline.json`（SHA256：`038e1d8d1aa489047c8a4ef3ccf292b8a3d9edc1387157ba6d9cbeeee3c15cc7`）。每条断言指针封存在 `coverage46-dict-type-values-flags-reexecution.json`。

本轮先明确 UI 退出撤销了原 API 会话，再重新登录本轮身份；内置保护测试显式核验租户、用户和三个端点权限后，才断言真实业务拒绝。最终 browserErrors、caseErrors、cleanupErrors 均为空，原会话失效失败报告保持不变。尚未拍摄字典模块明暗截图，多语言、租户、语言翻译与整项汇总回归仍待验；Execution 保持 in-progress，进度保持 45 / 48。


### 语言状态独立候选：原 API 红证据与桌面回归

- 主语言源码仍保持基线，独立 Release 候选仅增加 `Active.HasValue` 的查询条件。原真实 API 与桌面启用／禁用筛选红报告保持不变。
- 候选真实 API 的 `true`、`false`、省略及显式 `null` 4 项均与 PostgreSQL 的 ID 集合、总数一致；真实 Nginx、生产 Edge 页面原 51 项字段、查询、排序、保存、下拉及审计断言，以及后继跨模块流程通过。两张语言编辑器明暗截图已实际查看，无通知遮挡、字段或按钮裁切。
- 逐报告、DLL 实际映射路径／SHA／进程启动时间、唯一编译源、旧／新源码、具体 JSON pointer、结束时工具读回和已查看图片 SHA 封存于 `coverage46-language-candidate-reexecution.json`，封存器为 `seal-coverage46-language-candidate-evidence.mjs`。
- 该结果仍为候选局部通过，`primaryFixApplied=false`，未应用主语言条件、未重建主产物，完整第 46 项保持未完成，完成数仍为 45 / 48。语言分页、批量删除、身份刷新、异步拒绝和翻译等其他分支继续验收。
- 扩大到异步组的后续重跑在 `language.query.reset` 等待响应超时，尚未进入 5 项异步验收；其原报告 `adminnet-vben-0bfadf0aad7c4414b6d99ac2ba224ffb` 保留，清理通过，超时根因尚未确认。主会话已实际查看失败图，未用重跑猜测替代根因。后继独立 5172 仅运行真实前提齐备的异步小范围。

### 2026-10-14：按当前检查点恢复中断执行

用户明确要求从第 46 项当前状态继续。整体保持 45 / 48，Execution=in-progress；主源码尚未应用候选，不将模型执行 AUTH 中断记为项目接口失败。临时构建、候选及完整证据保存于 D:/tmp，仓库只保留必要源码与轻量记录。

当前固定组合的精确入口为 `coverage46-combined-frontend-control.tmp.json`（44 个运行源，441 个文件，manifest SHA256 507d1c024d8c9faf8ba19f5b07a503bd145a19d27277a01097be8624b0c895fa）及 `coverage46-combined-backend-control.tmp.json`（五份后端修复）。下一独立组合为 `coverage46-frontend-next-control.tmp.json`（47 个运行源，443 个文件，manifest SHA256 71a0f3aa1936be7846914a7e8c54a6e742274e282b9677a51bb68e6f5f60945a）及 `coverage46-backend-next-control.tmp.json`（七份后端修复）。两份前端都有完整类型、lint、生产构建、605 项回归及实际源码加载追踪；这些工程结果只证明组合兼容，不替代完整旧行为验收。

七源后端选中 REST / SignalR 兼容证据见 `coverage46-backend-next-acceptance.json`（SHA256 092e7baeeba7607fde694b90738232e8e61ec4f725b54b03cb5132e3468137eb）：实际模块路径和哈希、真实 GPU、原官方区域同步 3,222 行、语言筛选、模板排序、原子批删、邮件必填拒绝和服务端可信发送者通过，清理通过。邮件成功 SMTP 沿独立候选记录，不从必填拒绝推出成功外发。

固定 44 源产物首页的真实登录、布局、农历和日程新增／删除已通过。后续组合范围中断在调度步骤，原未完成报告保持；同 DLL 恢复自有 API 后，代码生成主／字段及在线行归零，原授权 JSON 和 27 表基线恢复，再核归属停机并删除本次代理、数据库容器，独立恢复报告 `combined46-recovery-789e6dc7.json` 不改写旧报告为通过。继续只补调度与表格未完成范围。

代码生成、身份交互、认证自动继续、日志冷却的最后变体仍独立核验／封存。完整逐行为映射收齐后才应用最终修复、统一构建并执行最终桌面 PostgreSQL 跨模块回归；整项通过后再更新完成数、中文提交和 compress。第 47、48 项保持未完成。Issue 插件本次 backend=markdown，开始上报 46 仍返回 not-found；按现有本地编号文件记录，不新建重复 map 或远端票。

## 2026-10-16 用户豁免与安全收尾

用户明确要求跳过登录页大写锁定提示、Windows 通知可信点击、切回系统后通知及时消失三项，后续优化；本次只登记豁免，不记通过、不扩展到其他功能。停止 Native 工具排障。原第 41 项真实播放豁免保持。当前真实测试资源已独立核对清理，原用户改动保留。第 46 项仍待最终集中跨模块回归、继承账本更新及中文提交。详见 [安全收尾检查点](../main46-safe-stop-and-waiver-20261016-checkpoint.md) 和 [用户豁免记录](../coverage46-user-native-waiver-20261016.json)。

## 2026-10-16：第 46 项最终闭合

最终继承账本保持原 1,752 个行为编号、56 个功能组和既有范围边界，未增加 mandatory。R6 主工作树真实桌面/PostgreSQL 的普通用户非空权限、Profile/职位读写与拒绝、同用户租户 A-B-A、直达刷新和真实停机 502 场景通过；HTTP/TLS、SignalR 在线与退出、专业调度看板/API/SSE 通过。

跨模块原报告的 cleanupPassed=false 原样保留；同一 PostgreSQL/配置/DLL 重启后，通过真实管理 API 清除已核身份的停机残留连接，恢复验证码和 11 张表稳定字段及权限原文，核对后才删除自有环境。forceOffline 是维护恢复，不冒称原 UI logout 效果。9 张当前截图已实际复核，两条被同路径覆盖的旧截图不计通过；专业 iframe 自身浅色如实记录。

按用户 m13702 原话，登录页大写锁定提示、Windows 通知可信点击、切回系统后通知及时消失，均记 waived-by-user、passed=false，待后续优化；Native 排障已停止。第 41 项真实播放豁免继续有效。

已排除原用户改动的 82 路径提交候选有独立正常源码副本，type、lint（5 warning）、production build、Web.Entry net10/Core net8 build 通过；D 环境适配的完整 Vitest 为 136 文件/1,080 例、Node 原生 10 例通过。默认 unit 的环境失败及全部旧失败原始日志保留，不声称零配置默认命令通过。测试 import 仅补两处空行。

可复核小索引：coverage46-final-acceptance-20261016.json；完整继承账本与日志位于 D:/tmp，SHA 固定在该索引。生产部署/切换未获授权。第 47 项仅在本项中文提交后开始，第 48 项依赖第 47 项。
