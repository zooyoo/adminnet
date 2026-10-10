# 提案32：区域管理

- Status: ready-for-agent
- Execution: completed
- 目标：授权用户浏览并维护区域数据，保留层级、编码、查询与排序合同。
- 范围：新前端树形导航、查询分页与既有增删改；非法父级、服务失败、刷新和权限边界。保留旧前端及既有区域种子，不触发远程全量同步。
- 当前整体进度：32/48；下一项33。

## 原有合同与实现

- page 的 pid > 0 包括父区域自身和直接子区域；名称与编码为 Contains 查询，默认分页50条。list?id=0 为顶级，list?id=父Id 为直接子区域，tree 为完整层级。
- 行政编码 Trim 后长度须为6、9或12，保留非数字编码；重复判断为名称与编码组合，同编码不同名称可保留。排序使用 OrderNo、Id。
- 非零父级先按Id、再按行政代码解析；父级不得为自身或自己的子孙。无效父级、编码、重复与不存在记录均在写入前拒绝。
- 删除包含自身与子孙；编辑保留原pid及未编辑的隐藏字段，新增默认排序100。前端树表分离，表格不递归重复展开children。
- page/add/update/delete/sync要求显式授权；共享list/tree仍为认证元数据。四管理权限独立，不增加999限制。Sync与其私有辅助原文保持，不执行远程同步。
- canonical /system/region，兼容/platform/region和旧组件地址。身份、权限、KeepAlive离页和卸载中止请求、拒绝迟到响应；保存失败留草稿，删除取消无请求，忙时防重复。

## 验收

- [x] 前后端行为及契约单元测试
- [x] lint、类型、API/Test与生产构建
- [x] Edge生产桌面Mock契约
- [x] 真实PostgreSQL API与持久化核验
- [x] 生产桌面真实CRUD、失败恢复、权限、离页与停机
- [x] 明暗页面、编辑器及失败态视觉复核
- [x] 数据、进程、代理与容器清理独立证据

## 工程与Mock证据

- 后端API/Test构建通过；Region68项、RoutePermission53项合计121/121，失败0、跳过0。首次非法输入测试因Furion缺测试宿主初始化失败，加入只Build、不Start的assembly fixture后精确AppFriendlyException断言通过。
- 前端区域29项；区域及开放签名、更新、压测的相关菜单归一化回归合计141/141。正式源码ESLint、应用类型、E2E严格类型与生产构建通过。
- Edge生产桌面Mock18/18，30.8秒，仅 --project=desktop；生产/jse带hash入口且拒Vite。共享fixture强制ESLint的13项历史问题与HEAD一致，antdv CLI仅回显参数，均未记为检查通过。
- 日志：region-{api-build,test-build,unit-tests,frontend-tests,production-build,desktop-contract,real-browser}.log。各日志留在本地，不提交临时输出。

## 最终真实证据

- 报告：C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-f22e2baf6b1d4be3963a4c6feea76c9e/evidence/region-browser-baseline.json，passed=true、cleanupPassed=true，14阶段，context-97执行exit0。
- 三个数据库连接均为PostgreSQL；核验临时目录、API进程标识、早期启动交接文件及容器标签。数据库连接只读反查，实体通过真实API创建、修改与删除。
- 新隔离库初始区域数量为0；通过真实API准备4条带简名、全名、邮编、拼音、级别及经纬度的既有层级，再取得非空全字段摘要。整个业务过程摘要 76a3fb2fe59c81d8a79fcd89211c89ca 一致；清理先证明既有层级未动，再删除自己准备的数据，恢复初始摘要 d41d8cd98f00b204e9800998ecf8427e。
- 匿名、无grant和只读账号的有效管理请求被鉴权拒绝；授权非999账号真实CRUD。鉴权拒绝明确核验401/403，参数拒绝排除鉴权码，不以失效登录掩盖校验问题。
- 真实验证父级Id/编码解析、6/9/12及ABCDEF编码、组合重复、Contains、父自身加直接子级、稳定排序；非法自父/后代/不存在父级/编码/重复/不存在记录不写；完整更新保留隐藏字段，级联删除精确仅自己的子孙，其他fixture全字段不变。
- 生产Edge1680×1100真实权限、新增与PG持久化、无效编码、重复保存失败保草稿、修改并重开、删除取消零请求/确认真实删除；同文档路由导航保留文档标识，离页页面隐藏且无新保护请求，重入有page请求并无遗留dialog。
- 最后停止真实API，保存获得服务不可用响应，草稿、错误提示与可用保存按钮保留；SQL证明未写入且初始数据摘要仍一致。
- 临时区域、租户、用户、组织、角色、职位及TenantMenu/RoleMenu/UserRole关系反查均0。准备基线删除、初始摘要恢复、浏览器/代理关闭、API不可达与归属PG容器/卷移除均通过，cleanupErrors=[]。

## 视觉与失败记录

- 已逐张查看最终32-region-{light,dark,editor,save-failure,stopped-api}.png及Mock明暗列表/编辑器4张图。树与列表、分页、完整字段、中文备注、错误提示和操作按钮可读，无裁剪或遮挡。真实明/暗图SHA256分别3a401170e6004822ea16a6f115a5a887cc6eb9f2fe82d51d61ff69db5c9ebf08、534401847cb16c513f84f31bc3982dbf0ed82ef4e2f46ed168af3efb53fc93a9。
- 首次真实在空隔离区域库的非空断言停止，passed=false/cleanupPassed=true；修为API准备非空既有数据后继续。
- 第二次真实已通过服务与浏览器CRUD，离页误用/system/cache返回404；失败截图确认，功能未算通过，既有摘要和独立清理通过。现行种子缓存地址为/platform/cache；修正为同文档导航，并增加积极重入计数，最终全流程通过。
- 失败DOM按body收集无字段值的控件元数据，覆盖业务页与404边界；正文和报告不保存登录凭据。已复核real-browser-baseline并将本项验证过的非空快照与同文档路由经验追加到经验库。

## 执行边界与复验

仅桌面Edge与隔离PostgreSQL，不连接生产、不执行远程同步、不清旧前端。用户AGENTS.md、doc/frontend-vben-tickets-draft.md、.gitignore修改保留不提交；logs、临时标识/路径/摘要JSON、组件info/demo和截图均不提交。

使用提供的Node执行run-region-browser-baseline.mjs；桌面契约使用run-region-desktop-contract.mjs与DSH_REGION_PNPM_PATH指定提供的pnpm，仅desktop。运行前复核真实基线Skill与经验库，报告先失败、清理独立。
