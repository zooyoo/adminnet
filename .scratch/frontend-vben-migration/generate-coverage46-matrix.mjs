import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, '../..');
const app = 'Web/apps/web-antdv-next/src/';
const oldRoot = 'Web/src/';
const liveAcceptance = JSON.parse(readFileSync(join(directory, 'live-error-cleanup-acceptance.json'), 'utf8'));
const liveWaived = liveAcceptance.complete === true && liveAcceptance.realPlaybackConfirmed === false && liveAcceptance.acceptanceOverride?.source === 'direct-human-instruction';
const liveAccepted = liveAcceptance.complete === true && (liveAcceptance.realPlaybackConfirmed === true || liveWaived);
const crossModule = JSON.parse(readFileSync(join(directory, 'coverage46-acceptance.json'), 'utf8'));
const behaviorCoverageComplete = crossModule.behaviorCoverageComplete === true;
const proposalComplete = liveAccepted && behaviorCoverageComplete && crossModule.scopePassed === true && crossModule.report.result.passed === true && crossModule.report.result.cleanupPassed === true;
const deferredProposals = [...(liveAccepted ? [] : [41]), ...(behaviorCoverageComplete ? [] : [46])];
const liveStatus = liveWaived ? '已完成：真实播放按用户指令豁免' : liveAccepted ? '真实播放验收已完成' : '真实播放用户暂缓';
const sha = path => createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
const slash = path => path.replaceAll('\\', '/');
function files(path, extensions) {
  return readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    const file = join(path, entry.name);
    return entry.isDirectory() ? files(file, extensions) : extensions.some(extension => entry.name.endsWith(extension)) ? [slash(relative(root, file))] : [];
  }).sort();
}
// 记录实际入口和新实现；扫码认证与回调从未实现，不按示例补造协议。
const definitions = [
  ['views/about', [16], ['views/_core/about'], '关于、版本与按需更新历史'],
  ['views/error', [1], ['views/_core/fallback'], '认证、权限与未找到页面反馈'],
  ['views/login', [1, 11, 12, 13, 14], ['views/_core/authentication', 'api/core/auth.ts'], '密码、手机、注册、LDAP、第三方 Token 与锁屏；旧扫码仅项目二维码'],
  ['views/home', [4, 16], ['views/home', 'views/system/notice'], '欢迎、收藏、日程和工作台配置；随机收入图与固定进度示例已移除'],
  ['views/elive', [41], ['views/elive'], 'EZUIKit 8.0.5 原引擎、输入和控制；错误与清理已验，' + liveStatus + ''],
  ['views/mqttx', [40], ['views/mqttx'], 'MQTT 连接、主题、收发、设备封装、重连及凭据清理'],
  ['views/system/cache', [2, 8], ['views/system/cache'], '缓存树、搜索、详情与删除'],
  ['views/system/codeGen', [42, 43, 44], ['views/system/codeGen', 'components/admin', 'api/system/codegen.ts'], '全部主/字段配置、关联选项、复制、同步、预览、ZIP 与直接生成恢复'],
  ['views/system/config', [8], ['views/system/config'], '系统参数和租户参数查询、编辑、校验与恢复'],
  ['views/system/database', [24, 25, 26], ['views/system/database'], '数据库/表/字段维护、关系图及实体与种子生成'],
  ['views/system/dict', [8], ['views/system/dict'], '字典类型/数据、编辑、样式与状态'],
  ['views/system/file', [17, 18], ['views/system/file', 'components/file-preview'], '目录/文件/图片、上传下载、媒体与 Office 预览'],
  ['views/system/infoSetting', [10], ['views/system/infoSetting'], '站点品牌、登录注册与租户设置'],
  ['views/system/job', [21, 22, 23], ['views/system/job'], '任务定义控制、触发器/CRON、运行记录与独立调度看板'],
  ['views/system/lang', [9], ['views/system/lang'], '语言定义及导入导出'],
  ['views/system/langText', [9], ['views/system/langText'], '多语言文本查询、维护与文件交换'],
  ['views/system/ldap', [12], ['views/system/ldap'], 'LDAP 连接、同步、用户及真实登录'],
  ['views/system/log', [27], ['views/system/log'], '访问、操作、异常、差异详情及导出'],
  ['views/system/menu', [5], ['views/system/menu'], '菜单树、图标、按钮权限及授权关系'],
  ['views/system/notice', [4], ['views/system/notice', 'components/notice-editor', 'components/notice-content'], '公告发布、收件人、已读与富文本'],
  ['views/system/onlineUser', [3], ['views/system/onlineUser', 'api/online-session.ts'], '真实在线列表、SignalR 与强制下线'],
  ['views/system/openAccess', [31], ['views/system/openAccess'], '签名、绑定权限、SDK 与开放入口'],
  ['views/system/org', [6], ['views/system/org'], '机构层级、编辑和数据范围'],
  ['views/system/plugin', [34], ['views/system/plugin'], '插件安装、启停、升级与删除'],
  ['views/system/pos', [1, 6], ['views/system/pos'], '职位 CRUD、查询、输出、权限与租户隔离'],
  ['views/system/region', [32], ['views/system/region'], '行政区域三级/层级维护、校验与导入导出'],
  ['views/system/role', [5], ['views/system/role'], '角色、菜单授权及数据权限'],
  ['views/system/server', [28], ['views/system/server'], '服务器与运行时监控、实时数据及停机反馈'],
  ['views/system/stressTest', [29], ['views/system/stressTest'], '受控压力测试、报告与失败恢复'],
  ['views/system/template', [33], ['views/system/template', 'components/template-editor'], '模板维护、参数和真实渲染'],
  ['views/system/tenant', [7], ['views/system/tenant'], '租户配置、状态、授权、切换及独立数据'],
  ['views/system/tenantConfig', [8, 10], ['views/system/tenantConfig'], '租户独立参数、重载与失效'],
  ['views/system/update', [30], ['views/system/update'], '版本检查、更新记录与失败恢复'],
  ['views/system/user', [6, 15], ['views/system/user', 'views/_core/profile'], '用户/机构/职位、角色、状态、重置密码及个人中心'],
  ['views/system/userRegWay', [10, 11], ['views/system/userRegWay'], '注册方式和启用设置'],
  ['views/system/weChatUser', [38], ['views/system/weChatUser'], '微信用户和消息已实现操作'],
  ['components/auth', [5], ['Web/packages/effects/access'], '旧权限组件 single/any/all；新页面权限及服务端拒绝', 'library-unmounted'],
  ['components/callTel', [46], ['views/_core/call-tel'], '公开 /$callTel 拨号入口；callBar 在旧用户页未挂接'],
  ['components/CardPro', [16, 28, 29], ['views/home', 'views/system/cache', 'views/system/server'], '首页及业务卡片布局'],
  ['components/cropper', [15], ['views/_core/profile'], '个人头像与背景裁剪'],
  ['components/dialogPro', [27], ['views/system/log'], '日志详情弹层、操作差异及取消'],
  ['components/dragVerify', [1, 10, 11], ['views/_core/authentication'], '密码登录与注册验证码；只记录实际挂接的验证码路径'],
  ['components/dropdownTable', [42], ['components/admin-table'], '旧表格选择工具，新表格/关联选择', 'library-unmounted'],
  ['components/editableTable', [42], ['components/admin-table'], '字段单元格编辑、多级表头与固定列', 'library-unmounted'],
  ['components/editor', [4, 33], ['components/notice-editor', 'components/template-editor'], '公告和模板富文本编辑'],
  ['components/iconSelector', [5, 42], ['views/system/menu', 'views/system/codeGen'], '菜单与代码生成图标选择'],
  ['components/importButton', [17, 43], ['components/admin/import-dialog.vue'], '业务文件导入、模板及错误明细', 'library-unmounted'],
  ['components/jsonEditor', [24, 32], ['views/system/database', 'views/system/region'], '结构化内容输入工具', 'library-unmounted'],
  ['components/multiLangInput', [9], ['views/system/langText'], '全局多语言输入与语言文本维护'],
  ['components/noticeBar', [4, 16, 30], ['views/home', 'views/system/update'], '通知/提示与更新反馈'],
  ['components/numberRange', [42, 43], ['components/admin/generated-field.vue'], '范围查询输入', 'library-unmounted'],
  ['components/scEcharts', [25, 28], ['views/system/database', 'views/system/server'], '真实业务关系图/监控；旧随机示例明确剔除'],
  ['components/svgIcon', [1, 5], ['api/core/menu.ts'], '旧图标映射与当前图标组件'],
  ['components/sysDict', [8, 43], ['api/system/dict.ts', 'components/admin/generated.ts'], '全局字典标签、选项与生成表单'],
  ['components/table', [1, 17, 19, 42, 43], ['components/admin-table', 'components/admin'], '查询、分页、选择、列设置、格式化、PDF/Excel 和打印'],
  ['components/TagSwitch', [5, 6, 7, 8, 43], ['views/system/role', 'components/admin/generated-page.vue'], '业务状态显示及真实状态更新'],
];
const legacy = [...files(join(root, oldRoot, 'views'), ['.vue']), ...files(join(root, oldRoot, 'components'), ['.vue'])];
const issueNames = readdirSync(join(directory, 'issues')).filter(name => /^\d\d-.*\.md$/.test(name));
const issue = id => issueNames.find(name => name.startsWith(String(id).padStart(2, '0') + '-'));
const oldCode = files(join(root, oldRoot), ['.vue', '.ts', '.js']).map(path => ({ path, text: readFileSync(join(root, path), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n') }));
const entries = legacy.map(source => {
  const old = source.slice(oldRoot.length);
  const key = old.startsWith('views/system/') ? old.split('/').slice(0, 3).join('/') : old.split('/').slice(0, 2).join('/');
  const definition = definitions.find(row => row[0] === key);
  assert.ok(definition, 'Missing legacy feature mapping: ' + source);
  const [, proposals, replacements, behavior, classification = 'replaced'] = definition;
  const replacementPaths = replacements.map(path => path.startsWith('Web/') ? path : app + path);
  for (const path of replacementPaths) assert.ok(existsSync(join(root, path)), 'Missing replacement: ' + path);
  const staticCallers = key.startsWith('components/') ? oldCode.filter(item => item.path !== source && item.text.includes('/' + key + '/')).map(item => item.path) : [];
  const globals = key === 'components/sysDict' ? ['GSysDict'] : key === 'components/multiLangInput' ? ['GMultiLangInput'] : [];
  const removedExample = /views\/home\/widgets\/components\/(?:echarts|progressing)\.vue$/u.test(old);
  const unmountedCallBar = old === 'components/callTel/callBar.vue';
  return { source, sha256: sha(source), group: key, behavior: removedExample ? '旧随机收入图/固定进度示例已明确移除，不计为业务' : unmountedCallBar ? '旧用户页未挂接拨号栏；公开拨号路径单独保留' : behavior, classification: removedExample ? 'removed-example' : unmountedCallBar ? 'library-unmounted' : classification, replacements: replacementPaths, proposals, issueFiles: proposals.map(id => issue(id)).filter(Boolean).map(name => slash(relative(root, join(directory, 'issues', name)))), staticCallers, globals, deferred: proposals.includes(41) && !liveAccepted };
});
assert.equal(new Set(entries.map(row => row.source)).size, legacy.length);
const artifactNames = { 40: 'mqtt-acceptance.json', 41: 'live-error-cleanup-acceptance.json', 42: 'codegen-config-acceptance.json', 43: 'codegen-zip-acceptance.json', 44: 'codegen-direct-acceptance.json', 45: 'runtime45-acceptance.json' };
// 多种历史报告的结果结构分别保留；不把局部 passed 或 SQLite 历史转换为 PG 全量通过。
const evidence = issueNames.filter(name => Number(name.slice(0, 2)) <= 45).map(name => {
  const id = Number(name.slice(0, 2)), path = join(directory, 'issues', name), text = readFileSync(path, 'utf8');
  const candidates = new Set();
  for (const match of text.matchAll(/[A-Z]:[\\/][^`"<>|\r\n]*?\.json/gu)) if (existsSync(match[0]) && statSync(match[0]).isFile()) candidates.add(match[0]);
  for (const match of text.matchAll(/[A-Z]:[\\/][^`"<>|\r\n]*?[\\/](?=[`"\s，。；])/gu)) {
    const folder = match[0];
    if (existsSync(folder) && statSync(folder).isDirectory()) for (const file of readdirSync(folder).filter(file => /(?:baseline|acceptance|report)\.json$/u.test(file))) candidates.add(join(folder, file));
  }
  if (artifactNames[id]) candidates.add(join(directory, artifactNames[id]));
  const reports = [...candidates].map(file => {
    const bytes = readFileSync(file), data = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/u, '')), verdicts = [];
    function inspect(value, prefix = '', depth = 0) {
      if (!value || typeof value !== 'object' || depth > 4) return;
      for (const [key, item] of Object.entries(value)) {
        if (typeof item === 'boolean' && /^(passed|cleanupPassed|proposalComplete|baselinePassed|complete|realPlaybackConfirmed)$/u.test(key)) verdicts.push({ key: prefix + key, value: item });
        else if (item && typeof item === 'object' && !Array.isArray(item)) inspect(item, prefix + key + '.', depth + 1);
      }
    }
    inspect(data);
    return { path: slash(file), sha256: createHash('sha256').update(bytes).digest('hex'), verdicts, scope: typeof data.scope === 'string' ? data.scope : undefined, boundary: typeof data.boundary === 'string' ? data.boundary : undefined };
  });
  return { proposal: id, issue: slash(relative(root, path)), issueSha256: createHash('sha256').update(text).digest('hex'), execution: text.match(/Execution:\s*([^\r\n]+)/u)?.[1], reports };
});
// 22/23 沿 21 的共同报告，39 的报告保存在进度文档而非独立 issue。
for (const id of [22, 23]) evidence.find(item => item.proposal === id).reports = evidence.find(item => item.proposal === 21).reports;
const progressText = readFileSync(join(directory, 'progress.md'), 'utf8');
const paymentPath = [...progressText.matchAll(/[A-Z]:[\\/][^\s，。\x60]+payment-removal-baseline\.json/gu)].at(-1)?.[0];
assert.ok(paymentPath && existsSync(paymentPath), 'Payment removal real report must remain available');
const paymentBytes = readFileSync(paymentPath), paymentReport = JSON.parse(paymentBytes.toString('utf8').replace(/^\uFEFF/u, ''));
evidence.push({ proposal: 39, progressSection: '第 39 项', reports: [{ path: slash(paymentPath), sha256: createHash('sha256').update(paymentBytes).digest('hex'), verdicts: ['passed', 'cleanupPassed'].map(key => ({ key, value: paymentReport[key] })), boundary: paymentReport.boundary }] });
const groups = definitions.map(([group, proposals, replacements, behavior, classification = 'replaced']) => ({ group, behavior, proposals, classification, replacements: replacements.map(path => path.startsWith('Web/') ? path : app + path), legacyFiles: entries.filter(entry => entry.group === group).map(entry => entry.source) }));
const removed = [
  { proposal: 36, feature: '钉钉', disposition: '按编号提案明确删除；不映射为新 UI' },
  { proposal: 37, feature: 'GoView', disposition: '按编号提案明确删除；不映射为新 UI' },
  { proposal: 39, feature: '微信支付订单与退款', disposition: '按用户范围明确删除，微信用户模块保留' },
];
const data = { version: 1, scope: liveAccepted ? 'source-map-and-proposal-evidence-with-live-acceptance-decision' : 'source-map-and-proposal-evidence-with-user-deferred-live-playback', proposalComplete, deferredProposals, counts: { views: entries.filter(entry => entry.source.startsWith(oldRoot + 'views/')).length, components: entries.filter(entry => entry.source.startsWith(oldRoot + 'components/')).length, mapped: entries.length }, groups, entries, removed, evidence };
writeFileSync(join(directory, 'coverage46-feature-map.json'), JSON.stringify(data, null, 2) + '\n', 'utf8');
const md = ['# 第 46 项功能覆盖矩阵', '', '本表将旧视图和公共组件逐文件绑定到当前新实现、编号提案及证据。旧源码内容不复制，只记录路径和 SHA256。第 41 项状态：' + liveStatus + '。原始报告的实际验证范围和真值保留，整项决定见 coverage46-acceptance.json。', '', '旧扫码仅生成项目二维码，旧拨号 Token/回调未消费，随机图表与固定进度是示例；这些不能当作已实现的认证或业务协议。静态调用、全局注册与未挂接工具分别记录，未挂接工具不计为业务端点。', '', '历史报告采用多种结果结构；JSON 保留每个 passed/cleanupPassed/proposalComplete 的实际层级和真值。旧 SQLite 报告仅作历史记录，本轮跨用户和双租户的连续链使用真实 PostgreSQL，不能据历史证据声称所有模块均在本轮重测。', '', '| 旧功能组 | 新行为 | 新实现 | 编号证据 | 状态 |', '| --- | --- | --- | --- | --- |'];
for (const row of groups) md.push('| `' + row.group + '`（' + row.legacyFiles.length + '） | ' + row.behavior + ' | ' + row.replacements.map(path => '`' + path.slice(app.length) + '`').join('、') + ' | ' + row.proposals.map(id => String(id).padStart(2, '0')).join('、') + ' | ' + (row.proposals.includes(41) ? liveStatus : row.classification === 'library-unmounted' ? '旧工具未挂接，保留替代关系' : '逐文件映射，业务证据见对应提案') + ' |');
md.push('', '## 全部旧文件映射', '', '| 旧文件 | 新实现所在功能组 | 验收编号 |', '| --- | --- | --- |');
for (const row of entries) md.push('| `' + row.source + '` | `' + row.group + '` → ' + row.replacements.map(path => '`' + path.slice(app.length) + '`').join('、') + ' | ' + row.proposals.map(id => String(id).padStart(2, '0')).join('、') + '（' + row.classification + '） |');
md.push('', '## 已批准删除', '', ...removed.map(row => '- 第 ' + row.proposal + ' 项：' + row.feature + '。' + row.disposition + '。'), '', '## 证据和剩余条件', '', '- `coverage46-feature-map.json` 保存完整路径、旧源码 SHA256、静态调用/全局入口、证据文件 SHA256 和每层结果真值。共享证据沿原提案指向，不将契约测试冒充真实业务。', '- 第 46 项完整验收仍待逐行为核验；旧文件映射和通过数量不作为整项完成依据。', '- 本轮 `coverage46-acceptance.json` 另行封存真实 Nginx、管理员/普通用户、双租户、深链接刷新、退出、明暗主题和 PG 清理回执。', '- 第 41 项：' + liveStatus + '。原始 realPlaybackConfirmed=false 不变；该豁免仅关闭第 41 项，第 46 项仍须逐行为证据复核及证据汇总后的跨模块回归。', '');
writeFileSync(join(directory, 'coverage46-matrix.md'), md.join('\n'), 'utf8');
console.log(JSON.stringify({ counts: data.counts, groups: groups.length, evidenceReports: evidence.reduce((count, item) => count + item.reports.length, 0), proposalComplete, deferredProposals }));
