import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createMqttBroker } from './mqtt-broker-fixture.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const appRequire = createRequire(join(root, 'Web/apps/web-antdv-next/package.json'));
const { chromium, expect } = createRequire(join(root, 'Web/package.json'))('@playwright/test');
const ts = appRequire('typescript');
const mqttBundle = readFileSync(join(dirname(appRequire.resolve('mqtt')), '../dist/mqtt.min.js'));
const execute = promisify(execFile);
function quote(value) { return "'" + String(value).replaceAll("'", "''") + "'"; }
async function native(program, args) {
 const script = "$ErrorActionPreference = 'Stop'\n& " + quote(program) + ' ' + args.map(quote).join(' ') + "\nif ($LASTEXITCODE -ne 0) { throw 'Native command failed' }";
 return execute('pwsh', ['-NoProfile', '-Command', script], { windowsHide: true, timeout: 30000 });
}
const runtime = mkdtempSync(join(tmpdir(), 'adminnet-mqtt-session-regression-'));
let broker, server, browser;
try {
 broker = await createMqttBroker(runtime, native, value => value);
 server = createServer((request, response) => {
  if (request.url === '/') { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><title>MQTT session regression</title><script src="/mqtt.js"></script>'); return; }
  response.setHeader('Content-Type', 'text/javascript');
  if (request.url === '/mqtt.js') { response.end(mqttBundle); return; }
  const sourceName = { '/mqtt-session.js': 'mqtt-session.ts', '/mqtt-profile': 'mqtt-profile.ts' }[request.url];
  if (!sourceName) { response.writeHead(404); response.end(); return; }
  const source = readFileSync(join(root, 'Web/apps/web-antdv-next/src/views/mqttx', sourceName), 'utf8');
  response.end(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
 });
 await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done); });
 browser = await chromium.launch({ channel: 'msedge', headless: true });
 const page = await browser.newPage();
 await page.goto('http://127.0.0.1:' + server.address().port);
 await page.evaluate(async connection => {
  const { MqttSession } = await import('/mqtt-session.js');
  const { createMqttProfile } = await import('/mqtt-profile');
  window.socketStates = [];
  window.received = [];
  window.session = new MqttSession((url, options) => window.mqtt.connect(url, { ...options, createWebsocket(url, protocols) { const socket = new WebSocket(url, protocols); window.socketStates.push(socket); return socket; } }), {
   status: value => { window.mqttStatus = value; }, message: (_topic, text) => window.received.push(text), error: () => { window.mqttError = true; },
  });
  window.session.connect({ ...createMqttProfile(), ...connection });
 }, { host: '127.0.0.1', port: broker.port, username: broker.username, password: broker.password, reconnectPeriod: 100 });
 await expect.poll(() => page.evaluate(() => window.mqttStatus)).toBe('connected');
 await page.evaluate(topic => window.session.subscribe([topic], 1), broker.prefix + '/probe');
 await page.evaluate(topic => window.session.publish(topic, 'real-session-probe', 1, false), broker.prefix + '/probe');
 await expect.poll(() => page.evaluate(() => window.received)).toContain('real-session-probe');
 await page.evaluate(topic => window.session.unsubscribe([topic]), broker.prefix + '/probe');
 const started = Date.now();
 await page.evaluate(() => window.session.disconnect());
 try {
  await expect.poll(() => page.evaluate(() => window.socketStates.filter(socket => socket.readyState !== WebSocket.CLOSED).length), { timeout: 5000 }).toBe(0);
 } finally {
  console.log(JSON.stringify({ closeMs: Date.now() - started, nativeStates: await page.evaluate(() => window.socketStates.map(socket => socket.readyState)), status: await page.evaluate(() => window.mqttStatus) }));
 }
 console.log('PASS real-mqtt-session-unsubscribe-disconnect-native-closed');
} finally {
 const results = await Promise.allSettled([browser?.close(), server ? new Promise((done, reject) => server.close(error => error ? reject(error) : done())) : undefined, broker?.destroy()]);
 assert.ok(results.every(result => result.status === 'fulfilled'), 'Regression resources must all be removed');
 console.log('Owned browser, HTTP server, broker and volumes removed');
}
