# 第 39 项删除范围核对

2026-10-12，第 83 轮。上一项提交 0888e25c6，整体 38/48。正式 check-proposal-closeout --next 39 --host-url http://127.0.0.1:19387 --review-file .scratch/proposal-agent-lifecycle/next-39-review.json 退出 0，next-39-cli-audit.json 为 reviewed-clear、blockers=[]。当前仅 Lead；历史成员已经由宿主归档，无需唤醒旧会话。

## 已核对源码

- SysWechatPayService 独占微信支付下单、查询、退款和回调实现；移除其专属 SysWechatPay/SysWechatRefund 实体、WechatPayInput/Output DTO、WechatPayOptions。
- PayCallBackOptions 同时声明 WechatPayUrl、WechatRefundUrl、AlipayUrl、AlipayRefundUrl。仅移除微信属性，保留支付宝属性及共享注册，不能整文件删除。
- Web.Core/ProjectOptions.cs 注册 WechatPayOptions 与 PayCallBackOptions，前者删除，后者保留。
- SysMenuSeedData.cs 包含微信支付菜单 1300300150101 和 5 个按钮种子 1300300150201 至 1300300150601。
- Core.csproj 直接依赖 SKIT.FlurlHttpClient.Wechat.TenpayV3 3.18.0；GlobalUsings.cs 有 4 条对应 using。删包前须最后核实其他消费者。
- 旧 Web/src/views/system/weChatPay/index.vue、Web/src/api/system/weChatPay.ts，以及旧 src 与新 apps/web-antdv-next/src 下两套 api-services 支付 API 和模型均需清理。
- GLOSSARY.md 与 docs/adr 当前不存在；已读取 docs/agents/domain.md 和 Core/CLAUDE.md。

## 下一步

继续核对生成客户端实际导出文件、旧页面组件、配置键（只提取键名，禁止输出配置凭据）、已有数据库菜单的运行时过滤机制和测试位置，再执行删除。业务删除尚未实施，尚未构建或验收，不得记为第 39 项完成。

真实验收使用隔离 PostgreSQL/API 与生产构建桌面浏览器，确认移除路由返回 404、Swagger 不暴露支付端点、菜单无支付入口且微信用户管理仍可用，最终检查隔离资源清理；不调用真实支付或退款，不删除任何现有业务数据库数据。

保留用户现存 .gitignore、doc/frontend-vben-tickets-draft.md、progress.md 无关差异和 docs/agents/proposal-closeout.md 删除；当前暂存无本项业务变更。文件和引用清单见 payment-files.txt、payment-references.txt、payment-shared-references.txt、payment-old-view-files.txt。

## 第 84 轮实施结果

已删除 6 个后端专属文件（payment-backend-deleted.txt）和 38 个前端专属文件（payment-frontend-deleted.txt）。移除 TenpayV3 包和四个 global using、WechatPayOptions 注册、PayCallBackOptions 两个微信字段，保留支付宝字段和共享注册。移除两套 api-services 的支付导出和 6 个 SysMenu 支付种子。未操作任何数据库数据。

pwsh-6 后端构建退出 0，payment-api-build.log 记录 0 错误；输出 payment-api-build。注意此构建先于菜单种子删除，最终验收前还需最终构建。pwsh-8 前端 vue-tsc --noEmit 退出 0，日志 payment-typecheck.log。源码范围 cs/csproj/ts/vue 的 payment-remaining-references.txt 为空；不代表 JSON 配置、文档和运行时数据库菜单已完成清理。

待续：支付相关 JSON 配置只提取键名并清理，不打印密钥；核验旧数据库菜单的前端过滤/回退；生产构建、真实隔离 API 路由 404/Swagger、桌面菜单和微信用户回归、清理证据。不得连接真实支付、删除历史业务表或将本轮类型检查视作完整验收。整体仍 38/48，本项未提交。

## 第 85 轮最新状态

