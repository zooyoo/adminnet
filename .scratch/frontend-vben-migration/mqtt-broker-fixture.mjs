import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';

async function allocateLocalPort() {
 const server = createServer();
 await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
 const port = server.address().port;
 await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
 return port;
}

// native 由真实验收执行器提供，统一通过 pwsh 调用 Docker。
export async function createMqttBroker(directory, native, secret) {
 const id = randomBytes(12).toString('hex');
 const name = 'adminnet-mqtt-' + id;
 const config = join(directory, name);
 mkdirSync(config, { recursive: true });
 const username = 'fixture_' + id;
 const password = secret(randomBytes(24).toString('hex'));
 const probeUsername = 'probe_' + id;
 const probePassword = secret(randomBytes(24).toString('hex'));
 const prefix = 'mqtt/admintnet/' + id;
 writeFileSync(join(config, 'passwords'), `${username}:${password}\n${probeUsername}:${probePassword}\n`, 'utf8');
 writeFileSync(join(config, 'acl'), `user ${username}\ntopic readwrite ${prefix}/#\nuser ${probeUsername}\ntopic readwrite ${prefix}-denied/#\n`, 'utf8');
 writeFileSync(join(config, 'mosquitto.conf'), 'listener 9001\nprotocol websockets\nallow_anonymous false\npassword_file /mosquitto/config/passwords\nacl_file /mosquitto/config/acl\npersistence false\nlog_dest stdout\n', 'utf8');
 let created = false;
 async function destroy() {
  if (!created) return;
  const { stdout } = await native('docker', ['inspect', name]);
  const inspection = JSON.parse(stdout)[0];
  assert.equal(inspection.Config.Labels['adminnet.mqtt.fixture'], id);
  await native('docker', ['rm', '-f', '-v', name]);
  created = false;
  const left = await native('docker', ['ps', '-aq', '--filter', 'label=adminnet.mqtt.fixture=' + id]);
  assert.equal(left.stdout.trim(), '');
 }
 try {
  // Docker helper 只加密本次随机密码文件，不输出密码或传入命令行。
  await native('docker', ['run', '--rm', '--network', 'none', '--mount', `type=bind,source=${config},target=/mosquitto/config`, 'eclipse-mosquitto:2', 'mosquitto_passwd', '-U', '/mosquitto/config/passwords']);
  // 显式绑定已分配的本地端口，使 stop/start 后仍使用同一个 WebSocket 地址。
  const port = await allocateLocalPort();
  await native('docker', ['create', '--name', name, '--label', 'adminnet.mqtt.fixture=' + id, '-p', `127.0.0.1:${port}:9001`, '--mount', `type=bind,source=${config},target=/mosquitto/config,readonly`, 'eclipse-mosquitto:2']);
  created = true;
  await native('docker', ['start', name]);
  const { stdout } = await native('docker', ['inspect', name]);
  const inspection = JSON.parse(stdout)[0];
  const binding = inspection.NetworkSettings.Ports['9001/tcp'][0];
  assert.equal(binding.HostIp, '127.0.0.1');
  assert.equal(Number(binding.HostPort), port);
  return { name, username, password, probeUsername, probePassword, prefix, registration: id, port: Number(binding.HostPort), url: `ws://127.0.0.1:${binding.HostPort}/mqtt`, image: inspection.Image, destroy,
   async stop() { assert.ok(created); await native('docker', ['stop', '-t', '2', name]); },
   async start() { assert.ok(created); await native('docker', ['start', name]); },
  };
 } catch (error) {
  // helper 若在加密前失败，也清除本次密码原文。
  writeFileSync(join(config, 'passwords'), '', 'utf8');
  try { await destroy(); } catch (cleanupError) { throw new AggregateError([error, cleanupError], 'MQTT fixture 创建及清理失败'); }
  throw error;
 }
}
