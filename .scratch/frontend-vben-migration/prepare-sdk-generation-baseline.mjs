import fs from 'node:fs';
const source = fs.readFileSync('.scratch/frontend-vben-migration/run-plugin-service-baseline.mjs', 'utf8');
let head = source.slice(0, source.indexOf("const route = 'plugin34'"));
head = head.replace("'real-postgresql-plugin-service-no-browser'", "'real-postgresql-swagger-sdk-generation-no-browser'").replaceAll('plugin-service-baseline.json', 'sdk-generation-baseline.json');
let tail = source.slice(source.indexOf('try {\n  const port = Number(process.argv[2]'));
tail = tail.replace("'-PluginFixture',", "'-PluginFixture', '-SdkFixture',").replace('?? 5034', '?? 5035').replace('await runService();', 'await runGeneration();').replaceAll('plugin-service-baseline.json', 'sdk-generation-baseline.json');
const body = `
async function runGeneration() {
  const fs = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const workspace = join(runtime, 'sdk-copy');
  const web = join(workspace, 'Web');
  const app = join(web, 'apps/web-antdv-next');
  fs.mkdirSync(join(web, 'api_build'), { recursive: true });
  fs.mkdirSync(join(web, 'node_modules'), { recursive: true });
  fs.mkdirSync(join(app, 'node_modules'), { recursive: true });
  fs.mkdirSync(join(app, 'src'), { recursive: true });
  for (const name of ['build.ps1', 'normalize-sdk.mjs', 'swagger-codegen-cli.jar']) fs.copyFileSync(join(root, 'Web/api_build', name), join(web, 'api_build', name));
  for (const [target, from] of [[join(web, 'node_modules/typescript'), join(root, 'Web/node_modules/typescript')], [join(app, 'node_modules/axios'), join(root, 'Web/apps/web-antdv-next/node_modules/axios')]]) fs.symlinkSync(fs.realpathSync(from), target, 'junction');
  const digest = directory => {
    const hash = createHash('sha256');
    const files = fs.readdirSync(directory, { recursive: true }).filter(file => fs.statSync(join(directory, file)).isFile()).sort();
    for (const file of files) hash.update(file).update(fs.readFileSync(join(directory, file)));
    return { sha256: hash.digest('hex'), files: files.length };
  };
  for (const [module, group, directory] of [['apiServices','Default','api-services'], ['dingTalk','DingTalk','api-plugins/dingTalk'], ['goView','GoView','api-plugins/goView']]) {
    stage = 'generate-' + module;
    const url = new URL('/swagger/' + group + '/swagger.json', base);
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200, '真实 Swagger 分组 ' + group);
    const swagger = await response.json();
    assert.ok(Object.keys(swagger.paths ?? {}).length > 0);
    if (group === 'Default') {
      assert.equal(swagger.components.schemas.StatusEnum.type, 'integer', '状态枚举保持应用数字合同');
      assert.deepEqual(swagger.components.schemas.StatusEnum.enum, [1, 2]);
    }
    if (group === 'DingTalk') {
      for (const operation of ['addWorkflowConfig', 'updateWorkflowConfig', 'deleteWorkflowConfig']) {
        assert.ok(swagger.paths['/api/dingTalk/' + operation]?.post, '审批配置操作保留独立 POST 路由：' + operation);
      }
    }
    fs.writeFileSync(join(evidence, 'swagger-' + group + '.json'), JSON.stringify(swagger), 'utf8');
    const result = await native('pwsh', ['-NoProfile', '-File', join(web, 'api_build/build.ps1'), '-JavaPath', process.env.SDK35_JAVA ?? 'java', '-Module', module, '-ApiUrl', url.href], 180000);
    fs.writeFileSync(join(evidence, 'generate-' + module + '.log'), clean(result.stdout + result.stderr), 'utf8');
    const destination = join(app, 'src', directory);
    const before = digest(destination);
    assert.ok(before.files > 0);
    for (let pass = 0; pass < 2; pass++) {
      await native('node', [join(web, 'api_build/normalize-sdk.mjs'), destination], 120000);
      assert.deepEqual(digest(destination), before, '后处理重复运行幂等');
    }
    record('generate-and-normalize-' + module, { ...before, swaggerPaths: Object.keys(swagger.paths).length });
    await assert.rejects(() => native('pwsh', ['-NoProfile', '-File', join(web, 'api_build/build.ps1'), '-JavaPath', process.env.SDK35_JAVA ?? 'java', '-Module', module, '-ApiUrl', new URL('/swagger/missing-sdk35/swagger.json', base).href], 60000));
    assert.deepEqual(digest(destination), before, '生成失败保留已有 SDK');
    assert.deepEqual(fs.readdirSync(join(web, 'node_modules/.cache/api-generation')), [], '暂存和备份目录已清理');
    record('generation-failure-preserves-' + module);
  }
  report.generatedWorkspace = workspace;
  report.fixtureRecordsRemoved = true;
}
async function cleanupFixtures() { report.fixtureRecordsRemoved = true; }
`;
fs.writeFileSync('.scratch/frontend-vben-migration/run-sdk-generation-baseline.mjs', head + body + tail, 'utf8');
