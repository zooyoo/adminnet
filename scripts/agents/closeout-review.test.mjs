import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { reconcileResults } from './closeout-review.mjs';

function fixture(t, outcome = 'error') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'closeout-review-'));
  t.after(() => {
    assert.match(path.basename(dir), /^closeout-review-/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const file = path.join(dir, 'report.json');
  fs.writeFileSync(file, JSON.stringify({ passed: true, cleanupPassed: true, cleanupErrors: [] }), 'utf8');
  const evidence = { file, kind: 'acceptance-report', sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
  const audit = { sessionId: 'root', nextProposal: 34, sourceDigest: 'digest', hostCheckedAt: new Date().toISOString(), agents: [{ id: 'child', outcome, hostCloseReceipt: { archived: true, running: false } }], blockers: [{ id: 'child', code: 'UNSETTLED_RESULT', outcome }] };
  const review = { version: 1, sessionId: 'root', nextProposal: 34, sourceDigest: 'digest', entries: [{ id: 'child', outcome, proposal: 29, resolution: 'superseded-by-delivery', reason: '主会话已接手，原委派仍保留失败', evidence: [evidence] }] };
  return { audit, review, file };
}

test('接手证据可收束业务失败但保留原始 outcome', t => {
  const { audit, review } = fixture(t);
  const result = reconcileResults(audit, review);
  assert.equal(result.status, 'reviewed-clear');
  assert.equal(result.agents[0].outcome, 'error');
  assert.equal(result.reviewedResults[0].originalOutcome, 'error');
});

test('当前提案中止只恢复当前工作，不宣布完成', t => {
  const { audit, review } = fixture(t, 'aborted');
  Object.assign(review.entries[0], { proposal: 34, resolution: 'resume-current-proposal' });
  review.entries[0].evidence[0].kind = 'review-note';
  assert.equal(reconcileResults(audit, review).status, 'reviewed-clear');
  review.entries[0].proposal = 35;
  assert.throws(() => reconcileResults(audit, review), /当前提案/);
});

for (const field of ['sessionId', 'nextProposal', 'sourceDigest']) {
  test(`${field} 不匹配则拒绝历史处置`, t => {
    const { audit, review } = fixture(t);
    review[field] = 'mismatch';
    assert.throws(() => reconcileResults(audit, review), /不匹配/);
  });
}

test('业务处置不能替代实时宿主归档核验', t => {
  const { audit, review } = fixture(t);
  delete audit.agents[0].hostCloseReceipt;
  assert.throws(() => reconcileResults(audit, review), /归档/);
});

test('业务处置不能消除运行和消息阻塞', t => {
  const { audit, review } = fixture(t);
  audit.blockers.push({ code: 'PENDING_MESSAGES', count: 1 }, { code: 'HOST_CHILD_RUNNING', id: 'child' });
  const result = reconcileResults(audit, review);
  assert.equal(result.status, 'blocked');
  assert.equal(result.blockers.length, 2);
});

test('证据被修改或验收失败均拒绝', t => {
  const { audit, review, file } = fixture(t);
  fs.writeFileSync(file, JSON.stringify({ passed: false, cleanupPassed: true, cleanupErrors: [] }), 'utf8');
  assert.throws(() => reconcileResults(audit, review), /摘要/);
  review.entries[0].evidence[0].sha256 = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  assert.throws(() => reconcileResults(audit, review), /未通过/);
});

test('仅笔记不能证明后续成功交付', t => {
  const { audit, review } = fixture(t);
  review.entries[0].evidence[0].kind = 'review-note';
  assert.throws(() => reconcileResults(audit, review), /验收报告/);
});

test('重复处置和错误 outcome 均拒绝', t => {
  const { audit, review } = fixture(t);
  review.entries.push(review.entries[0]);
  assert.throws(() => reconcileResults(audit, review), /重复/);
  review.entries.pop();
  review.entries[0].outcome = 'completed';
  assert.throws(() => reconcileResults(audit, review), /有效证据/);
});
