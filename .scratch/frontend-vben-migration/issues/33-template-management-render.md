# 提案33：业务模板管理与渲染

- Status: ready-for-agent
- Execution: completed
- 当前整体进度：33/48；下一项34动态插件管理。
- 目标：维护原模板分组、内容与参数，在真实编辑器调用现行渲染接口查看结果。

## 最终实现与合同

- 新页面 /system/template，兼容 /platform/template 与原 Component=/system/template/index。独立 sysTemplate:page/add/update/delete/preview，普通授权账号、本租户范围与越权拒绝；不新增超级管理员要求。
- 保留 Type=1/2/3/4/5/7、分组/名称/编码 Contains、默认20条、OrderNo+Id、名称原租户范围和编码全局唯一。旧 GET /api/sysTemplate/template/{code} 仍按 Name==code 查询；原接口签名、实体与种子不改。
- 所有编辑字段、原 Content、row 扩展字段与预览参数无损；富文本1/纯文本2仅为本地编辑方式。Render 明确发送原字符串 Content 与原 Data 键，使用真实 Axios 序列化保留 __proto__/constructor/prototype；保存/渲染失败留输入重试，取消删除零请求。
- 模板专用 WangEditor 6.5.0 执行真实编辑/工具栏，初始化、setHtml、源码/富纯切换不回写。复杂源码保留原文编辑，禁上传；原内容不经通知组件的初始化净化回写。实际 selection、菜单就绪、strong、渲染与保存载荷、保存后重开均已验证。
- 浏览器展示按有限静态标签/样式白名单重建，空 sandbox iframe 与 CSP 隔离脚本和网络；原始输出 pre 保留，未把返回 HTML 注入应用。实际危险 script/img/link 探针不执行、不请求，原输出仍可查看。
- 后端只写7业务字段及原更新审计字段；实际 SqlSugar ToSql 显示原自定义 WHERE 缺独立Id，修为 Id+TenantId，真实成功更新保同租户 peer、他租户及既有全文快照。校验字段、枚举、有效Id、重复、缺实体及外租户输入，失败不写。
- 仅HTTP共用渲染入口将 JsonElement 递归转 Expando/数组/原数字与值；CLR/Dictionary原实例保持。原 RenderAsync 与 RenderByCode 两个 NonAction 正文（规范换行后逐字）及 Razor Regex/引用完全保留，内部 RenderByCode 不走HTTP转换，不扩展既有执行能力。
- 身份/租户/任意权限变化、KeepAlive离页与销毁清理 AbortSignal/迟到状态；同文档离页停止保护请求，重入有实际请求且无旧弹窗。

## 验收

- [x] 前后端合同与必要回归单元
- [x] 正式ESLint、类型、API/Test与生产构建
- [x] Edge生产桌面Mock契约
- [x] 真实PostgreSQL CRUD、租户、授权、渲染及既有模板快照
- [x] 生产Edge编辑/预览、失败恢复、离页及最后真实API停机
- [x] 完整明暗页面、富纯编辑器与渲染/错误视觉
- [x] 实体/授权关联、浏览器/代理/API与标识PG容器清理

## 工程与生产桌面证据

- API/Test 构建通过；MTP/xUnit v3 真跑113/113，0跳过（模板60+路由权限53，.NET10.0.12）。前端53/53（session25/editor8/display16/route4）、vue-tsc、11正式源文件ESLint 0错误/0警告、E2E强制lint/独立TypeScript通过。
- 最终1行主题活动背景修正后重新 ESLint、类型与production build，再跑全15生产桌面，40.9秒通过：msedge1440×1000，仅 --project=desktop，/jse/带hash入口且拒Vite。独立生产代理finally关闭。
- 原实际加粗case内部两主题各跑真实选择→菜单enabled→加粗→strong→原字符串render/update→保存重开完全相同；active非hover与active+hover4次实际SVG/path fill与透明祖先背景合成对比均>=3，独立JSON与PNG落盘。浅色 rgb(50,54,57)/rgb(244,244,245)=11.092509308967701；暗色 rgb(242,242,242)/rgb(46,48,51)=11.821919487070366。
- 日志：template-unit-tests.log、template-production-build.log、template-editor-final-style-eslint.log、template-desktop-contract.log；前端正式检查日志在 apps/web-antdv-next/template-frontend-*.log，仅作为本地证据不提交。
- 共享fixture强制lint与HEAD逐条一致的13项历史错误不计通过；antdv lint只有 Parsed args 回显，不计有效检查。未新增依赖。

