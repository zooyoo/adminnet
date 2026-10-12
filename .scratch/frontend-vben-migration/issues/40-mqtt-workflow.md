# 40：MQTT 连接与消息工作流

Status: ready-for-agent
Execution: completed

## 范围

迁移 MQTT 页面到 Vben / Antdv-Next，使用 MQTT.js 5.16.0 保留连接配置、注册包主题、原始消息和设备指令封装、订阅与取消、QoS / Retain、继电器、空调、在线与温湿度状态。按连接代次隔离异步回执；离页与身份切换释放连接并清除凭据。

## 验收

- [x] 18 项配置与会话回归、目标目录 ESLint、应用类型检查和生产构建通过。
- [x] 真实隔离 broker 与 PostgreSQL / API，生产 Edge 桌面登录、订阅发布收消息、设备协议和日志脱敏通过。
- [x] 明暗桌面无横向溢出，最终两张桌面截图已实际复核。
- [x] 显式端口绑定回归通过，真实 broker 重启后原地址恢复订阅并继续收消息。
- [x] 取消与断开、双身份 ACL 消息隔离、错误认证、第二 broker 切换、同文档离页和原生 / Playwright WebSocket 关闭全部通过。
- [x] 最终业务验收与资源清理同时通过，总进度更新为 40 / 48，代码按第 40 项单独提交。

## 变更与依据

会话终止覆盖在线、离线、重连和连接中；拒绝未完成操作并隔离迟到消息。部分 SUBACK 授权失败时终止 clean session，防止界面未登记的订阅残留；空传感器注册包按设备注册包接收温湿度。凭据只保存在页面与活动连接内存，错误和消息按原文与编码形式脱敏。在线且无未确认操作时发送 MQTT DISCONNECT 完成 WebSocket 关闭握手；连接中、离线或协议待确认消息未结束时强制结束，关闭回执前即移除活动客户端认证信息。

## Comments

- 2026-10-12：已完成实现和静态检查；真实验收发现并修复 Docker 重启重新分配端口的夹具问题。原生关闭握手与 Playwright 回执按独立证据复核中，尚不计入完成数。

- 2026-10-12：真实源码快速回归先复现 end(true) 后原生 readyState=2，再验证修复后约 3 毫秒 readyState=3；18 项单测、ESLint、类型检查和生产构建通过。完整取消 / 断开已通过，双身份 ACL、错误认证、切换与离页验收进行中。

## 最终证据

- 原始报告：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-1ae917126a3447d9ac24e465023d34fd/evidence/mqtt-browser-baseline.json`。
- `passed=true`、`cleanupPassed=true`、`cleanupErrors=[]`；11 个真实阶段、6 条原生 CLOSED / Playwright close 通过，菜单四关联表、两台 broker 与匿名卷、API、PostgreSQL 清理通过。
- 已复核 `40-mqtt-device-light.png` / `40-mqtt-device-dark.png`，1680 × 1100；报告、源码、截图 SHA256 保存于 `../mqtt-acceptance.json`。
- 桌面端使用真实 API、PostgreSQL、生产构建和授权本地 broker；部分 SUBACK 失败以单测验证，ACL 投递隔离以双身份真实消息和允许主题后续消息验证。
