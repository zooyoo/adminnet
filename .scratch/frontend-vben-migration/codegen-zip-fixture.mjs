import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { startMqttApi } from './mqtt-api-startup.mjs';

const execute = promisify(execFile);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const quote = (text) => "'" + String(text).replaceAll("'", "''") + "'";
function assertChild(path, parent) {
  const child = relative(realpathSync(parent), resolve(path));
  assert.ok(child && !child.startsWith('..') && !/^[A-Za-z]:/.test(child), 'Fixture target stays within its owned parent');
}
async function logged(native, program, args, log, timeout = 330000) {
  try {
    const result = await native(program, args, timeout);
    writeFileSync(log, (result.stdout ?? '') + (result.stderr ?? ''), 'utf8');
    return result;
  } catch (error) {
    writeFileSync(log, String(error.stdout ?? '') + String(error.stderr ?? ''), 'utf8');
    throw new Error('Isolated build failed; inspect ' + log);
  }
}
export async function buildGeneratedApi(root, runtime, native, extracted, evidence) {
  const fixture = join(runtime, 'codegen-fixture');
  mkdirSync(fixture, { recursive: true });
  cpSync(join(root, '.scratch/frontend-vben-migration/codegen-fixture/CodeGenAcceptance.cs'), join(fixture, 'CodeGenAcceptance.cs'));
  cpSync(join(root, '.scratch/frontend-vben-migration/codegen-fixture/CodeGenAcceptance.targets'), join(fixture, 'CodeGenAcceptance.targets'));
  cpSync(join(extracted, 'Admin.NET.Application/Service/CodeGenAcceptance'), join(fixture, 'generated'), { recursive: true });
  const output = join(runtime, 'generated-api-build');
  await logged(native, 'dotnet', ['build', join(root, 'Admin.NET/Admin.NET.Web.Entry/Admin.NET.Web.Entry.csproj'), '-c', 'Debug', '-f', 'net10.0', '-m:1', '-nr:false', '--artifacts-path', join(runtime, 'generated-api-artifacts'), '-o', output, '-p:CustomAfterMicrosoftCommonTargets=' + join(fixture, 'CodeGenAcceptance.targets'), '-p:CodeGenAcceptanceRoot=' + fixture], join(evidence, 'generated-api-build.log'));
  return output;
}
export async function restartGeneratedApi(root, runtime, output) {
  return startMqttApi(['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/restart-codegen-isolated-api.ps1'), '-RuntimeRoot', runtime, '-BuildRoot', output], 150000);
}
export async function unpackCodeGen(root, runtime, native, archive, manifest, preview) {
  const output = join(runtime, 'zip-extracted');
  assert.ok(!existsSync(output), 'Extraction destination is new');
  const python = resolve(dirname(process.execPath), '../../python/python.exe');
  assert.ok(existsSync(python), 'Run this fixture with the bundled Node and Python runtime');
  const script = `import sys, zipfile, pathlib, json\narchive, output = sys.argv[1:]\nroot = pathlib.Path(output).resolve()\nwith zipfile.ZipFile(archive) as z:\n assert z.testzip() is None, 'ZIP CRC check failed'\n names = z.namelist()\n assert len(names) == len(set(names)), 'Duplicate ZIP entries'\n for name in names:\n  assert '\\\\' not in name and not pathlib.PurePosixPath(name).is_absolute() and '..' not in pathlib.PurePosixPath(name).parts, 'Unsafe ZIP entry'\n  target = (root / name).resolve()\n  assert target.is_relative_to(root), 'ZIP entry escapes fixture'\n  if name.endswith('/'):\n   target.mkdir(parents=True, exist_ok=True)\n  else:\n   target.parent.mkdir(parents=True, exist_ok=True)\n   target.write_bytes(z.read(name))\n print(json.dumps([name for name in names if not name.endswith('/')]))`;
  const result = await native(python, ['-c', script, archive, output]);
  const names = JSON.parse(result.stdout.trim());
  assert.deepEqual([...names].sort(), manifest.map((file) => file.path).sort());
  for (const file of manifest) {
    assertChild(join(output, file.path), output);
    const bytes = readFileSync(join(output, file.path));
    assert.equal(bytes.length, file.size);
    assert.equal(sha(bytes), file.sha256);
    assert.equal(bytes.toString('utf8'), preview[file.template], 'Preview and ZIP bytes agree for ' + file.template);
  }
  return output;
}
export async function prepareGeneratedApp(root, runtime, native, extracted, base, evidence) {
  const workspace = join(runtime, 'generated-workspace');
  const web = join(workspace, 'Web');
  const app = join(web, 'apps/web-antdv-next');
  assert.ok(!existsSync(workspace), 'Generated test workspace is new');
  mkdirSync(web, { recursive: true });
  writeFileSync(join(workspace, '.adminnet-codegen-workspace'), runtime, 'utf8');
  for (const name of ['package.json', 'pnpm-workspace.yaml', 'tsconfig.json', 'eslint.config.mjs']) {
    const source = join(root, 'Web', name);
    if (existsSync(source)) cpSync(source, join(web, name));
  }
  for (const name of ['node_modules', 'packages', 'internal']) {
    const source = join(root, 'Web', name);
    if (existsSync(source)) symlinkSync(source, join(web, name), 'junction');
  }
  const sourceApp = join(root, 'Web/apps/web-antdv-next');
  cpSync(sourceApp, app, { recursive: true, filter: (source) => {
    const parts = relative(sourceApp, source).split(sep);
    return !parts.includes('node_modules') && !parts.includes('api-services') && !parts.includes('dist') && !parts.includes('.turbo');
  } });
  symlinkSync(join(sourceApp, 'node_modules'), join(app, 'node_modules'), 'junction');
  cpSync(join(extracted, 'Web/apps/web-antdv-next/src'), join(app, 'src'), { recursive: true });
  const tools = join(web, 'api_build'); mkdirSync(tools, { recursive: true });
  for (const name of ['build.ps1', 'normalize-sdk.mjs', 'swagger-codegen-cli.jar']) cpSync(join(root, 'Web/api_build', name), join(tools, name));
  const findJava = "$ErrorActionPreference = 'Stop'\n$candidate = Get-ChildItem -LiteralPath 'C:\\Program Files\\JetBrains' -Filter java.exe -Recurse -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match '[\\\\/]jbr[\\\\/]bin[\\\\/]java.exe$' } | Select-Object -First 1\nif (-not $candidate) { throw 'A modern Java runtime for the existing SDK generator is required.' }\n$candidate.FullName";
  const java = (await execute('pwsh', ['-NoProfile', '-Command', findJava], { windowsHide: true, timeout: 30000 })).stdout.trim();
  assert.ok(existsSync(java));
  await logged(native, 'pwsh', ['-NoProfile', '-File', join(tools, 'build.ps1'), '-Module', 'apiServices', '-ApiUrl', new URL('/swagger/Default/swagger.json', base).href, '-JavaPath', java], join(evidence, 'generated-sdk.log'));
  const pnpm = resolve(dirname(process.execPath), '../../pnpm/bin/pnpm.mjs');
  assert.ok(existsSync(pnpm), 'Run this fixture with the bundled Node and pnpm runtime');
  await logged(native, process.execPath, [pnpm, '--dir', app, 'exec', 'vue-tsc', '--noEmit', '--skipLibCheck'], join(evidence, 'generated-typecheck.log'));
  await logged(native, process.execPath, [pnpm, '--dir', app, 'exec', 'vite', 'build', '--mode', 'production'], join(evidence, 'generated-production-build.log'));
  return { workspace, dist: join(web, 'dist'), sdkSha256: sha(readFileSync(join(app, 'src/api-services/api.ts'))) };
}
export function cleanupGeneratedApp(runtime) {
  const workspace = join(runtime, 'generated-workspace');
  if (!existsSync(workspace)) return;
  assertChild(workspace, runtime);
  assert.equal(readFileSync(join(workspace, '.adminnet-codegen-workspace'), 'utf8'), runtime);
  rmSync(workspace, { recursive: true, force: false });
  assert.ok(!existsSync(workspace));
}
