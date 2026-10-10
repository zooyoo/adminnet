import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { pathToFileURL } from 'node:url';

// 只读回放宿主事件；不修改会话，也不把回合结束当作可续聊成员关闭。
export function decodeLog(buffer, compressed) {
  const parts = [];
  if (compressed) {
    let offset = 0;
    while (offset < buffer.length) {
      const decoded = zlib.zstdDecompressSync(buffer.subarray(offset), { info: true });
      if (!decoded.engine.bytesWritten) throw new Error('会话解码未前进');
      offset += decoded.engine.bytesWritten;
      parts.push(decoded.buffer);
    }
  } else {
    parts.push(buffer);
  }
  const rows = Buffer.concat(parts).toString('utf8').trim().split(/\r?\n/).map(line => JSON.parse(line));
  if (rows[0]?.type !== 'session' || rows[0].version !== 4 || !rows[0].id) {
    throw new Error('需要完整的 DSH v4 会话日志');
  }
  return rows;
}

export function replay(rows) {
  const members = new Map();
  const children = new Map();
  const pending = new Set();
  let start = -1;
  let end = -1;
  let outcome = null;
  for (const [index, row] of rows.entries()) {
    const data = row.data;
    if (row.type === 'subagent/catalog') children.set(data.childId, data);
    if (row.type === 'team/member') {
      members.set(data.member.id, data.member);
      if (!children.has(data.member.id)) children.set(data.member.id, { childId: data.member.id, mode: 'continuable' });
    }
    if (row.type === 'team/message/queued') pending.add(data.message.id);
    if (row.type === 'team/message/delivered') pending.delete(data.messageId);
    if (row.type === 'turn/start') start = index;
    if (row.type === 'turn/end') {
      end = index;
      outcome = data.reason?.kind ?? 'unknown';
    }
  }
  return { members, children, pending, running: start > end, outcome: start > end ? 'running' : outcome };
}

export function auditSession(sessionFile, nextProposal) {
  const snapshots = [];
  const blockers = [];
  const agents = [];
  const visited = new Set();
  const sessionsRoot = path.dirname(path.dirname(sessionFile));
  const logName = path.basename(sessionFile);
  function load(file) {
    const before = fs.statSync(file);
    const rows = decodeLog(fs.readFileSync(file), file.endsWith('.zstd'));
    snapshots.push({ file, size: before.size, mtimeMs: before.mtimeMs });
    return rows;
  }
  const rootRows = load(sessionFile);
  function walk(rows, parentId) {
    const state = replay(rows);
    if (state.pending.size) blockers.push({ code: 'PENDING_MESSAGES', sessionId: parentId, count: state.pending.size });
    for (const [id, catalog] of state.children) {
      // 宿主使用 UUID；拒绝通过日志中的异常 ID 读取其他路径。
      if (!/^(session-)?[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) || visited.has(id)) {
        throw new Error('子会话 ID 无效或存在重复归属');
      }
      visited.add(id);
      const childRows = load(path.join(sessionsRoot, id, logName));
      if (childRows[0].id !== id) throw new Error('子会话头与目录 ID 不一致');
      const child = replay(childRows);
      const member = state.members.get(id);
      agents.push({ id, parentId, name: member?.name ?? null, mode: catalog.mode, phase: member?.phase ?? null, outcome: child.outcome });
      if (catalog.mode === 'continuable' || member) {
        blockers.push({ code: 'NO_VERIFIABLE_CLOSE_RECEIPT', id });
      } else if (catalog.mode !== 'one-shot') {
        blockers.push({ code: 'UNKNOWN_DELEGATION_MODE', id });
      }
      if (child.running || child.outcome !== 'completed') blockers.push({ code: 'UNSETTLED_RESULT', id, outcome: child.outcome });
      walk(childRows, id);
    }
  }
  walk(rootRows, rootRows[0].id);
  for (const snapshot of snapshots) {
    const after = fs.statSync(snapshot.file);
    if (after.size !== snapshot.size || after.mtimeMs !== snapshot.mtimeMs) throw new Error('核验期间会话发生变化，请重新检查');
  }
  return {
    version: 1,
    checkedAt: new Date().toISOString(),
    sessionId: rootRows[0].id,
    lastSequence: rootRows.at(-1)?.seq ?? null,
    nextProposal,
    status: blockers.length ? 'blocked' : 'snapshot-clear',
    scope: '仅生命周期日志快照；仍需业务验收与宿主实时关闭确认',
    agents,
    blockers,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (args.length !== 4 || args[0] !== '--session-file' || args[2] !== '--next' || !/^[1-9]\d*$/.test(args[3])) {
      throw new Error('用法：node check-proposal-closeout.mjs --session-file <完整主会话日志> --next <下一编号>');
    }
    const result = auditSession(path.resolve(args[1]), Number(args[3]));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === 'blocked' ? 2 : 0;
  } catch (error) {
    // 不输出原始日志或 JSON 解析错误片段，以免带出消息内容。
    const message = error instanceof SyntaxError ? '会话日志不完整或格式无效' : error.message;
    console.log(JSON.stringify({ status: 'unverifiable', message }));
    process.exitCode = 1;
  }
}
