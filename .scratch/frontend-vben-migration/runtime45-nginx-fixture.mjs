import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

// 只操作当前隔离 API 的副本和带本次标签的 Nginx 容器。
export async function createRuntimeNginx({ root, runtime, backend, native, template }) {
  const ownedRoot = realpathSync(runtime);
  assert.match(basename(ownedRoot), /^adminnet-vben-[a-f0-9]{32}$/);
  const marker = JSON.parse(readFileSync(join(ownedRoot, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(realpathSync(marker.runtimeRoot).toLowerCase(), ownedRoot.toLowerCase());
  assert.equal(new URL(backend).hostname, '127.0.0.1');
  const id = randomBytes(12).toString('hex');
  const name = 'adminnet-runtime-nginx-' + id;
  const directory = join(ownedRoot, name);
  const dist = join(directory, 'html');
  mkdirSync(directory);
  cpSync(join(root, 'Web/dist'), dist, { recursive: true });
  writeFileSync(join(directory, '.owner'), ownedRoot, 'utf8');
  const index = readFileSync(join(dist, 'index.html'), 'utf8');
  const configMatch = index.match(/(?:src=["'])([^"']*_app-config[^"']*\.js)["']/);
  assert.ok(configMatch, 'Production HTML must load its external runtime configuration');
  const configName = basename(configMatch[1]);
  assert.ok(existsSync(join(dist, configName)));
  const originalConfig = readFileSync(join(dist, configName), 'utf8');
  assert.equal((originalConfig.match(/"VITE_GLOB_API_URL"\s*:\s*"[^"\\]*"/g) ?? []).length, 1);
  const hashedAsset = readdirSync(join(dist, 'js')).find(file => /-[\w-]{8,}\.js$/.test(file));
  assert.ok(hashedAsset, 'Production hashed JS resource required');
  let config = readFileSync(join(root, template), 'utf8');
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
    '-v', dist + ':/usr/share/nginx/html:ro'];
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
    return {
      baseUrl, tlsUrl, template, configName, assetPath: '/js/' + hashedAsset, close,
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
