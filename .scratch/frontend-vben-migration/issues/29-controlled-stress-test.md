# 提案 29：受控压力测试

Status: ready-for-agent
Execution: completed

## 目标与边界

迁移旧 `system/stressTest` 功能。保留 GET / POST / PUT / DELETE、Headers、表单 Body、Path、Query、每轮请求量、轮数和并发。仅超级管理员且获 `sysCommon:stressTest` 授权的用户，对服务端明确配置的隔离目标执行；参数有边界，异常或取消不能显示为完成，统计与真实接收端一致。

遵循当前用户桌面验收边界；使用隔离 PostgreSQL、真实 API 与生产构建的 Edge。契约、真实联调、明暗视觉、资源清理分别记录。用户已有的 `AGENTS.md`、`doc/frontend-vben-tickets-draft.md` 修改不纳入本项提交。

## 实现

- 服务端默认关闭；通过 `StressTestOptions` 配置目标、总量、轮数、每轮数量、并发和超时，并在宿主 `AddProjectOptions` 中注册。仅允许配置中的数值 IP、同源且匹配路径前缀的 URI；Path 替换前后均校验，禁用重定向、代理和自动 Cookie。
- 两个端点均显式授权并检查超级管理员，保留原四个公共加密 / 状态接口的匿名行为。单任务互斥、顺序轮次和有界并发，按请求独立下标保存成功响应耗时，保留原成功样本平均 / 最值 / 分位数口径；全失败耗时为零。
- 新页面与旧 Component / 地址兼容。Headers / Path / Query 字典拒绝不区分大小写的重复键，Body 保留重复键；前后端校验边界一致。取消、离页、身份变化释放请求，迟到响应不得污染当前结果，停机保留可编辑草稿。
- 生产代理传播浏览器取消到 API 的 `RequestAborted`。具名 Form 使用 FormItem 自动生成的控件 ID，真实内部下拉框具有可访问名称。

## 契约和工程验收

- 后端边界与路由权限测试 90 / 90；API / Test 构建通过。日志：`.scratch/frontend-vben-migration/stress-unit-tests.log`、`stress-api-build.log`。
- 前端路由 / 会话 / 参数测试 54 / 54；ESLint、类型检查和生产构建通过。日志：`stress-frontend-tests.log`、`stress-eslint.log`、`stress-page-eslint.log`、`stress-typecheck.log`、`stress-production-build.log`。
- 独立生产代理、Edge `--project=desktop` 的契约 8 / 8；覆盖别名、参数与统计、验证拒绝、取消、权限、全失败、明暗主题，实际内部 combobox 名称已回归。日志：`stress-desktop-contract.log`。

## 真实联调验收

最终报告：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-1be5382ddf56446c992b56ef5cbfb41c/evidence/stress-browser-baseline.json`。

- `passed=true`，11 阶段通过。隔离 PostgreSQL 与真实 API / 接收端有效，主库、日志库和租户数据均使用 PostgreSQL。
- GET / POST / PUT / DELETE 各 12 次、成功 8 / 失败 4、峰值并发 2；3 轮依次执行，Headers、重复表单 Body、中文 Path、已有及新增 Query 与真实接收记录一致。成功 / 失败 / 总数、QPS 和成功响应耗时分位数口径核对通过。
- 匿名、普通账号、已有压测按钮授权但非超级管理员均拒绝且不派发；目标、路径、方法、预算和 Header 非法值在网络前拒绝。
- 全失败如实显示；302 不跟随授权路径外目标；真实请求超时计失败，全失败响应耗时为零。
- 生产桌面提交返回真实 12 / 8 / 4 结果；未授权目标没有派发。取消后仅派发 4 次、后续停止且不假完成；离页终止派发并清除旧结果；停机显示失败并保留草稿。

## 视觉与清理

- 已实际查看最终真实完整明暗结果卡片 `29-stress-light-results.png` / `29-stress-dark-results.png` 和 `29-stress-stopped-api-results.png`，结果、单位、七个分位数及失败说明清晰，无截断。配置页与完整结果独立截图。
- Mock 完整明暗结果卡片位于 `Web/test-results/stress-desktop-contract`，内容与先前已检查像素哈希一致。
- 最终报告 `cleanupPassed=true`、`cleanupErrors=[]`、`containerRemoved=true`、`apiStopped=true`、`receiverClosed=true`。隔离 API、生产代理、浏览器和接收端停止，PostgreSQL 容器及卷按标签校验后移除。

## 经验复核

- 已复核 `.agents/skills/real-browser-baseline/references/lessons.md` 的 Select 辅助节点、FormItem `name`、KeepAlive 当前页、有限动画 / 通知和内部滚动区经验；此次新增宿主选项注册、手写 ID 与标签冲突、代理取消传播、完整统计卡片截图结论并回写经验库。
- 首次真实报告 `Temp/adminnet-vben-fcab6437d81a496897a66ff7baa0bb9f/evidence/stress-browser-baseline.json` 失败，发现宿主遗漏选项注册；该次清理通过。第二次真实报告 `Temp/adminnet-vben-77c21b2e64a64833abd66c5ca0dd53ca/evidence/stress-browser-baseline.json` 服务通过但下拉框无名称，按 DOM 修复手写 ID 后最终全量通过。
- 首次 Mock 未安装默认 Chromium，改用已安装 Edge；随后 4 / 8 的隐藏 option / alert 歧义按失败 DOM 修正后，最终 8 / 8。失败历史不作为完成证据。

## 评论

2026-10-10：提案 29 已完成，按编号推进提案 30。