Wechat.json 已删除 WechatPay 区块和两个微信回调键，保留公众号、小程序及支付宝配置；未输出配置值。APIFOX 删除 6 个支付模型，已核对保留内容无被删模型 ID 引用。remove-payment-config.mjs 已执行成功，非幂等，不要重复执行。

GetLoginMenuTree 构树前按原支付 Name、Path、Component 过滤入口及后代，Vben 共用结果；不删历史数据，管理记录仍可维护。尚待真实旧库菜单夹具验证。

pwsh-12 最终 API 构建退出 0（payment-final-api-build.log，输出 payment-api-build）；pwsh-13 production 前端构建退出 0（payment-production-build.log，输出 Web/dist）。下一步真实隔离 PG/API+桌面验收：旧端点404、Swagger无端点、旧菜单过滤、微信用户管理可用、资源清理；检查 APIFOX 序列化差异范围。整体38/48，本项未验收未提交。

## 第 86 轮：精确差异与验收准备

APIFOX 清理已改为保留原始格式的对象范围删除，语义深比较与既有清理结果完全一致，差异由新增442/删除1253缩小为新增0/删除497（6模型）。中间 PowerShell 文本管道乱码导致临时副本 JSON 解析失败，未写回源文件；改用 Git 原始 UTF-8 字节后通过。

已编写 payment-removal-flow.mjs、prepare-payment-removal-baseline.mjs，并生成 run-payment-removal-baseline.mjs；node --check 通过。组合第38真实权限矩阵/浏览器/清理流程，使用 payment-api-build、端口5039、独立报告；增加 Swagger/模型清理、12旧路径GET/POST共24次404、新库菜单及种子检查。目前未执行，仍需注入旧菜单验证过滤后再验收与提交。本轮复核浏览器技能，无新增已验证通用经验。

## 第 87 轮：旧菜单真实夹具与运行中验收

payment-removal-flow.mjs 已增加通过 sysMenu/add 创建的 5 个菜单夹具：旧支付入口、子菜单、仅旧路径、仅旧组件、保留入口。检查 loginMenuTree/vbenMenuTree 过滤、原库记录摘要不变，finally式逐项删除后核 sysmenu/systenantmenu/sysrolemenu/sysusermenu 无关联残留及全菜单摘要恢复。

组合脚本生成与 node --check 通过；pwsh-19 正在运行，日志 payment-browser-baseline.log，结果未收集前勿并发启动5039。git diff --check 通过，仅 CRLF/LF 提示；最终支付类型/配置/TenpayV3源码引用扫描为0。pwsh-20退出1来自rg无匹配的正常返回值，不是构建失败。

deck_context 返回 markdown 后端但 map.md 缺失；deck_issue_create 返回 backend-unsupported/not-found，无法识别现有 frontend-vben-migration effort，未建立新票。保留本记录继续执行，未将该工具限制算作业务阻塞。本轮复核真实浏览器技能，无新增已验证通用经验。整体仍38/48，第39未提交。


## 第 88 轮：最终交付



## 第 39 项完成（2026-10-12）

微信支付订单、退款后端及客户端、TenpayV3依赖、配置、种子和API示例已删除，保留微信用户管理及历史数据库数据。最终真实隔离 PostgreSQL/API/Edge 生产桌面报告：C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-f4a8881d9cd8497ab4c0bef89e689202/evidence/payment-removal-baseline.json，12阶段 passed/cleanupPassed=true，12旧路径24请求404，旧菜单过滤及保留普通入口、库记录不变、微信用户权限/CRUD/头像/防重复/停机回归通过。菜单及租户/资料夹具、API和容器清理通过。已实际查看列表与停机草稿截图；editor命名图片实际为列表，不作为编辑弹窗视觉证据。最终前后端构建、类型、引用扫描、差异检查通过。详见 payment-removal-scope.md。下一项40须先核验收尾门禁。

56个业务路径已与44删除、12修改白名单核对，Windows分隔符已归一化。Issue插件此前无法识别effort，交付记录使用本文件。真实浏览器技能已复核，无新增已验证通用经验。
