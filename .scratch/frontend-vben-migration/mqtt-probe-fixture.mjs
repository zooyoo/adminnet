import { createRequire } from 'node:module';
const { connect } = createRequire(new URL('../../Web/apps/web-antdv-next/package.json', import.meta.url))('mqtt');

// 真实 broker 的设备端探针，核对浏览器发出的协议并返回设备状态。
export async function createMqttProbe(broker) {
  const client = connect(broker.url, { username: broker.username, password: broker.password, clean: true, reconnectPeriod: 0, connectTimeout: 10000 });
  client.on('error', () => {});
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('MQTT probe connect timeout')), 15000);
      client.once('connect', () => { clearTimeout(timer); resolve(); });
      client.once('error', error => { clearTimeout(timer); reject(error); });
    });
    const received = [];
    client.on('message', (topic, bytes) => { if (topic === broker.prefix + '/into') received.push(JSON.parse(bytes.toString())); });
    await client.subscribeAsync(broker.prefix + '/into', { qos: 1 });
    return { received, publish: (suffix, payload) => client.publishAsync(broker.prefix + '/' + suffix, JSON.stringify(payload), { qos: 1 }), destroy: async () => { await client.endAsync(true); delete client.options.username; delete client.options.password; } };
  } catch (error) { await client.endAsync(true); throw error; }
}
