# 历史委派收尾核对

## 已验证事实

- 已通过本机 `/api/dsh-session-archive/inventory` 查询并完成遗漏归档：11 项归档操作返回成功；后续回查 18 个直接子会话全部 archived=true、running=false，规范化 session- 前缀后全部属于 archivedSessionIds 权威集合。
- 旧日志只枚举 17 个子会话，宿主多出 `eda8998d-5eea-49a2-8a94-9f16614bfe3b`。不得忽略这项差异，后续需要核对其任务和日志。
- 旧脚本不读取归档集合，重复回放日志不能推断用户归档失败；之前“等待归档同步”的解释不准确。
- 当前项目脚本新增 `--host-url http://127.0.0.1:19387`，直接读取本机实时清单，禁止从任意 JSON 文件导入所谓回执。检查归档集合、父子归属、running=false、60 秒时效和重复 ID。
- 真实核验：日志中的 17 个成员均获得归档核验记录；还保留 7 条 UNSETTLED_RESULT（5 error、2 aborted），未自动把归档等同于成功交付。
- 21 项 Node 回归测试通过，包括未归档、仍运行、未知运行状态、父级错误、权威集合缺失、过期与重复清单、归档后 error/aborted 仍阻塞。

## 失败任务归属与证据

| 子会话 | 日志任务归属 | 已核实后续证据 | 尚需核对 |
| --- | --- | --- | --- |
| 0c832194-fc19-4e88-9f0c-fde2d4d8c2ea | 提案 29：实现压测服务与权限；17 次工具调用，error | issue 29 记录 completed；Git 提交 ed16649bf 确实存在，标题为完成提案29受控压力测试迁移 | 实际写入及主会话接手记录，不能按失败状态推断无写入 |
| ede72e9d-f1fc-468a-8794-21e2f972cf24 | 提案 29：完成后端压测控制；19 次工具调用，error | 同上 | 同上 |
| 56c343a0-5a9e-4ec1-9d61-6474c868e34e | 提案 29：只读复核压测授权与统计边界；6 次工具调用，error | 同上 | 核对调用无写入；不计为成功复核 |
| 673c1cc0-f13e-41e0-b813-a957b2e71298 | 既有调查记录：提案 31 初次前端 server_busy | findings.md 有归属记录 | 仍需直接日志与接手证据 |
| ee84380b-3c03-4575-bd38-702755af516d | 既有调查记录：提案 31 初次后端 cyber_policy | findings.md 有归属记录 | 不绕过模型拒绝；核对既有交付及拒绝范围 |
| 37cfb8e3-ba84-474a-932e-2d026a0497bc | 提案 33 成员后被复用到 34，aborted | findings.md 记载复用及用户中止 | 保留第 34 项未完成修改，不当作完成 |
| b45a2df4-8595-4480-af9a-cfcf5deec1ec | 同上 | 同上 | 同上 |

## 第 16 轮核验增量

- 23 项门禁回归全部通过。新增覆盖：宿主额外侧会话及其后代递归发现、一次性任务日志 completed 但宿主仍 running 时拒绝放行。
- 实时脱敏报告已保存为同目录 `host-closeout-audit.json`，检查时间 2026-10-11T08:00:13.386Z，实际退出码 2。17 个日志成员均有宿主归档核验；额外侧会话 archived=true、running=false，单独报告 HOST_CHILD_NOT_IN_LOG，保留 7 条 UNSETTLED_RESULT。
- 额外实例 `eda8998d-5eea-49a2-8a94-9f16614bfe3b` 的描述符为 `Side: New thread`，末次回合 completed；日志含从提案 29 开始的目标消息、实现和委派历史。尚未区分继承历史与实际新增事件，不能把其中全部调用当成该侧会话新执行。
- 两个提案 29 实现失败实例没有 edit/write 工具调用；shell 描述均为定位、读取或检查，常见写入命令筛查未命中。这只是初步筛查，仍需最终结果与接手证据，不把正则无命中宣称绝对无副作用。
- 提案 29 只读复核失败实例调用为 pwsh/read/skill；未完成复核，不计入成功验收。
- 提案 31 首次前端实例无工具调用；首次后端实例只有 todo/codegraph/pwsh/read。未重试或绕过其模型拒绝。

## 第 17 轮核验增量

- 对主会话与额外侧会话的 tool/call.callId 做集合对比：侧会话共 439 次调用，438 次继承自主会话，唯一新增为 seq 2511 的 ctx_stats。侧会话不能被当作重复执行了全部历史实现，也没有新增代码写入工具调用。
- 精确定位收到“复用你负责34”的消息后检查：template-api 从事件索引 851 开始，12 次调用均为任务记录、读取、代码/文档查询、压缩与消息，ctx_execute 只读取文件及枚举临时目录。未见提案 34 业务实现写入。
- template-ui 从事件索引 1688 开始，16 次调用含读取、查询、消息、goal 创建和组件资料准备；没有 edit/write，最后的 CLI 将组件查询输出写入 plugin-frontend 本地日志。保留这些准备产物，不宣称提案 34 已交付。
- 两次分析命令先后因尾部多余括号、侧会话目录缺少 session- 前缀失败，修正后才取得上述结果；失败命令没有执行写入。

## 第 18 轮：交付证据反查

直接读取并解析以下三份原始报告，核验当时文件均存在，passed=true、cleanupPassed=true、cleanupErrors=[]；这不是本轮重新运行业务测试。

资料保留说明：前端移植完成后的仓库维护已清理 `.scratch/frontend-vben-migration/`。下列临时报告路径和任务记录仅说明当时的证据来源，不保证当前文件仍存在；已跟踪记录按所列提交从 Git 历史查证。本文件及独立 DSH 修复资料继续保留，清理不代表其后续事项已完成。

- 提案 29：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-1be5382ddf56446c992b56ef5cbfb41c/evidence/stress-browser-baseline.json`；对应任务记录 `issues/29-controlled-stress-test.md`（位于 frontend-vben-migration），提交 ed16649bf 已核实。
- 提案 31：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-df55f333997141acb36d80a84984fb30/evidence/open-access-browser-baseline.json`；对应任务记录 `issues/31-open-access-signature.md`；该记录最近交付提交为 ac864b4222c5d0e8012bb4d07f0319d0f74ce3f2，Git 已核实。
- 提案 33：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-1608732a23f441449be7fbb939c74583/evidence/template-browser-baseline.json`；此报告只支持 33，不支持成员随后接到的 34。

处置分类：29 的两次实现失败由既有最终交付接手，失败的只读复核不计成功审查；31 的早期失败不计交付，保留模型拒绝并核对既有最终实现；33 成员后续在 34 的中止记录作为当前待恢复任务，不要求失败回合重新运行变成 completed。侧会话新增仅统计查询，继承调用不重复计算。上述均为业务处置，不能替代实时归档和停止核验。

## 后续工作

1. 为业务处置增加可验证的证据绑定，关联原始日志摘要、提案提交与验收报告摘要；脚本目前仍报告 UNSETTLED_RESULT，不得声称已放行。
2. 宿主额外后代检查及 23 项回归已随 09ee8a771 提交；将继承侧会话核对结论纳入同一证据绑定。
3. 持续保留提案 34 已有工作，只在门禁核对通过后恢复，不把本轮核验当作 34 完成。
4. 归档已完成，不需要用户重复操作；迁移目标保持 active。
