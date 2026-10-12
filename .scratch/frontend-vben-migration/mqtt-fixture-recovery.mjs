import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

// 仅恢复明确指定且经过 runtime marker 校验的隔离环境。
export async function recoverMqttFixture({ runtime, evidence, native, api, sql, admin, report }) {
  const previous = join(evidence, 'mqtt-browser-baseline.json');
  if (existsSync(previous)) {
    const original = JSON.parse(readFileSync(previous, 'utf8'));
    assert.equal(original.passed, false, '只能恢复尚未完成的 MQTT 验收');
    writeFileSync(join(evidence, 'mqtt-interrupted-baseline.json'), JSON.stringify(original, null, 2), 'utf8');
  }
  const candidates = (await native('docker', ['ps', '-aq', '--filter', 'label=adminnet.mqtt.fixture'])).stdout.trim().split(/\r?\n/).filter(Boolean);
  report.recoveredBrokerIds = [];
  for (const id of candidates) {
    const inspection = JSON.parse((await native('docker', ['inspect', id])).stdout)[0];
    const label = inspection.Config.Labels['adminnet.mqtt.fixture'];
    assert.match(label, /^[a-f0-9]{24}$/);
    const name = 'adminnet-mqtt-' + label;
    const mount = inspection.Mounts.find(item => item.Destination === '/mosquitto/config');
    if (mount?.Source.toLowerCase() !== resolve(runtime, name).toLowerCase()) continue;
    assert.equal(inspection.Name, '/' + name);
    await native('docker', ['rm', '-f', '-v', id]);
    assert.equal((await native('docker', ['ps', '-aq', '--filter', 'label=adminnet.mqtt.fixture=' + label])).stdout.trim(), '');
    report.recoveredBrokerIds.push(label);
  }
  const ids = (await sql("SELECT id FROM sysmenu WHERE component='/mqttx/index' AND name ~ '^tpl_[a-f0-9]{10}_mqtt$'" )).split(/\r?\n/).filter(Boolean);
  for (const id of ids) {
    assert.match(id, /^[1-9]\d*$/);
    await api(admin, 'sysMenu/delete', { id });
    for (const [table, field] of [['sysmenu','id'],['systenantmenu','menuid'],['sysrolemenu','menuid'],['sysusermenu','menuid']]) assert.equal(await sql(`SELECT count(*) FROM ${table} WHERE ${field}=${id}`), '0');
  }
  report.recoveredMenuIds = ids;
}
