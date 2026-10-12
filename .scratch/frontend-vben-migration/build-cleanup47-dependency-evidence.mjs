import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const origin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const json = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const plan = json(path.join(origin, '.scratch/frontend-vben-migration/cleanup47-plan.json'));
const control = process.argv[2] ? { root: process.argv[2], baseCommit: plan.baseCommit } : json(path.join(origin, '.scratch/frontend-vben-migration/cleanup47-control.tmp.json'));
const root = path.resolve(control.root);
assert.equal(path.dirname(root).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase());
assert.match(path.basename(root), /^adminnet-cleanup47-[a-f0-9]{32}$/);
const owner = json(path.join(root, '.adminnet-cleanup47-owner.json'));
assert.equal(owner.kind, 'proposal47-isolated-review');
assert.equal(owner.baseCommit, control.baseCommit);
const web = path.join(root, 'Web');
const application = path.join(web, 'apps/web-antdv-next');
assert.ok(!fs.lstatSync(path.join(web, 'node_modules')).isSymbolicLink());
assert.equal(json(path.join(root, 'cleanup47-evidence/install-result.json')).passed, true);
for (const legacy of ['src', 'lang', 'public', 'vite.config.ts', 'index.html', 'tsconfig.json']) assert.ok(!fs.existsSync(path.join(web, legacy)));
const require = createRequire(path.join(web, 'package.json'));
const { build } = await import(pathToFileURL(require.resolve('vite')).href);
const normalize = value => value.replaceAll('\\', '/');
const packageName = id => {
  const normalized = normalize(id), marker = '/node_modules/';
  const at = normalized.lastIndexOf(marker);
  if (at < 0) return undefined;
  const segments = normalized.slice(at + marker.length).split('/');
  return segments[0]?.startsWith('@') ? segments.slice(0, 2).join('/') : segments[0];
};
const forbidden = ['element-plus', '@element-plus/icons-vue', 'ant-design-vue', 'naive-ui', 'tdesign-vue-next', 'vxe-pc-ui', 'vxe-table', 'vue-element-plus-x'];
const required = ['antdv-next', 'ezuikit-js', 'mqtt', '@pdfme/ui', '@pdfme/generator', '@vue-office/docx', '@vue-office/excel', '@vue-office/pdf', '@wangeditor-next/editor'];
let trace;
process.chdir(application);
await build({
  configFile: path.join(application, 'vite.config.ts'),
  mode: 'production',
  plugins: [{
    name: 'adminnet-cleanup47-dependency-evidence',
    generateBundle(_options, bundle) {
      const ids = [...this.getModuleIds()];
      const modules = ids.map(id => {
        const info = this.getModuleInfo(id);
        const clean = id.split('?')[0];
        let sha256;
        if (!clean.includes('\0') && fs.existsSync(clean) && fs.statSync(clean).isFile() && !/(?:^|[\\/])\.env/.test(clean)) sha256 = crypto.createHash('sha256').update(fs.readFileSync(clean)).digest('hex');
        const inRepository = normalize(clean).toLowerCase().startsWith(normalize(root + path.sep).toLowerCase());
        return { id: inRepository ? normalize(path.relative(root, id)) : normalize(id).replaceAll('\0', '[virtual]'), package: packageName(id), sha256, imports: info?.importedIds?.length ?? 0, dynamicImports: info?.dynamicallyImportedIds?.length ?? 0 };
      });
      const packages = [...new Set(modules.map(module => module.package).filter(Boolean))].sort();
      const forbiddenPresent = packages.filter(name => forbidden.includes(name));
      assert.deepEqual(forbiddenPresent, []);
      assert.ok(ids.every(id => !normalize(id).toLowerCase().startsWith(normalize(path.join(origin, 'Web/src/')).toLowerCase())));
      for (const name of required) assert.ok(packages.includes(name), 'Missing professional/target dependency: ' + name);
      const chunks = Object.values(bundle).filter(item => item.type === 'chunk').map(item => ({ file: item.fileName, modules: Object.keys(item.modules).length, imports: item.imports, dynamicImports: item.dynamicImports }));
      trace = { proposal: 47, scope: 'isolated-production-dependency-graph', primaryDeletionApplied: false, baseCommit: control.baseCommit, vite: this.meta.viteVersion, rolldown: this.meta.rolldownVersion, moduleCount: modules.length, packages, forbiddenPresent, requiredPresent: required, chunks, assets: Object.values(bundle).filter(item => item.type === 'asset').map(item => item.fileName).sort(), modules };
    },
  }],
});
assert.ok(trace && trace.chunks.length > 0);
const dist = path.join(web, 'dist');
const files = [];
function collect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(target);
    else if (entry.isFile()) files.push({ path: normalize(path.relative(dist, target)), size: fs.statSync(target).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex') });
  }
}
collect(dist);
assert.ok(files.some(file => file.path === 'index.html'));
assert.ok(files.some(file => /^_app-config-[\w.-]+\.js$/.test(file.path)));
assert.ok(files.some(file => /ezuikit-[\w-]+\.js$/.test(file.path)));
fs.writeFileSync(path.join(root, 'cleanup47-evidence/dependency-graph.json'), JSON.stringify(trace, null, 2) + '\n', 'utf8');
fs.writeFileSync(path.join(root, 'cleanup47-evidence/dist-manifest.json'), JSON.stringify({ baseCommit: control.baseCommit, dist, files }, null, 2) + '\n', 'utf8');
console.log(JSON.stringify({ productionBuild: true, moduleCount: trace.moduleCount, packageCount: trace.packages.length, vite: trace.vite, requiredEngines: trace.requiredPresent, forbiddenUiPackages: trace.forbiddenPresent, distFiles: files.length, dist }));
