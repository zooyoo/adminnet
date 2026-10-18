# PDF 输出与打印服务

列表 PDF 和模板输出共用应用内的 pdfme 能力，具体依赖版本以 `Web/apps/web-antdv-next/package.json` 与 lockfile 为准。实现入口为 [PDF 输出模块](../../Web/apps/web-antdv-next/src/components/pdfme/output.ts)，模板与字体配置在 [模板模块](../../Web/apps/web-antdv-next/src/components/pdfme/template.ts)。

浏览器打印通过内嵌 PDF 的打印接口打开系统对话框。取消对话框不属于业务失败；前端无法证明物理打印已完成。份数等设备参数由浏览器对话框选择。

## 客户端服务协议

这是 Admin.NET 定义的 HTTP 适配合同，不是 pdfme 官方服务。模板维护者配置受信任且已获授权的绝对 HTTP / HTTPS 地址，执行时将生成的 PDF 发送给该地址。

| 项目 | 要求 |
| --- | --- |
| 请求 | `POST`，请求体为 `application/pdf` |
| `X-Pdfme-Copies` | 1～100 的整数，默认 1 |
| `X-Pdfme-Title` | URL 编码的任务标题；模板打印参数中的原始标题不超过 200 字 |
| CORS | 跨域服务允许应用来源及上述请求头，并处理预检请求 |
| 响应 | HTTP 2xx，`Content-Type` 包含 `application/json`，JSON 的 `accepted` 严格等于 `true` |
| 超时 | 30 秒；失败或无有效回执不自动重试 |

PDF 包含预览数据或当前选择的数据。请求使用 `credentials: 'omit'`，不附带应用登录令牌或 Cookie；地址不能包含用户名、密码，禁止重定向。服务实现须自行配置所需的网络访问边界与队列授权。

页面关闭或会话失效会取消未完成请求。取消 HTTP 无法撤销服务已经接收的任务；请求失败后重试可能重复送达，应先核对队列。

“已提交到打印服务”仅表示服务确认接收。设备配置和实际打印结果由部署方负责。仓库验收应使用隔离的本机接收服务，不操作真实生产打印机。

## 模板与字体

模板须为有效的 pdfme JSON，不自动把其他引擎模板转换为示例。损坏模板禁止保存和执行，可经确认选择常用模板重建。常用模板包括 A4 文档、商品清单和 100 × 80 mm 标签。

中文字体为 Noto Serif CJK SC 2.003，保留历史键 `SourceHanSerifSC`。字体文件、许可证与来源见 [字体说明](../../Web/apps/web-antdv-next/public/fonts/source-han-serif-sc/README.md)，不要将其误标为 SimSun。

修改本协议时同步检查输出模块、模板参数校验、调用页面与相关测试。接口接收成功、浏览器对话框打开和物理打印完成是不同的核验结果。
