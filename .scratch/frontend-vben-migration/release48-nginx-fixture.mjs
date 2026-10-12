import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { activateFrontendRelease, verifyFrontendRelease } from '../../Web/scripts/deploy/frontend-release.mjs';

// 仅在本次自有 loopback 代理内应用已核对的解压发布包。
export async function createReleaseNginx({ root, runtime, backend, native, template }) {
  const originRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const control = JSON.parse(readFileSync(join(originRoot, '.scratch/frontend-vben-migration/release48-control.tmp.json'), 'utf8'));
  const releaseOwner = realpathSync(control.ownerRoot);
  assert.equal(dirname(releaseOwner).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
  assert.match(basename(releaseOwner), /^adminnet-release48-[a-f0-9]{32}$/);
  const owner = JSON.parse(readFileSync(join(releaseOwner, '.adminnet-release48-owner.json'), 'utf8'));
  assert.equal(owner.kind, 'proposal48-local-release');
  assert.equal(realpathSync(owner.origin).toLowerCase(), realpathSync(originRoot).toLowerCase());
  const releaseRoot = realpathSync(control.extractedRoot);
  assert.equal(releaseRoot.toLowerCase(), realpathSync(join(releaseOwner, 'extracted')).toLowerCase());
  verifyFrontendRelease(releaseRoot, control.manifestSha256);
  const ownedRoot = realpathSync(runtime);
  assert.match(basename(ownedRoot), /^adminnet-vben-[a-f0-9]{32}$/);
  const marker = JSON.parse(readFileSync(join(ownedRoot, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(realpathSync(marker.runtimeRoot).toLowerCase(), ownedRoot.toLowerCase());
  assert.equal(new URL(backend).hostname, '127.0.0.1');
  const id = randomBytes(12).toString('hex');
  const name = 'adminnet-runtime-nginx-' + id;
  const directory = join(ownedRoot, name);
  const site = join(directory, 'site');
  const current = join(site, 'current');
  const dist = join(current, 'html');
  mkdirSync(dist, { recursive: true });
  const sentinel = '<!doctype html><title>本地发布预检占位页</title>';
  writeFileSync(join(dist, 'index.html'), sentinel, 'utf8');
  const releasedHtml = readFileSync(join(releaseRoot, 'html/index.html'), 'utf8');
  writeFileSync(join(directory, '.owner'), ownedRoot, 'utf8');
  const index = releasedHtml;
  const configMatch = index.match(/(?:src=["'])([^"']*_app-config[^"']*\.js)["']/);
  assert.ok(configMatch, 'Production HTML must load its external runtime configuration');
  const configName = basename(configMatch[1]);
  assert.ok(existsSync(join(releaseRoot, 'html', configName)));
  const originalConfig = readFileSync(join(releaseRoot, 'html', configName), 'utf8');
  assert.equal((originalConfig.match(/"VITE_GLOB_API_URL"\s*:\s*"[^"\\]*"/g) ?? []).length, 1);
  const hashedAsset = readdirSync(join(releaseRoot, 'html/js')).find(file => /-[\w-]{8,}\.js$/.test(file));
  assert.ok(hashedAsset, 'Production hashed JS resource required');
  let config = readFileSync(join(releaseRoot, 'deploy', template.startsWith('docker/') ? 'nginx-tls.conf' : 'nginx-http.conf'), 'utf8');
  config = config.replaceAll('/usr/share/nginx/html', '/usr/share/nginx/site/current/html');
  config = config.replaceAll('http://adminNet:5005', 'http://host.docker.internal:' + new URL(backend).port);
  const tls = template.startsWith('docker/');
  const tlsDirectory = join(directory, 'key');
  if (tls) {
    mkdirSync(tlsDirectory);
    // 生成仅本次测试使用的证书，不读取部署证书。
    const certificateScript = join(directory, 'certificate.ps1');
    const quote = value => "'" + value.replaceAll("'", "''") + "'";
    writeFileSync(certificateScript, "$ErrorActionPreference = 'Stop'\n" +
      "$rsa = [System.Security.Cryptography.RSA]::Create(2048)\n" +
      "$request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=localhost', $rsa, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)\n" +
      "$cert = $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5), [DateTimeOffset]::UtcNow.AddDays(1))\n" +
      "Set-Content -LiteralPath " + quote(join(tlsDirectory, 'abc.admin.com.pem')) + " -Value $cert.ExportCertificatePem() -Encoding UTF8\n" +
      "Set-Content -LiteralPath " + quote(join(tlsDirectory, 'abc.admin.com.key')) + " -Value $rsa.ExportPkcs8PrivateKeyPem() -Encoding UTF8\n" +
      "$cert.Dispose()\n$rsa.Dispose()\n", 'utf8');
    await native('pwsh', ['-NoProfile', '-File', certificateScript]);
    config = config.replace(/listen\s+443 ssl;/, 'listen 8443 ssl;').replace(/listen\s+80;/, 'listen 8080;');
  }
  const configPath = join(directory, 'nginx.conf');
  writeFileSync(configPath, config, 'utf8');
  const args = ['run', '-d', '--name', name, '--label', 'adminnet.runtime.fixture=' + id,
    '-p', '127.0.0.1::8080', '-v', configPath + ':/etc/nginx/nginx.conf:ro',
    '-v', site + ':/usr/share/nginx/site:ro'];
  if (tls) args.push('-p', '127.0.0.1::8443', '-v', tlsDirectory + ':/etc/nginx/key:ro');
  args.push('nginx:1.28-alpine');
  let created = false;
  async function close() {
    if (!created) return;
    assert.equal(readFileSync(join(directory, '.owner'), 'utf8'), ownedRoot);
    const { stdout } = await native('docker', ['inspect', name, '--format', '{{ index .Config.Labels "adminnet.runtime.fixture" }}']);
    assert.equal(stdout.trim(), id, 'Nginx ownership label must match before removal');
    await native('docker', ['rm', '-f', '-v', name]);
    const remaining = await native('docker', ['ps', '-a', '--filter', 'label=adminnet.runtime.fixture=' + id, '--format', '{{.Names}}']);
    assert.equal(remaining.stdout.trim(), '', 'Owned Nginx must be removed');
    created = false;
  }
  try {
    await native('docker', args, 60000);
    created = true;
    const { stdout } = await native('docker', ['inspect', name]);
    const container = JSON.parse(stdout)[0];
    assert.equal(container.Config.Labels['adminnet.runtime.fixture'], id);
    const bindings = container.NetworkSettings.Ports;
    for (const port of Object.values(bindings).flat()) assert.equal(port.HostIp, '127.0.0.1');
    const baseUrl = 'http://127.0.0.1:' + bindings['8080/tcp'][0].HostPort;
    const tlsUrl = tls ? 'https://127.0.0.1:' + bindings['8443/tcp'][0].HostPort : undefined;
    await native('docker', ['exec', name, 'nginx', '-t']);
    const readyDeadline = Date.now() + 15000;
    let ready = false;
    while (Date.now() < readyDeadline) {
      try { ready = (await fetch(baseUrl + '/index.html', { signal: AbortSignal.timeout(2000) })).status === 200; } catch { }
      if (ready) break;
      await new Promise(resolveReady => setTimeout(resolveReady, 100));
    }
    assert.ok(ready, 'Real Nginx must serve the production HTML');
    const before = await fetch(baseUrl + '/index.html');
    assert.equal(await before.text(), sentinel);
    const broken = join(directory, 'tampered-release');
    cpSync(releaseRoot, broken, { recursive: true });
    writeFileSync(join(broken, 'html/index.html'), 'invalid candidate', 'utf8');
    assert.throws(() => activateFrontendRelease({ source: broken, target: current, manifestSha256: control.manifestSha256, replace: true }), /大小|哈希/);
    assert.equal(readFileSync(join(dist, 'index.html'), 'utf8'), sentinel);
    assert.equal(await (await fetch(baseUrl + '/index.html')).text(), sentinel);
    const activation = activateFrontendRelease({ source: releaseRoot, target: current, manifestSha256: control.manifestSha256, replace: true });
    verifyFrontendRelease(current, control.manifestSha256);
    const activated = await fetch(baseUrl + '/index.html');
    assert.equal(await activated.text(), releasedHtml);
    assert.match(activated.headers.get('cache-control'), /no-store/);
    assert.equal(readdirSync(site).some(name => /stage-|rollback-|deploy-lock/.test(name)), false);
    const cutover = { rejectedTampered: true, currentPreserved: true, liveActivation: true, parentMounted: true, previousReleaseRetained: activation.previousReleaseRetained, manifestSha256: control.manifestSha256, files: activation.files };
    return {
      baseUrl, tlsUrl, template, configName, cutover, assetPath: '/js/' + hashedAsset, close,
      setApiUrl(value) {
        assert.equal(readFileSync(join(directory, '.owner'), 'utf8'), ownedRoot);
        assert.equal(dirname(resolve(dist, configName)), resolve(dist));
        const next = originalConfig.replace(/"VITE_GLOB_API_URL"\s*:\s*"[^"\\]*"/, '"VITE_GLOB_API_URL":' + JSON.stringify(value));
        writeFileSync(join(dist, configName), next, 'utf8');
      },
    };
  } catch (error) {
    try { await close(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Owned Nginx setup and cleanup failed'); }
    throw error;
  }
}