## 最终真实与清理证据

- 完整报告：C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-1608732a23f441449be7fbb939c74583/evidence/template-browser-baseline.json。passed=true、cleanupPassed=true，16阶段全部通过，cleanupErrors=[]；使用最终 production assets 与 Edge1680×1100、隔离 PostgreSQL18，核验PID/临时目录标識/容器label与3个PG连接。
- 有效参数的匿名/未授权/只读写权限拒、types/group/legacy GET/name查询、跨租户/伪造ID与Tenant拒、字段/枚举/重复不写、成功更新仅目标且精确原文/清空备注、Contains/三页精确ID及排序、原Razor占位/循环与错误修复重试、仅删除目标、真实非999页面权限均通过。
- 实际生产编辑器参数/未保存render/错误恢复/addPG UTF8全文、无改重开/重复save留草稿/update、富初始化与切换保原文、真实加粗/字体>=600/源码roundtrip与脚本网络隔离、删除取消/确认、同文档离页/重入、最后真停API后精确add POST>=500且计数+1、业务错误/草稿可编辑/PG无写均通过。
- 初始count0，真实API准备3条非空既有模板，全字段摘要 2afad5fad120239b8e2a6269428b1b10 前后完全相同；业务后先保护快照，再删准备数据恢复初始摘要 d41d8cd98f00b204e9800998ecf8427e。
- SysTemplate、Tenant/User/Org/Role/Pos、TenantMenu/TenantConfigData、RoleMenu/UserRole/UserExtOrg/UserMenu/UserConfigData/RoleOrg全0残留；preparedBaselineRecordsRemoved/initialTemplatesRestored/fixtureRecordsRemoved/containerRemoved/apiStopped均true。browser/proxy/API/容器逐资源独立清理。
- 最终真实10PNG全部实际查看：light/dark、plain-editor、render-result/render-failure/save-failure、rich-editor/rich-edited-result、isolated-preview、stopped-api。完整Mock6明暗列表/编辑器/渲染图及4活动/悬停选中图另行检查；暗色活动图标白底白SVG已修，实际选中与提示可读。长真实Modal滚动截图与独立完整Mock编辑器/结果卡片共同提供视觉证据。

## 实际失败、修复与经验

- 首轮103/104为SQL断言误把SELECT TenantId投影算WHERE；独立Id判定不能 contains(id) 因tenantid也匹配。真实ToSql与成功更新peer快照之后修正，最终113通过。
- 第一次真实proView阳性400源于HTTP Data=JsonElement无法动态 Model.name，原引擎编译正常；仅HTTP模型适配后真实引擎9回归与完整真实Razor通过，两NonAction原文未改。
- 富文本Slate实际输入语义与异步菜单状态经真实DOM确认；初始化屏障不放宽，等菜单enabled和strong后检原载荷。别名过渡等待唯一活动页，不用first隐藏歧义。
- 通知hover暂停导致截图超时；先动态找无交互点移走，再自然等notice/字体/有限动画/Modal终态/真实scroll0，四项具名检查，不隐藏通知或加任意sleep。最终六图和四对比度图稳定。
- 第二轮真实前15阶段通过，最后按textbox定位AutoComplete分组超时；失败DOM/截图确认后只改combobox，完整16阶段复跑。失败DOM先JSON序列化再脱敏，不输出对象数组的[object Object]。
- 图中活动图标对比不足源于库默认浅色active背景与暗色SVG颜色；接入主题accent后两主题实际颜色对比、保存重开、全15与最终16再次通过。
- 停机异常后的重复清理守卫与恢复初始摘要选择经只读复核修正，Node语法通过；正常最终完整流程和独立清理实际通过，不宣称额外停机工具故障注入。
- 每次复核真实基线Skill/经验；验证的新经验追加 lessons.md。仅桌面/隔离PG；业务实体和授权经API，SQL助手只读反查；启动引导在自己的PG设置禁验证码不记实体API验收。没有生产操作、旧前端清理或引擎能力扩张。用户AGENTS.md、原提案文档、.gitignore保留不提交。

## 复验入口

使用当前bundled Node与pnpm、pwsh7 UTF8/Stop/nativeexit，先API/Test和正式前端检查/build，然后 run-template-desktop-contract.mjs（DSH_TEMPLATE_PNPM_PATH，固定desktop config），再 run-template-browser-baseline.mjs。仅源码、可复验基线与完成记录入本项提交；日志/截图/诊断JSON/临时runtime/store不入Git。
