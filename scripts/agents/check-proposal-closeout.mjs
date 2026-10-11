import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { reconcileResults } from './closeout-review.mjs';
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

export function auditSession(sessionFile, nextProposal, hostInventory = undefined) {
  const snapshots = [];
  const blockers = [];
  const normalizeId = id => String(id).replace(/^session-/, '');
  if (hostInventory !== undefined && (!Array.isArray(hostInventory.rows) || !Array.isArray(hostInventory.archivedSessionIds) || !Number.isFinite(hostInventory.generatedAt) || Math.abs(Date.now() - hostInventory.generatedAt) > 60_000)) {
    throw new Error('宿主清单格式无效或超过 60 秒有效期');
  }
  const hostRows = new Map();
  for (const row of hostInventory?.rows ?? []) {
    const id = normalizeId(row.id);
    if (hostRows.has(id)) throw new Error('宿主清单存在重复会话 ID');
    hostRows.set(id, row);
  }
  const archivedIds = new Set((hostInventory?.archivedSessionIds ?? []).map(normalizeId));
  const hostCloseReceipt = (id, parentId) => {
    const row = hostRows.get(normalizeId(id));
    return archivedIds.has(normalizeId(id)) && row?.archived === true && row?.running === false && normalizeId(row.parentId) === normalizeId(parentId);
  };
  const agents = [];
  const visited = new Set();
  const sessionsRoot = path.dirname(path.dirname(sessionFile));
  const logName = path.basename(sessionFile);
  function load(file) {
    const before = fs.statSync(file);
    const bytes = fs.readFileSync(file);
    const rows = decodeLog(bytes, file.endsWith('.zstd'));
    snapshots.push({ file, size: before.size, mtimeMs: before.mtimeMs, digest: createHash('sha256').update(bytes).digest('hex') });
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
      const hostClosed = hostCloseReceipt(id, parentId);
      if (!hostClosed && (catalog.mode === 'continuable' || member)) {
        blockers.push({ code: 'NO_VERIFIABLE_CLOSE_RECEIPT', id });
      } else if (!hostClosed && catalog.mode !== 'one-shot') {
        blockers.push({ code: 'UNKNOWN_DELEGATION_MODE', id });
      }
      if (child.running || child.outcome !== 'completed') blockers.push({ code: 'UNSETTLED_RESULT', id, outcome: child.outcome });
      if (hostClosed) agents.at(-1).hostCloseReceipt = { archived: true, running: false };
      walk(childRows, id);
    }
  }
  walk(rootRows, rootRows[0].id);
  // 宿主可能记录了旧主日志 catalog 没有登记的侧会话，不能遗漏其后代。
  const knownIds = new Set([normalizeId(rootRows[0].id), ...agents.map(agent => normalizeId(agent.id))]);
  const hostOnlyAgents = [];
  let discovered = true;
  while (discovered) {
    discovered = false;
    for (const [id, row] of hostRows) {
      if (knownIds.has(id) || !knownIds.has(normalizeId(row.parentId))) continue;
      knownIds.add(id);
      discovered = true;
      const extra = { id: row.id, parentId: row.parentId, archived: row.archived === true, running: row.running ?? null };
      hostOnlyAgents.push(extra);
      // 仅自动识别直接从主会话继承、且新增操作仅为统计查询的侧会话。
      const validId = /^(session-)?[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.id);
      const extraFile = validId ? [row.id, id, `session-${id}`].map(name => path.join(sessionsRoot, name, logName)).find(file => fs.existsSync(file)) : undefined;
      let inheritedReadOnly = false;
      if (extraFile && normalizeId(row.parentId) === normalizeId(rootRows[0].id)) {
        const extraRows = load(extraFile);
        if (normalizeId(extraRows[0].id) !== id) throw new Error('侧会话头与目录 ID 不一致');
        const rootCalls = new Map(rootRows.filter(item => item.type === 'tool/call').map(item => [item.data.callId, JSON.stringify(item.data)]));
        const calls = extraRows.filter(item => item.type === 'tool/call');
        const ownCalls = calls.filter(item => rootCalls.get(item.data.callId) !== JSON.stringify(item.data));
        const rootCatalogs = new Set(rootRows.filter(item => ['subagent/catalog', 'team/member'].includes(item.type)).map(item => JSON.stringify(item.data)));
        const newDelegations = extraRows.filter(item => ['subagent/catalog', 'team/member'].includes(item.type) && !rootCatalogs.has(JSON.stringify(item.data)));
        const extraState = replay(extraRows);
        inheritedReadOnly = extraRows[0].isSeeded === true && normalizeId(extraRows[0].parentSession) === normalizeId(rootRows[0].id) && extraState.outcome === 'completed' && extraState.pending.size === 0 && newDelegations.length === 0 && ownCalls.every(item => item.data.name === 'ctx_stats') && hostCloseReceipt(row.id, row.parentId);
        extra.inheritedReadOnly = inheritedReadOnly;
        extra.ownToolNames = ownCalls.map(item => item.data.name);
      }
      if (!inheritedReadOnly) blockers.push({ code: 'HOST_CHILD_NOT_IN_LOG', id: row.id });
      if (!hostCloseReceipt(row.id, row.parentId)) blockers.push({ code: 'NO_VERIFIABLE_CLOSE_RECEIPT', id: row.id });
    }
  }
  for (const agent of agents) {
    const row = hostRows.get(normalizeId(agent.id));
    if (row?.running === true) blockers.push({ code: 'HOST_CHILD_RUNNING', id: agent.id });
  }
  for (const snapshot of snapshots) {
    const after = fs.statSync(snapshot.file);
    if (after.size !== snapshot.size || after.mtimeMs !== snapshot.mtimeMs) throw new Error('核验期间会话发生变化，请重新检查');
  }
  return {
    version: 1,
    checkedAt: new Date().toISOString(),
    sessionId: rootRows[0].id,
    lastSequence: rootRows.at(-1)?.seq ?? null,
    sourceDigest: createHash('sha256').update(JSON.stringify(snapshots.map(item => [path.basename(path.dirname(item.file)), item.digest]).sort((a, b) => a[0].localeCompare(b[0])))).digest('hex'),
    nextProposal,
    status: blockers.length ? 'blocked' : 'snapshot-clear',
    scope: hostInventory === undefined ? '仅生命周期日志快照；仍需业务验收与宿主实时关闭确认' : '生命周期日志与宿主归档、运行状态快照；不替代业务验收，不是原子调度锁',
    ...(hostInventory === undefined ? {} : { hostCheckedAt: new Date(hostInventory.generatedAt).toISOString(), hostOnlyAgents }),
    agents,
    blockers,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = process.argv.slice(2);
    if (![4, 6, 8].includes(args.length) || args[0] !== '--session-file' || args[2] !== '--next' || !/^[1-9]\d*$/.test(args[3]) || (args.length >= 6 && args[4] !== '--host-url') || (args.length === 8 && args[6] !== '--review-file')) {
      throw new Error('用法：node check-proposal-closeout.mjs --session-file <完整主会话日志> --next <下一编号> [--host-url <本机 DSH 地址> [--review-file <业务处置 JSON>]]');
    }
    let hostInventory;
    if (args.length >= 6) {
      const base = new URL(args[5]);
      if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password || base.search || base.hash || base.pathname !== '/') throw new Error('只接受本机 DSH HTTP 根地址');
      const response = await fetch(new URL('/api/dsh-session-archive/inventory', base), { redirect: 'error', signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`宿主清单读取失败 HTTP ${response.status}`);
      hostInventory = await response.json();
    }
    let result = auditSession(path.resolve(args[1]), Number(args[3]), hostInventory);
    if (args.length === 8) result = reconcileResults(result, JSON.parse(fs.readFileSync(path.resolve(args[7]), 'utf8').replace(/^\uFEFF/, '')));
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.status === 'blocked' ? 2 : 0;
  } catch (error) {
    // 不输出原始日志或 JSON 解析错误片段，以免带出消息内容。
    const message = error instanceof SyntaxError ? '会话日志不完整或格式无效' : error.message;
    console.log(JSON.stringify({ status: 'unverifiable', message }));
    process.exitCode = 1;
  }
}
