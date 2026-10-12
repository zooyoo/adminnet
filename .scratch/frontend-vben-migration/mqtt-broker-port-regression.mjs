import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createMqttBroker } from './mqtt-broker-fixture.mjs';

const execute = promisify(execFile);
function quote(value) { return "'" + String(value).replaceAll("'", "''") + "'"; }
async function native(program, args) {
 const script = "$ErrorActionPreference = 'Stop'\n& " + quote(program) + ' ' + args.map(quote).join(' ') + "\nif ($LASTEXITCODE -ne 0) { throw 'Native command failed' }";
 return execute('pwsh', ['-NoProfile', '-Command', script], { windowsHide: true, timeout: 30000 });
}
const runtime = mkdtempSync(join(tmpdir(), 'adminnet-mqtt-port-regression-'));
let broker;
try {
 broker = await createMqttBroker(runtime, native, value => value);
 const initialPort = broker.port;
 await broker.stop();
 await broker.start();
 const inspection = JSON.parse((await native('docker', ['inspect', broker.name])).stdout)[0];
 const restartedPort = Number(inspection.NetworkSettings.Ports['9001/tcp'][0].HostPort);
 console.log(JSON.stringify({ initialPort, restartedPort, unchanged: initialPort === restartedPort }));
 assert.equal(restartedPort, initialPort, 'Broker 重启必须保持 WebSocket 端口，才能验证原地址自动重连');
} finally {
 await broker?.destroy();
 console.log('Owned broker and volumes removed');
}
if (broker) console.log('PASS mqtt-broker-restart-preserves-websocket-port');
