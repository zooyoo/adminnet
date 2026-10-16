# 第 47 项主工作区完成记录

第 46 项提交 `a3fe323e4f899822ab726d9db1bace8a3917243e` 后，按精确清单备份并清理 770 个旧文件，仅移除 7 个无消费者 catalog 条目；保留 Web/public/config.js、锁文件和部署配置。单次原生生产构建通过，447 个产物，未使用源码 overlay。

真实桌面 PostgreSQL 验收通过：HTTP/TLS 文件上传、鉴权预览解码与下载、公开 URL 同字节、匿名拒绝；真实 Hub 业务事件、当前文档退出连接关闭及 PG0；独立调度鉴权、SSE、深链和缓存。8 张截图由主会话实际 read_image 核对。原行、物理文件、权限与配置恢复后，才销毁本轮数据库和运行资源。整页销毁后缺失浏览器 close 回调如实保留，以真实页面销毁和 exact PG 连接删除证明服务器断开，不替代主动退出的完整 close 检查。

验收索引：`cleanup47-main-acceptance-20261016.json`；详细报告：`D:/tmp/main47-final-closeout-6d3470833b6d4143bec1ec715f7d4926/acceptance.json`，SHA256 `988a6de6a2d77c00c36f8b2ce34673253ed830c88692775bdff3adf9a8a5831f`。原失败报告保持失败，不回填覆盖。生产发布未授权；三项 Native 与提案 41 真实播放豁免保持原边界。第 48 项接续本地切换与回退。
