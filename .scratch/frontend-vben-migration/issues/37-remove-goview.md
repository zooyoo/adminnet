# 37：删除 GoView 及入口等相关代码

Status: ready-for-agent
Execution: completed

## 范围

按 doc/frontend-vben-tickets-draft.md 第 37 项删除 GoView 后端插件、项目引用、前端 SDK、生成命令及相关入口。保留其他业务功能和历史数据库记录；只在隔离 PostgreSQL 与真实 API、生产构建桌面浏览器中验收。

## 待办

- [x] 核验第 36 项交付与下一项收尾门禁。
- [x] 清点 GoView 引用、最近的 CLAUDE.md 与入口，确认删除范围。
- [x] 移除相关代码并运行类型检查、构建和受影响回归。
- [x] 真实隔离验证旧接口和 Swagger 移除、保留功能、桌面截图及资源清理。
- [x] 更新进度、独立提交并压缩上下文。

## Comments

### 启动核验

第 36 项提交为 53bf822f6。已核对最终原始验收报告 passed=true、cleanupPassed=true、cleanupErrors=[]。宿主实时归档清单、17 个历史成员及额外只读侧会话与此前核验一致，历史业务处置逐项 SHA-256 不变；当前 list_agents 仅 Lead。

运行 `.scratch/proposal-agent-lifecycle/review-next-37.mjs` 及正式 `check-proposal-closeout.mjs --next 37 --host-url http://127.0.0.1:19387 --review-file .scratch/proposal-agent-lifecycle/next-37-review.json`，均退出 0，reviewed-clear、blockers=[]。证据保存在 next-37-audit.json 与 next-37-cli-audit.json。没有重新唤醒超长旧会话。

已核对规格第 250 行和 Codegraph 返回的 GoView Startup、实体及枚举。GoView 包含独立响应提供器及项目/项目数据实体；删除代码不代表删除历史数据库表。尚未修改第 37 项业务代码。

### 第 63 轮：实现与构建

- 已删除 46 个跟踪的 GoView 插件及 SDK 文件，移除解决方案和 Application 项目引用、package 生成命令及 PowerShell/Bash/bat 对应分支。删除前核对绝对路径和跟踪清单；没有删除历史数据库记录或未跟踪产物。
- 活动源码引用扫描（排除 Markdown、环境文件、日志和生成产物）无残留；PowerShell 语法及 `-Module goView -WhatIf` 参数拒绝通过，未执行 Bash/cmd。
- 独立 API 构建通过且输出无 GoView 程序集；前端 typecheck、生产 build 与业务 diff-check 通过。日志 goview-removal-api-build.log、goview-removal-typecheck.log、goview-production-build.log、goview-diff-check.log。
- 新增 goview-removal-flow.mjs、prepare-goview-removal-baseline.mjs、run-goview-removal-baseline.mjs。沿用已验证隔离启动/清理设施，端口 5037、本次 API 输出与生产 Web/dist，逐一检查第 35 项原始 GoView Swagger 的 14 个旧接口、保留模板/登录/缓存及真实停机。任务 pwsh-93 正在执行，尚未声明真实验收或视觉通过。
- 无新子智能体；第 37 项尚未完成、未提交，整体仍为 36 / 48。

### 第 64 轮：最终验收与交付

- pwsh-93 退出 0。原始报告 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-1ac11a98a3d94850a29fea848d304fc2/evidence/goview-removal-baseline.json` 已直接读取：5 阶段、passed=true、cleanupPassed=true、cleanupErrors=[]；14 个旧接口及 GoView 文档 404，385 条主服务路径保留。
- 生产 Web/dist + Edge 1680×1100 + 真实隔离 PostgreSQL/API，无 Mock。真实账号登录、模板持久化与渲染、缓存刷新及真实停机错误通过；模板整表摘要恢复初始值，fixtureRecordsRemoved/containerRemoved/apiStopped 均为 true。
- 已实际查看同目录 37-login-no-goview.png、37-template-types.png、37-retained-cache.png：内容清晰，无加载遮罩或临时通知遮挡，保留的五类模板选项完整。
- 52 个业务改动路径已对照删除清单与六个入口文件核验。类型检查、前后端构建、生成模块拒绝及业务 diff-check 已通过，未执行 Bash/cmd。未操作历史数据库数据。
- real-browser-baseline 经验已复核，无新增通用经验；本次启动等待与截图规则沿用既有实现。
- 本项完成，总进度更新为 37 / 48。提交仅包含本项业务文件、验收脚本、issue 和进度差异，保留用户无关修改。下一项 38 仍须先核验收尾门禁。