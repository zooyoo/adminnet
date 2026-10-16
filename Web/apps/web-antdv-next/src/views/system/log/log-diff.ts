export function diffText(value: unknown): string {
	if (value === null || value === undefined) return '';
	if (typeof value === 'object') return JSON.stringify(value) ?? '';
	return String(value);
}
export type DiffChunk = { text: string; changed: boolean };
export function diffChunks(before: unknown, after: unknown, oldSide: boolean): DiffChunk[] {
	const newText = diffText(after);
	const oldText = diffText(before);
	if (typeof before !== 'string' || typeof after !== 'string') return [{ text: oldSide ? oldText : newText, changed: oldText !== newText }];
	if (oldText === newText) return [{ text: oldText, changed: false }];
	// 超大字段保留全文并标出变更，避免明细显示分配无界的二维矩阵。
	if (oldText.length * newText.length > 2_000_000) return [{ text: oldSide ? oldText : newText, changed: true }];
	const dp = Array.from({ length: oldText.length + 1 }, () => new Uint32Array(newText.length + 1));
	for (let i = 1; i <= oldText.length; i++) for (let j = 1; j <= newText.length; j++) dp[i]![j] = oldText[i - 1] === newText[j - 1] ? dp[i - 1]![j - 1]! + 1 : Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
	let i = oldText.length;
	let j = newText.length;
	const result: DiffChunk[] = [];
	while (i > 0 || j > 0) {
		if (i > 0 && j > 0 && oldText[i - 1] === newText[j - 1]) {
			result.push({ text: oldText[--i]!, changed: false });
			j--;
		} else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
			j--;
			if (!oldSide) result.push({ text: newText[j]!, changed: true });
		} else {
			i--;
			if (oldSide) result.push({ text: oldText[i]!, changed: true });
		}
	}
	return result.reverse().reduce<DiffChunk[]>((chunks, chunk) => {
		const last = chunks.at(-1);
		if (last?.changed === chunk.changed) last.text += chunk.text;
		else chunks.push({ ...chunk });
		return chunks;
	}, []);
}
export function formatDiffSql(value: unknown) {
	return String(value ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/\b(SET|VALUES)\s+/gi, '$1\n    ')
		.replace(/,\s*/g, ',\n    ')
		.replace(/\s+(WHERE)\b/gi, '\n$1');
}
