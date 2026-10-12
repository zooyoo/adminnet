import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const origin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const directory = path.join(origin, '.scratch/frontend-vben-migration');
const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const plan = readJson(path.join(directory, 'cleanup47-plan.json'));
const control = process.argv[2] ? { root: process.argv[2], baseCommit: plan.baseCommit } : readJson(path.join(directory, 'cleanup47-control.tmp.json'));
const root = path.resolve(control.root);
assert.equal(path.dirname(root).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
assert.match(path.basename(root), /^adminnet-cleanup47-[a-f0-9]{32}$/);
assert.equal(fs.realpathSync(root).toLowerCase(), root.toLowerCase());
const owner = readJson(path.join(root, '.adminnet-cleanup47-owner.json'));
assert.equal(path.resolve(owner.origin).toLowerCase(), origin.toLowerCase());
assert.equal(owner.baseCommit, plan.baseCommit);
assert.equal(control.baseCommit, plan.baseCommit);
assert.equal(owner.kind, 'proposal47-isolated-review');
assert.equal(owner.primaryDeletionApplied, false);
assert.equal(plan.primaryDeletionApplied, false);
const sha = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const evidence = path.join(root, 'cleanup47-evidence');
const previousPlan = fs.existsSync(path.join(evidence, 'cleanup-plan.json')) ? readJson(path.join(evidence, 'cleanup-plan.json')) : undefined;
if (previousPlan) {
  assert.equal(previousPlan.baseCommit, plan.baseCommit);
  assert.deepEqual(previousPlan.deletions, plan.deletions);
}
const singleFiles = new Set(['Web/vite.config.ts', 'Web/tsconfig.json', 'Web/index.html', 'Web/scripts/translate.cjs']);
assert.equal(plan.deletions.length, 770);
function checkedTarget(file) {
  assert.ok(/^(?:Web\/src\/|Web\/lang\/|Web\/public\/)/.test(file) || singleFiles.has(file));
  assert.ok(!/(?:^|\/)\.env|\.(?:pem|key|pfx|p12)$/i.test(file));
  const target = path.resolve(root, file), relative = path.relative(root, target);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  let ancestor = path.dirname(target);
  while (ancestor.toLowerCase() !== root.toLowerCase()) {
    if (fs.existsSync(ancestor)) assert.ok(!fs.lstatSync(ancestor).isSymbolicLink());
    ancestor = path.dirname(ancestor);
  }
  return target;
}
// 先验证整份固定清单，再删除；已应用的自有副本可重复执行。
for (const record of plan.deletions) {
  const target = checkedTarget(record.path);
  if (!fs.existsSync(target)) { assert.ok(previousPlan, 'Missing original file without prior preparation'); continue; }
  assert.ok(fs.lstatSync(target).isFile() && !fs.lstatSync(target).isSymbolicLink());
  assert.equal(sha(target), record.sha256, 'Candidate legacy file changed: ' + record.path);
}
fs.mkdirSync(evidence, { recursive: true });
for (const record of plan.deploymentBackup) {
  const source = path.join(root, record.path), backup = path.join(evidence, 'deployment-backup', record.path);
  assert.equal(sha(source), record.sha256);
  fs.mkdirSync(path.dirname(backup), { recursive: true });
  if (!fs.existsSync(backup)) fs.copyFileSync(source, backup);
  assert.equal(sha(backup), record.sha256);
}
const candidatePlan = { ...plan, isolatedRoot: root };
fs.writeFileSync(path.join(evidence, 'cleanup-plan.json'), JSON.stringify(candidatePlan, null, 2) + '\n', 'utf8');
for (const record of plan.deletions) { const target = checkedTarget(record.path); if (fs.existsSync(target)) fs.unlinkSync(target); }
function pruneEmpty(directoryPath) {
  if (!fs.existsSync(directoryPath)) return;
  assert.ok(!fs.lstatSync(directoryPath).isSymbolicLink());
  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) if (entry.isDirectory() && !entry.isSymbolicLink()) pruneEmpty(path.join(directoryPath, entry.name));
  if (fs.readdirSync(directoryPath).length === 0) fs.rmdirSync(directoryPath);
}
for (const subdirectory of ['Web/src', 'Web/lang', 'Web/public']) pruneEmpty(path.join(root, subdirectory));
const catalog = path.join(root, 'Web/pnpm-workspace.yaml');
let workspace = fs.readFileSync(catalog, 'utf8');
for (const name of plan.removedCatalogs) {
  const expression = new RegExp('^  ' + name + ': [^\r\n]+\r?\n', 'm');
  if (!expression.test(workspace)) assert.ok(previousPlan, 'Catalog missing before preparation: ' + name);
  workspace = workspace.replace(expression, '');
}
fs.writeFileSync(catalog, workspace, 'utf8');
const readme = `# Admin.NET 前端\n\n当前应用位于 \`apps/web-antdv-next\`，使用 Vue 3、TypeScript、Vben Admin 和 Antdv Next。\n\n在本目录使用 \`package.json\` 指定的 pnpm 版本运行：\n\n\`\`\`powershell\npnpm install --frozen-lockfile\npnpm dev\npnpm check:type\npnpm lint\npnpm build\n\`\`\`\n\n生产产物统一输出到 \`Web/dist\`。API SDK 通过 \`pnpm build-api-ps\` 生成到目标应用；代码生成器的前端文件也写入目标应用。\n\n运行时 API、Nginx、SignalR、SSE、上传和缓存配置见 [部署说明](scripts/deploy/README.md)。\n\n媒体、PDF、Office、富文本和调度看板使用各自已经验证的专业引擎。\`Sundial.Dashboard\` 由后端提供，随 API 部署保留。\n\n项目及上游许可证分别见 \`LICENSE\` 和 \`LICENSE-VBEN\`。\n`;
fs.writeFileSync(path.join(root, 'Web/README.md'), readme, 'utf8');
fs.copyFileSync(path.join(origin, 'Web/eslint.config.mjs'), path.join(root, 'Web/eslint.config.mjs'));
assert.ok(plan.deletions.every(record => !fs.existsSync(path.join(root, record.path))));
console.log(JSON.stringify({ isolatedRoot: root, removedFiles: plan.deletions.length, removedCatalogs: plan.removedCatalogs.length, primaryDeletionApplied: false, recoveryRef: plan.recoveryRef, resumed: Boolean(previousPlan) }));
