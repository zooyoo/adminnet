import { describe, expect, it } from 'vitest';

import { diffChunks, formatDiffSql } from '../log/log-diff';
import { columnDraft, fieldTemplates, moveDraftFields, updateColumnType, validateColumns } from './database-form';
describe('旧字段模板的 PostgreSQL 输入合同', () => {
	it('首尾字段循环交换保持旧顺序且不改变原输入数组', () => {
		const fields = ['first', 'middle', 'last'];
		const up = moveDraftFields(fields, 0, -1);
		expect(up).toEqual(['last', 'middle', 'first']);
		expect(fields).toEqual(['first', 'middle', 'last']);
		expect(moveDraftFields(up, 2, 1)).toEqual(fields);
		expect(moveDraftFields(['only'], 0, -1)).toEqual(['only']);
	});

	it('租户/机构/基础/软删除字段保名称、顺序、可空和长度', () => {
		const types = ['bigint', 'varchar', 'timestamp', 'boolean'];
		const fields = ['tenant', 'org', 'base', 'delete'].flatMap((kind) => fieldTemplates(kind as 'base' | 'delete' | 'org' | 'tenant', types));
		expect(fields.map((field) => field.dbColumnName)).toEqual(['TenantId', 'OrgId', 'CreateTime', 'UpdateTime', 'CreateUserId', 'CreateUserName', 'UpdateUserId', 'UpdateUserName', 'IsDelete']);
		expect(fields.filter((field) => field.dbColumnName.endsWith('UserName')).map((field) => field.length)).toEqual([64, 64]);
		expect(fields.slice(0, 8).every((field) => field.isNullable === 1)).toBe(true);
		expect(fields.at(-1)).toMatchObject({ isNullable: 0, dataType: 'boolean' });
		expect(() => validateColumns(fields, types)).not.toThrow();
	});
	it('普通字段初可空，文本从空长度切换为32，其它类型清零', () => {
		const draft = columnDraft();
		expect(draft).toMatchObject({ dataType: '', length: 0, isNullable: 1 });
		draft.dataType = 'varchar';
		updateColumnType(draft);
		expect(draft.length).toBe(32);
		draft.length = 64;
		updateColumnType(draft);
		expect(draft.length).toBe(64);
		draft.dataType = 'bigint';
		updateColumnType(draft);
		expect(draft.length).toBe(0);
	});
});
describe('差异明细保持完整的安全文本', () => {
	it('对象和数组按JSON安全文本显示，数据库空对象不变成实现字符串', () => {
		expect(diffChunks({}, '2026-10-13', true)).toEqual([{ text: '{}', changed: true }]);
		const before = { tag: '<img src=x onerror=alert(1)>', safe: 2 };
		expect(diffChunks(before, { tag: 'changed', safe: 2 }, true)).toEqual([{ text: JSON.stringify(before), changed: true }]);
		expect(diffChunks([1, null, 'x'], [2, null, 'x'], false)[0]!.text).toBe('[2,null,"x"]');
	});

	it('LCS 保留同字符并在前后各自标差异，不返回HTML', () => {
		expect(diffChunks('abcXdef', 'abcYdef', true)).toEqual([
			{ text: 'abc', changed: false },
			{ text: 'X', changed: true },
			{ text: 'def', changed: false },
		]);
		expect(diffChunks('abcXdef', 'abcYdef', false)).toEqual([
			{ text: 'abc', changed: false },
			{ text: 'Y', changed: true },
			{ text: 'def', changed: false },
		]);
		expect(
			diffChunks('<script>x</script>', '<script>y</script>', false)
				.map((chunk) => chunk.text)
				.join('')
		).toBe('<script>y</script>');
	});
	it('SQL仅文本排版，空/数值保原值，超长不截断', () => {
		expect(formatDiffSql('UPDATE x SET a=@a,b=@b WHERE id=@id')).toContain('\nWHERE');
		expect(diffChunks(null, 2, false)).toEqual([{ text: '2', changed: true }]);
		const text = 'x'.repeat(3000);
		expect(diffChunks(text, 'y'.repeat(3000), true)[0]!.text).toHaveLength(3000);
	});
});
