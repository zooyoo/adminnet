# 第 46 项功能覆盖矩阵

本表将旧视图和公共组件逐文件绑定到当前新实现、编号提案及证据。旧源码内容不复制，只记录路径和 SHA256。第 41 项状态：已完成：真实播放按用户指令豁免。原始报告的实际验证范围和真值保留，整项决定见 coverage46-acceptance.json。

旧扫码仅生成项目二维码，旧拨号 Token/回调未消费，随机图表与固定进度是示例；这些不能当作已实现的认证或业务协议。静态调用、全局注册与未挂接工具分别记录，未挂接工具不计为业务端点。

历史报告采用多种结果结构；JSON 保留每个 passed/cleanupPassed/proposalComplete 的实际层级和真值。旧 SQLite 报告仅作历史记录，本轮跨用户和双租户的连续链使用真实 PostgreSQL，不能据历史证据声称所有模块均在本轮重测。

| 旧功能组 | 新行为 | 新实现 | 编号证据 | 状态 |
| --- | --- | --- | --- | --- |
| `views/about`（1） | 关于、版本与按需更新历史 | `views/_core/about` | 16 | 逐文件映射，业务证据见对应提案 |
| `views/error`（2） | 认证、权限与未找到页面反馈 | `views/_core/fallback` | 01 | 逐文件映射，业务证据见对应提案 |
| `views/login`（5） | 密码、手机、注册、LDAP、第三方 Token 与锁屏；旧扫码仅项目二维码 | `views/_core/authentication`、`api/core/auth.ts` | 01、11、12、13、14 | 逐文件映射，业务证据见对应提案 |
| `views/home`（13） | 欢迎、收藏、日程和工作台配置；随机收入图与固定进度示例已移除 | `views/home`、`views/system/notice` | 04、16 | 逐文件映射，业务证据见对应提案 |
| `views/elive`（1） | EZUIKit 8.0.5 原引擎、输入和控制；错误与清理已验，已完成：真实播放按用户指令豁免 | `views/elive` | 41 | 已完成：真实播放按用户指令豁免 |
| `views/mqttx`（1） | MQTT 连接、主题、收发、设备封装、重连及凭据清理 | `views/mqttx` | 40 | 逐文件映射，业务证据见对应提案 |
| `views/system/cache`（1） | 缓存树、搜索、详情与删除 | `views/system/cache` | 02、08 | 逐文件映射，业务证据见对应提案 |
| `views/system/codeGen`（5） | 全部主/字段配置、关联选项、复制、同步、预览、ZIP 与直接生成恢复 | `views/system/codeGen`、`components/admin`、`api/system/codegen.ts` | 42、43、44 | 逐文件映射，业务证据见对应提案 |
| `views/system/config`（2） | 系统参数和租户参数查询、编辑、校验与恢复 | `views/system/config` | 08 | 逐文件映射，业务证据见对应提案 |
| `views/system/database`（8） | 数据库/表/字段维护、关系图及实体与种子生成 | `views/system/database` | 24、25、26 | 逐文件映射，业务证据见对应提案 |
| `views/system/dict`（3） | 字典类型/数据、编辑、样式与状态 | `views/system/dict` | 08 | 逐文件映射，业务证据见对应提案 |
| `views/system/file`（2） | 目录/文件/图片、上传下载、媒体与 Office 预览 | `views/system/file`、`components/file-preview` | 17、18 | 逐文件映射，业务证据见对应提案 |
| `views/system/infoSetting`（1） | 站点品牌、登录注册与租户设置 | `views/system/infoSetting` | 10 | 逐文件映射，业务证据见对应提案 |
| `views/system/job`（5） | 任务定义控制、触发器/CRON、运行记录与独立调度看板 | `views/system/job` | 21、22、23 | 逐文件映射，业务证据见对应提案 |
| `views/system/lang`（2） | 语言定义及导入导出 | `views/system/lang` | 09 | 逐文件映射，业务证据见对应提案 |
| `views/system/langText`（2） | 多语言文本查询、维护与文件交换 | `views/system/langText` | 09 | 逐文件映射，业务证据见对应提案 |
| `views/system/ldap`（2） | LDAP 连接、同步、用户及真实登录 | `views/system/ldap` | 12 | 逐文件映射，业务证据见对应提案 |
| `views/system/log`（4） | 访问、操作、异常、差异详情及导出 | `views/system/log` | 27 | 逐文件映射，业务证据见对应提案 |
| `views/system/menu`（2） | 菜单树、图标、按钮权限及授权关系 | `views/system/menu` | 05 | 逐文件映射，业务证据见对应提案 |
| `views/system/notice`（2） | 公告发布、收件人、已读与富文本 | `views/system/notice`、`components/notice-editor`、`components/notice-content` | 04 | 逐文件映射，业务证据见对应提案 |
| `views/system/onlineUser`（1） | 真实在线列表、SignalR 与强制下线 | `views/system/onlineUser`、`api/online-session.ts` | 03 | 逐文件映射，业务证据见对应提案 |
| `views/system/openAccess`（4） | 签名、绑定权限、SDK 与开放入口 | `views/system/openAccess` | 31 | 逐文件映射，业务证据见对应提案 |
| `views/system/org`（3） | 机构层级、编辑和数据范围 | `views/system/org` | 06 | 逐文件映射，业务证据见对应提案 |
| `views/system/plugin`（2） | 插件安装、启停、升级与删除 | `views/system/plugin` | 34 | 逐文件映射，业务证据见对应提案 |
| `views/system/pos`（2） | 职位 CRUD、查询、输出、权限与租户隔离 | `views/system/pos` | 01、06 | 逐文件映射，业务证据见对应提案 |
| `views/system/region`（3） | 行政区域三级/层级维护、校验与导入导出 | `views/system/region` | 32 | 逐文件映射，业务证据见对应提案 |
| `views/system/role`（3） | 角色、菜单授权及数据权限 | `views/system/role` | 05 | 逐文件映射，业务证据见对应提案 |
| `views/system/server`（2） | 服务器与运行时监控、实时数据及停机反馈 | `views/system/server` | 28 | 逐文件映射，业务证据见对应提案 |
| `views/system/stressTest`（2） | 受控压力测试、报告与失败恢复 | `views/system/stressTest` | 29 | 逐文件映射，业务证据见对应提案 |
| `views/system/template`（2） | 模板维护、参数和真实渲染 | `views/system/template`、`components/template-editor` | 33 | 逐文件映射，业务证据见对应提案 |
| `views/system/tenant`（4） | 租户配置、状态、授权、切换及独立数据 | `views/system/tenant` | 07 | 逐文件映射，业务证据见对应提案 |
| `views/system/tenantConfig`（2） | 租户独立参数、重载与失效 | `views/system/tenantConfig` | 08、10 | 逐文件映射，业务证据见对应提案 |
| `views/system/update`（1） | 版本检查、更新记录与失败恢复 | `views/system/update` | 30 | 逐文件映射，业务证据见对应提案 |
| `views/system/user`（4） | 用户/机构/职位、角色、状态、重置密码及个人中心 | `views/system/user`、`views/_core/profile` | 06、15 | 逐文件映射，业务证据见对应提案 |
| `views/system/userRegWay`（2） | 注册方式和启用设置 | `views/system/userRegWay` | 10、11 | 逐文件映射，业务证据见对应提案 |
| `views/system/weChatUser`（2） | 微信用户和消息已实现操作 | `views/system/weChatUser` | 38 | 逐文件映射，业务证据见对应提案 |
| `components/auth`（3） | 旧权限组件 single/any/all；新页面权限及服务端拒绝 | `` | 05 | 旧工具未挂接，保留替代关系 |
| `components/callTel`（2） | 公开 /$callTel 拨号入口；callBar 在旧用户页未挂接 | `views/_core/call-tel` | 46 | 逐文件映射，业务证据见对应提案 |
| `components/CardPro`（1） | 首页及业务卡片布局 | `views/home`、`views/system/cache`、`views/system/server` | 16、28、29 | 逐文件映射，业务证据见对应提案 |
| `components/cropper`（1） | 个人头像与背景裁剪 | `views/_core/profile` | 15 | 逐文件映射，业务证据见对应提案 |
| `components/dialogPro`（2） | 日志详情弹层、操作差异及取消 | `views/system/log` | 27 | 逐文件映射，业务证据见对应提案 |
| `components/dragVerify`（4） | 密码登录与注册验证码；只记录实际挂接的验证码路径 | `views/_core/authentication` | 01、10、11 | 逐文件映射，业务证据见对应提案 |
| `components/dropdownTable`（1） | 旧表格选择工具，新表格/关联选择 | `components/admin-table` | 42 | 旧工具未挂接，保留替代关系 |
| `components/editableTable`（1） | 字段单元格编辑、多级表头与固定列 | `components/admin-table` | 42 | 旧工具未挂接，保留替代关系 |
| `components/editor`（1） | 公告和模板富文本编辑 | `components/notice-editor`、`components/template-editor` | 04、33 | 逐文件映射，业务证据见对应提案 |
| `components/iconSelector`（2） | 菜单与代码生成图标选择 | `views/system/menu`、`views/system/codeGen` | 05、42 | 逐文件映射，业务证据见对应提案 |
| `components/importButton`（1） | 业务文件导入、模板及错误明细 | `components/admin/import-dialog.vue` | 17、43 | 旧工具未挂接，保留替代关系 |
| `components/jsonEditor`（1） | 结构化内容输入工具 | `views/system/database`、`views/system/region` | 24、32 | 旧工具未挂接，保留替代关系 |
| `components/multiLangInput`（1） | 全局多语言输入与语言文本维护 | `views/system/langText` | 09 | 逐文件映射，业务证据见对应提案 |
| `components/noticeBar`（1） | 通知/提示与更新反馈 | `views/home`、`views/system/update` | 04、16、30 | 逐文件映射，业务证据见对应提案 |
| `components/numberRange`（1） | 范围查询输入 | `components/admin/generated-field.vue` | 42、43 | 旧工具未挂接，保留替代关系 |
| `components/scEcharts`（1） | 真实业务关系图/监控；旧随机示例明确剔除 | `views/system/database`、`views/system/server` | 25、28 | 逐文件映射，业务证据见对应提案 |
| `components/svgIcon`（1） | 旧图标映射与当前图标组件 | `api/core/menu.ts` | 01、05 | 逐文件映射，业务证据见对应提案 |
| `components/sysDict`（1） | 全局字典标签、选项与生成表单 | `api/system/dict.ts`、`components/admin/generated.ts` | 08、43 | 逐文件映射，业务证据见对应提案 |
| `components/table`（7） | 查询、分页、选择、列设置、格式化、PDF/Excel 和打印 | `components/admin-table`、`components/admin` | 01、17、19、42、43 | 逐文件映射，业务证据见对应提案 |
| `components/TagSwitch`（1） | 业务状态显示及真实状态更新 | `views/system/role`、`components/admin/generated-page.vue` | 05、06、07、08、43 | 逐文件映射，业务证据见对应提案 |

