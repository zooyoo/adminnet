import { spawn } from 'node:child_process';

// 以启动器的就绪合同为边界，避免后台 API 继承管道导致 execFile 等待超时。
export function startMqttApi(args, timeout = 330000) {
  return new Promise((resolve, reject) => {
    const child = spawn('pwsh', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.destroy();
      child.stderr.destroy();
      child.unref();
      if (error) reject(error);
      else resolve({ stdout });
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('Isolated MQTT API startup timed out; inspect runtime logs'));
    }, timeout);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.length > 1024 * 1024) { child.kill(); finish(new Error('Isolated API startup exceeded output limit')); return; }
      if (/^Ready: real sysConfig\/sysInfo returned code 200\.\r?$/m.test(stdout)) finish();
    });
    child.stderr.resume();
    child.once('error', () => finish(new Error('Cannot launch isolated MQTT API startup')));
    child.once('close', code => finish(new Error(`Isolated MQTT API startup exited before readiness (${code}); inspect runtime logs`)));
  });
}
