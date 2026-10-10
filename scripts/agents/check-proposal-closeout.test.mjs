import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { auditSession, decodeLog } from './check-proposal-closeout.mjs';

const rootId = 'session-00000000-0000-0000-0000-000000000001';
const childId = '00000000-0000-0000-0000-000000000002';
const grandchildId = '00000000-0000-0000-0000-000000000003';
const event = (type, data) => ({ type, data });
const catalog = (id = childId, mode = 'continuable') => event('subagent/catalog', { childId: id, mode });
const completed = [event('turn/start', { turn: 1 }), event('turn/end', { turn: 1, reason: { kind: 'completed' } })];
const member = phase => event('team/member', { member: { id: childId, name: 'template-ui', phase } });

function fixture(t, parentEvents, children = { [childId]: completed }) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'proposal-closeout-'));
  t.after(() => {
    // 只清理本测试明确创建的临时目录。
    assert.match(path.basename(directory), /^proposal-closeout-/);
    fs.rmSync(directory, { recursive: true, force: true });
  });
  for (const [id, events] of Object.entries({ [rootId]: parentEvents, ...children })) {
    const childDirectory = path.join(directory, id);
    fs.mkdirSync(childDirectory);
    const rows = [{ type: 'session', version: 4, id }, ...events];
    // 每条记录一个压缩帧，覆盖实际 DSH 多帧日志格式。
    const buffer = Buffer.concat(rows.map(row => zlib.zstdCompressSync(Buffer.from(`${JSON.stringify(row)}\n`, 'utf8'))));
    fs.writeFileSync(path.join(childDirectory, 'session.v4.jsonl.zstd'), buffer);
  }
  return path.join(directory, rootId, 'session.v4.jsonl.zstd');
}

// 真实事故最小复现：回合完成、成员仍 active 时，旧流程继续派发下一提案。
test('业务回合 completed 的 Team 成员仍阻塞下一提案', t => {
  const result = auditSession(fixture(t, [catalog(), member('active')]), 34);
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.blockers, [{ code: 'NO_VERIFIABLE_CLOSE_RECEIPT', id: childId }]);
});

test('失败的普通可续聊子智能体也纳入检查', t => {
  const failed = [event('turn/start', {}), event('turn/end', { reason: { kind: 'error' } })];
  const result = auditSession(fixture(t, [catalog()], { [childId]: failed }), 34);
  assert.equal(result.agents.length, 1);
  assert.equal(result.status, 'blocked');
  assert.ok(result.blockers.some(item => item.code === 'UNSETTLED_RESULT'));
});

test('上次 completed 后又被复用且正在运行仍阻塞', t => {
  const result = auditSession(fixture(t, [catalog()], { [childId]: [...completed, event('turn/start', {})] }), 34);
  assert.equal(result.agents[0].outcome, 'running');
  assert.ok(result.blockers.some(item => item.code === 'UNSETTLED_RESULT'));
});

test('用户中止不能当作收尾完成', t => {
  const aborted = [event('turn/start', {}), event('turn/end', { reason: { kind: 'aborted' } })];
  const result = auditSession(fixture(t, [catalog()], { [childId]: aborted }), 34);
  assert.equal(result.status, 'blocked');
  assert.equal(result.agents[0].outcome, 'aborted');
});

test('成功结束的一次性委派可通过快照检查', t => {
  const result = auditSession(fixture(t, [catalog(childId, 'one-shot')]), 34);
  assert.equal(result.status, 'snapshot-clear');
  assert.deepEqual(result.blockers, []);
});

test('一次性委派的未关闭后代仍被递归检查', t => {
  const file = fixture(t, [catalog(childId, 'one-shot')], {
    [childId]: [catalog(grandchildId), ...completed], [grandchildId]: completed,
  });
  const result = auditSession(file, 34);
  assert.equal(result.status, 'blocked');
  assert.equal(result.agents.length, 2);
});

test('遗漏 catalog 的 Team 成员仍被检查', t => {
  const result = auditSession(fixture(t, [member('active')]), 34);
  assert.equal(result.agents.length, 1);
  assert.equal(result.status, 'blocked');
});

test('未知 closed 字段不能代替宿主正式关闭协议', t => {
  const result = auditSession(fixture(t, [catalog(), member('closed')]), 34);
  assert.equal(result.status, 'blocked');
});

test('未投递消息阻塞，已投递消息不再阻塞', t => {
  const queued = event('team/message/queued', { message: { id: 'message-1' } });
  const result = auditSession(fixture(t, [queued], {}), 34);
  assert.equal(result.status, 'blocked');
  const delivered = event('team/message/delivered', { messageId: 'message-1' });
  assert.equal(auditSession(fixture(t, [queued, delivered], {}), 34).status, 'snapshot-clear');
});

test('子会话缺失时核验失败而非默认通过', t => {
  assert.throws(() => auditSession(fixture(t, [catalog()], {}), 34), /ENOENT/);
});

test('拒绝路径穿越的子会话 ID', t => {
  assert.throws(() => auditSession(fixture(t, [catalog('../outside')], {}), 34), /ID 无效/);
});

test('损坏或缺失会话头的日志不可通过', () => {
  assert.throws(() => decodeLog(Buffer.from('{broken'), false));
  assert.throws(() => decodeLog(Buffer.from('{"type":"turn/end"}'), false), /完整/);
  assert.throws(() => decodeLog(Buffer.from('broken-zstd'), true));
});