## 全部旧文件映射

| 旧文件 | 新实现所在功能组 | 验收编号 |
| --- | --- | --- |
| `Web/src/views/about/index.vue` | `views/about` → `views/_core/about` | 16（replaced） |
| `Web/src/views/elive/index.vue` | `views/elive` → `views/elive` | 41（replaced） |
| `Web/src/views/error/401.vue` | `views/error` → `views/_core/fallback` | 01（replaced） |
| `Web/src/views/error/404.vue` | `views/error` → `views/_core/fallback` | 01（replaced） |
| `Web/src/views/home/index.vue` | `views/home` → `views/home`、`views/system/notice` | 04、16（replaced） |
| `Web/src/views/home/notice/index.vue` | `views/home` → `views/home`、`views/system/notice` | 04、16（replaced） |
| `Web/src/views/home/widgets/components/about.vue` | `views/home` → `views/home`、`views/system/notice` | 04、16（replaced） |
| `Web/src/views/home/widgets/components/commit.vue` | `views/home` → `views/home`、`views/system/notice` | 04、16（replaced） |
| `Web/src/views/home/widgets/components/echarts.vue` | `views/home` → `views/home`、`views/system/notice` | 04、16（removed-example） |
| `Web/src/views/home/widgets/components/myapp.vue` | `views/home` → `views/home`、`views/system/notice` | 04、16（replaced） |
| `Web/src/views/home/widgets/components/progressing.vue` | `views/home` → `views/home`、`views/system/notice` | 04、16（removed-example） |
| `Web/src/views/home/widgets/components/schedule.vue` | `views/home` → `views/home`、`views/system/notice` | 04、16（replaced） |
| `Web/src/views/home/widgets/components/scheduleEdit.vue` | `views/home` → `views/home`、`views/system/notice` | 04、16（replaced） |
| `Web/src/views/home/widgets/components/timer.vue` | `views/home` → `views/home`、`views/system/notice` | 04、16（replaced） |
| `Web/src/views/home/widgets/components/version.vue` | `views/home` → `views/home`、`views/system/notice` | 04、16（replaced） |
| `Web/src/views/home/widgets/components/welcome.vue` | `views/home` → `views/home`、`views/system/notice` | 04、16（replaced） |
| `Web/src/views/home/widgets/index.vue` | `views/home` → `views/home`、`views/system/notice` | 04、16（replaced） |
| `Web/src/views/login/component/account.vue` | `views/login` → `views/_core/authentication`、`api/core/auth.ts` | 01、11、12、13、14（replaced） |
| `Web/src/views/login/component/mobile.vue` | `views/login` → `views/_core/authentication`、`api/core/auth.ts` | 01、11、12、13、14（replaced） |
| `Web/src/views/login/component/register.vue` | `views/login` → `views/_core/authentication`、`api/core/auth.ts` | 01、11、12、13、14（replaced） |
| `Web/src/views/login/component/scan.vue` | `views/login` → `views/_core/authentication`、`api/core/auth.ts` | 01、11、12、13、14（replaced） |
| `Web/src/views/login/index.vue` | `views/login` → `views/_core/authentication`、`api/core/auth.ts` | 01、11、12、13、14（replaced） |
| `Web/src/views/mqttx/index.vue` | `views/mqttx` → `views/mqttx` | 40（replaced） |
| `Web/src/views/system/cache/index.vue` | `views/system/cache` → `views/system/cache` | 02、08（replaced） |
| `Web/src/views/system/codeGen/component/editCodeGenDialog.vue` | `views/system/codeGen` → `views/system/codeGen`、`components/admin`、`api/system/codegen.ts` | 42、43、44（replaced） |
| `Web/src/views/system/codeGen/component/genConfigDialog.vue` | `views/system/codeGen` → `views/system/codeGen`、`components/admin`、`api/system/codegen.ts` | 42、43、44（replaced） |
| `Web/src/views/system/codeGen/component/joinTableDialog.vue` | `views/system/codeGen` → `views/system/codeGen`、`components/admin`、`api/system/codegen.ts` | 42、43、44（replaced） |
| `Web/src/views/system/codeGen/component/previewDialog.vue` | `views/system/codeGen` → `views/system/codeGen`、`components/admin`、`api/system/codegen.ts` | 42、43、44（replaced） |
| `Web/src/views/system/codeGen/index.vue` | `views/system/codeGen` → `views/system/codeGen`、`components/admin`、`api/system/codegen.ts` | 42、43、44（replaced） |
| `Web/src/views/system/config/component/editConfig.vue` | `views/system/config` → `views/system/config` | 08（replaced） |
| `Web/src/views/system/config/index.vue` | `views/system/config` → `views/system/config` | 08（replaced） |
| `Web/src/views/system/database/component/addColumn.vue` | `views/system/database` → `views/system/database` | 24、25、26（replaced） |
| `Web/src/views/system/database/component/addTable.vue` | `views/system/database` → `views/system/database` | 24、25、26（replaced） |
| `Web/src/views/system/database/component/editColumn.vue` | `views/system/database` → `views/system/database` | 24、25、26（replaced） |
| `Web/src/views/system/database/component/editTable.vue` | `views/system/database` → `views/system/database` | 24、25、26（replaced） |
| `Web/src/views/system/database/component/genEntity.vue` | `views/system/database` → `views/system/database` | 24、25、26（replaced） |
| `Web/src/views/system/database/component/genSeedData.vue` | `views/system/database` → `views/system/database` | 24、25、26（replaced） |
| `Web/src/views/system/database/component/visualTable.vue` | `views/system/database` → `views/system/database` | 24、25、26（replaced） |
| `Web/src/views/system/database/index.vue` | `views/system/database` → `views/system/database` | 24、25、26（replaced） |
| `Web/src/views/system/dict/component/editDictData.vue` | `views/system/dict` → `views/system/dict` | 08（replaced） |
| `Web/src/views/system/dict/component/editDictType.vue` | `views/system/dict` → `views/system/dict` | 08（replaced） |
| `Web/src/views/system/dict/index.vue` | `views/system/dict` → `views/system/dict` | 08（replaced） |
| `Web/src/views/system/file/component/editSysfile.vue` | `views/system/file` → `views/system/file`、`components/file-preview` | 17、18（replaced） |
| `Web/src/views/system/file/index.vue` | `views/system/file` → `views/system/file`、`components/file-preview` | 17、18（replaced） |
| `Web/src/views/system/infoSetting/index.vue` | `views/system/infoSetting` → `views/system/infoSetting` | 10（replaced） |
| `Web/src/views/system/job/component/editJobDetail.vue` | `views/system/job` → `views/system/job` | 21、22、23（replaced） |
| `Web/src/views/system/job/component/editJobTrigger.vue` | `views/system/job` → `views/system/job` | 21、22、23（replaced） |
| `Web/src/views/system/job/component/jobCluster.vue` | `views/system/job` → `views/system/job` | 21、22、23（replaced） |
| `Web/src/views/system/job/dashboard.vue` | `views/system/job` → `views/system/job` | 21、22、23（replaced） |
| `Web/src/views/system/job/index.vue` | `views/system/job` → `views/system/job` | 21、22、23（replaced） |
| `Web/src/views/system/lang/component/editDialog.vue` | `views/system/lang` → `views/system/lang` | 09（replaced） |
| `Web/src/views/system/lang/index.vue` | `views/system/lang` → `views/system/lang` | 09（replaced） |
| `Web/src/views/system/langText/component/editDialog.vue` | `views/system/langText` → `views/system/langText` | 09（replaced） |
| `Web/src/views/system/langText/index.vue` | `views/system/langText` → `views/system/langText` | 09（replaced） |
| `Web/src/views/system/ldap/component/editLdap.vue` | `views/system/ldap` → `views/system/ldap` | 12（replaced） |
| `Web/src/views/system/ldap/index.vue` | `views/system/ldap` → `views/system/ldap` | 12（replaced） |
| `Web/src/views/system/log/difflog/index.vue` | `views/system/log` → `views/system/log` | 27（replaced） |
| `Web/src/views/system/log/exlog/index.vue` | `views/system/log` → `views/system/log` | 27（replaced） |
| `Web/src/views/system/log/oplog/index.vue` | `views/system/log` → `views/system/log` | 27（replaced） |
| `Web/src/views/system/log/vislog/index.vue` | `views/system/log` → `views/system/log` | 27（replaced） |
| `Web/src/views/system/menu/component/editMenu.vue` | `views/system/menu` → `views/system/menu` | 05（replaced） |
| `Web/src/views/system/menu/index.vue` | `views/system/menu` → `views/system/menu` | 05（replaced） |
| `Web/src/views/system/notice/component/editNotice.vue` | `views/system/notice` → `views/system/notice`、`components/notice-editor`、`components/notice-content` | 04（replaced） |
| `Web/src/views/system/notice/index.vue` | `views/system/notice` → `views/system/notice`、`components/notice-editor`、`components/notice-content` | 04（replaced） |
| `Web/src/views/system/onlineUser/index.vue` | `views/system/onlineUser` → `views/system/onlineUser`、`api/online-session.ts` | 03（replaced） |
| `Web/src/views/system/openAccess/component/editOpenAccess.vue` | `views/system/openAccess` → `views/system/openAccess` | 31（replaced） |
| `Web/src/views/system/openAccess/component/generateSign.vue` | `views/system/openAccess` → `views/system/openAccess` | 31（replaced） |
| `Web/src/views/system/openAccess/component/helpView.vue` | `views/system/openAccess` → `views/system/openAccess` | 31（replaced） |
| `Web/src/views/system/openAccess/index.vue` | `views/system/openAccess` → `views/system/openAccess` | 31（replaced） |
| `Web/src/views/system/org/component/editOrg.vue` | `views/system/org` → `views/system/org` | 06（replaced） |
| `Web/src/views/system/org/component/orgTree.vue` | `views/system/org` → `views/system/org` | 06（replaced） |
| `Web/src/views/system/org/index.vue` | `views/system/org` → `views/system/org` | 06（replaced） |
| `Web/src/views/system/plugin/component/editPlugin.vue` | `views/system/plugin` → `views/system/plugin` | 34（replaced） |
| `Web/src/views/system/plugin/index.vue` | `views/system/plugin` → `views/system/plugin` | 34（replaced） |
| `Web/src/views/system/pos/component/editPos.vue` | `views/system/pos` → `views/system/pos` | 01、06（replaced） |
| `Web/src/views/system/pos/index.vue` | `views/system/pos` → `views/system/pos` | 01、06（replaced） |
| `Web/src/views/system/region/component/editRegion.vue` | `views/system/region` → `views/system/region` | 32（replaced） |
| `Web/src/views/system/region/component/regionTree.vue` | `views/system/region` → `views/system/region` | 32（replaced） |
| `Web/src/views/system/region/index.vue` | `views/system/region` → `views/system/region` | 32（replaced） |
| `Web/src/views/system/role/component/editRole.vue` | `views/system/role` → `views/system/role` | 05（replaced） |
| `Web/src/views/system/role/component/grantData.vue` | `views/system/role` → `views/system/role` | 05（replaced） |
| `Web/src/views/system/role/index.vue` | `views/system/role` → `views/system/role` | 05（replaced） |
| `Web/src/views/system/server/index.vue` | `views/system/server` → `views/system/server` | 28（replaced） |
| `Web/src/views/system/server/new.vue` | `views/system/server` → `views/system/server` | 28（replaced） |
| `Web/src/views/system/stressTest/component/editStressTest.vue` | `views/system/stressTest` → `views/system/stressTest` | 29（replaced） |
| `Web/src/views/system/stressTest/index.vue` | `views/system/stressTest` → `views/system/stressTest` | 29（replaced） |
| `Web/src/views/system/template/component/editTemplate.vue` | `views/system/template` → `views/system/template`、`components/template-editor` | 33（replaced） |
| `Web/src/views/system/template/index.vue` | `views/system/template` → `views/system/template`、`components/template-editor` | 33（replaced） |
| `Web/src/views/system/tenant/component/editTenant.vue` | `views/system/tenant` → `views/system/tenant` | 07（replaced） |
| `Web/src/views/system/tenant/component/grantMenu.vue` | `views/system/tenant` → `views/system/tenant` | 07（replaced） |
| `Web/src/views/system/tenant/component/tenantSelect.vue` | `views/system/tenant` → `views/system/tenant` | 07（replaced） |
| `Web/src/views/system/tenant/index.vue` | `views/system/tenant` → `views/system/tenant` | 07（replaced） |
| `Web/src/views/system/tenantConfig/component/editConfig.vue` | `views/system/tenantConfig` → `views/system/tenantConfig` | 08、10（replaced） |
| `Web/src/views/system/tenantConfig/index.vue` | `views/system/tenantConfig` → `views/system/tenantConfig` | 08、10（replaced） |
| `Web/src/views/system/update/index.vue` | `views/system/update` → `views/system/update` | 30（replaced） |
| `Web/src/views/system/user/component/editUser.vue` | `views/system/user` → `views/system/user`、`views/_core/profile` | 06、15（replaced） |
| `Web/src/views/system/user/component/orgTree.vue` | `views/system/user` → `views/system/user`、`views/_core/profile` | 06、15（replaced） |
| `Web/src/views/system/user/component/userCenter.vue` | `views/system/user` → `views/system/user`、`views/_core/profile` | 06、15（replaced） |
| `Web/src/views/system/user/index.vue` | `views/system/user` → `views/system/user`、`views/_core/profile` | 06、15（replaced） |
| `Web/src/views/system/userRegWay/component/editRegWay.vue` | `views/system/userRegWay` → `views/system/userRegWay` | 10、11（replaced） |
| `Web/src/views/system/userRegWay/index.vue` | `views/system/userRegWay` → `views/system/userRegWay` | 10、11（replaced） |
| `Web/src/views/system/weChatUser/component/editWeChatUser.vue` | `views/system/weChatUser` → `views/system/weChatUser` | 38（replaced） |
| `Web/src/views/system/weChatUser/index.vue` | `views/system/weChatUser` → `views/system/weChatUser` | 38（replaced） |
| `Web/src/components/CardPro/index.vue` | `components/CardPro` → `views/home`、`views/system/cache`、`views/system/server` | 16、28、29（replaced） |
| `Web/src/components/TagSwitch/index.vue` | `components/TagSwitch` → `views/system/role`、`components/admin/generated-page.vue` | 05、06、07、08、43（replaced） |
| `Web/src/components/auth/auth.vue` | `components/auth` → `` | 05（library-unmounted） |
| `Web/src/components/auth/authAll.vue` | `components/auth` → `` | 05（library-unmounted） |
| `Web/src/components/auth/auths.vue` | `components/auth` → `` | 05（library-unmounted） |
| `Web/src/components/callTel/callBar.vue` | `components/callTel` → `views/_core/call-tel` | 46（library-unmounted） |
| `Web/src/components/callTel/index.vue` | `components/callTel` → `views/_core/call-tel` | 46（replaced） |
| `Web/src/components/cropper/index.vue` | `components/cropper` → `views/_core/profile` | 15（replaced） |
| `Web/src/components/dialogPro/dialog.vue` | `components/dialogPro` → `views/system/log` | 27（replaced） |
| `Web/src/components/dialogPro/index.vue` | `components/dialogPro` → `views/system/log` | 27（replaced） |
| `Web/src/components/dragVerify/dragVerify.vue` | `components/dragVerify` → `views/_core/authentication` | 01、10、11（replaced） |
| `Web/src/components/dragVerify/dragVerifyImg.vue` | `components/dragVerify` → `views/_core/authentication` | 01、10、11（replaced） |
| `Web/src/components/dragVerify/dragVerifyImgChip.vue` | `components/dragVerify` → `views/_core/authentication` | 01、10、11（replaced） |
| `Web/src/components/dragVerify/dragVerifyImgRotate.vue` | `components/dragVerify` → `views/_core/authentication` | 01、10、11（replaced） |
| `Web/src/components/dropdownTable/index.vue` | `components/dropdownTable` → `components/admin-table` | 42（library-unmounted） |
| `Web/src/components/editableTable/editableTable.vue` | `components/editableTable` → `components/admin-table` | 42（library-unmounted） |
| `Web/src/components/editor/index.vue` | `components/editor` → `components/notice-editor`、`components/template-editor` | 04、33（replaced） |
| `Web/src/components/iconSelector/index.vue` | `components/iconSelector` → `views/system/menu`、`views/system/codeGen` | 05、42（replaced） |
| `Web/src/components/iconSelector/list.vue` | `components/iconSelector` → `views/system/menu`、`views/system/codeGen` | 05、42（replaced） |
| `Web/src/components/importButton/index.vue` | `components/importButton` → `components/admin/import-dialog.vue` | 17、43（library-unmounted） |
| `Web/src/components/jsonEditor/index.vue` | `components/jsonEditor` → `views/system/database`、`views/system/region` | 24、32（library-unmounted） |
| `Web/src/components/multiLangInput/index.vue` | `components/multiLangInput` → `views/system/langText` | 09（replaced） |
| `Web/src/components/noticeBar/index.vue` | `components/noticeBar` → `views/home`、`views/system/update` | 04、16、30（replaced） |
| `Web/src/components/numberRange/index.vue` | `components/numberRange` → `components/admin/generated-field.vue` | 42、43（library-unmounted） |
| `Web/src/components/scEcharts/index.vue` | `components/scEcharts` → `views/system/database`、`views/system/server` | 25、28（replaced） |
| `Web/src/components/svgIcon/index.vue` | `components/svgIcon` → `api/core/menu.ts` | 01、05（replaced） |
| `Web/src/components/sysDict/sysDict.vue` | `components/sysDict` → `api/system/dict.ts`、`components/admin/generated.ts` | 08、43（replaced） |
| `Web/src/components/table/dictLabel.vue` | `components/table` → `components/admin-table`、`components/admin` | 01、17、19、42、43（replaced） |
| `Web/src/components/table/formatter.vue` | `components/table` → `components/admin-table`、`components/admin` | 01、17、19、42、43（replaced） |
| `Web/src/components/table/importData.vue` | `components/table` → `components/admin-table`、`components/admin` | 01、17、19、42、43（replaced） |
| `Web/src/components/table/index.vue` | `components/table` → `components/admin-table`、`components/admin` | 01、17、19、42、43（replaced） |
| `Web/src/components/table/modifyRecord.vue` | `components/table` → `components/admin-table`、`components/admin` | 01、17、19、42、43（replaced） |
| `Web/src/components/table/search.vue` | `components/table` → `components/admin-table`、`components/admin` | 01、17、19、42、43（replaced） |
| `Web/src/components/table/tableEditor.vue` | `components/table` → `components/admin-table`、`components/admin` | 01、17、19、42、43（replaced） |

## 已批准删除

- 第 36 项：钉钉。按编号提案明确删除；不映射为新 UI。
- 第 37 项：GoView。按编号提案明确删除；不映射为新 UI。
- 第 39 项：微信支付订单与退款。按用户范围明确删除，微信用户模块保留。

## 证据和剩余条件

- `coverage46-feature-map.json` 保存完整路径、旧源码 SHA256、静态调用/全局入口、证据文件 SHA256 和每层结果真值。共享证据沿原提案指向，不将契约测试冒充真实业务。
- 第 46 项完整验收仍待逐行为核验；旧文件映射和通过数量不作为整项完成依据。
- 本轮 `coverage46-acceptance.json` 另行封存真实 Nginx、管理员/普通用户、双租户、深链接刷新、退出、明暗主题和 PG 清理回执。
- 第 41 项：已完成：真实播放按用户指令豁免。原始 realPlaybackConfirmed=false 不变；该豁免仅关闭第 41 项，第 46 项仍须逐行为证据复核及证据汇总后的跨模块回归。
