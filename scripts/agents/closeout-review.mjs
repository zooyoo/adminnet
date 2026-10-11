import fs from 'node:fs';
import { createHash } from 'node:crypto';

// 这里只核验人工业务处置的证据绑定；宿主归档、运行和消息阻塞不可豁免。
export function reconcileResults(audit, review) {
  if (!audit.hostCheckedAt || review.version !== 1 || review.sessionId !== audit.sessionId || review.nextProposal !== audit.nextProposal || review.sourceDigest !== audit.sourceDigest || !Array.isArray(review.entries)) {
    throw new Error('业务处置与当前会话、编号或日志摘要不匹配');
  }
  const ids = new Set();
  const reviewedResults = [];
  for (const entry of review.entries) {
    if (ids.has(entry.id)) throw new Error('业务处置存在重复 ID');
    ids.add(entry.id);
    const agent = audit.agents.find(item => item.id === entry.id);
    if (!agent?.hostCloseReceipt || !['error', 'aborted'].includes(agent.outcome) || entry.outcome !== agent.outcome || !Number.isInteger(entry.proposal) || entry.proposal < 1 || !entry.reason?.trim() || !Array.isArray(entry.evidence) || entry.evidence.length === 0) {
      throw new Error('业务处置缺少已停止归档记录或有效证据');
    }
    let acceptedReport = false;
    for (const evidence of entry.evidence) {
      const bytes = fs.readFileSync(evidence.file);
      if (createHash('sha256').update(bytes).digest('hex') !== evidence.sha256) throw new Error('业务处置证据摘要已变化');
      if (evidence.kind === 'acceptance-report') {
        const report = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
        if (report.passed !== true || report.cleanupPassed !== true || !Array.isArray(report.cleanupErrors) || report.cleanupErrors.length !== 0) throw new Error('业务验收或清理报告未通过');
        acceptedReport = true;
      } else if (evidence.kind !== 'review-note') {
        throw new Error('未知业务处置证据类型');
      }
    }
    if (entry.resolution === 'superseded-by-delivery') {
      if (entry.proposal >= audit.nextProposal || !acceptedReport) throw new Error('接手交付必须有先前提案的验收报告');
    } else if (entry.resolution === 'resume-current-proposal') {
      if (agent.outcome !== 'aborted' || entry.proposal !== audit.nextProposal) throw new Error('中止工作只能恢复当前提案');
    } else {
      throw new Error('未知业务处置结论');
    }
    reviewedResults.push({ id: entry.id, originalOutcome: agent.outcome, proposal: entry.proposal, resolution: entry.resolution, reason: entry.reason });
  }
  const blockers = audit.blockers.filter(item => item.code !== 'UNSETTLED_RESULT' || !ids.has(item.id));
  return { ...audit, status: blockers.length ? 'blocked' : 'reviewed-clear', reviewedResults, blockers };
}
