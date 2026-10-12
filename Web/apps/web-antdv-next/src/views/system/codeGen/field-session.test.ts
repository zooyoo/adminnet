import type { CodeGenField, CodeGenRow } from '#/api/system/codegen';

import { describe, expect, it, vi } from 'vitest';

import { cloneFields, copyCodeGenDraft, createCodeGenDraft, validateCodeGenDraft, validateCodeGenFields } from './codegen-model';
import { createFieldSession, createFieldState } from './field-session';

function field(id = 1, codeGenId = 10): CodeGenField {
	return { id, codeGenId, propertyName: 'Name', columnName: 'name', effectType: 'Input', queryType: 'like', orderNo: 100,
		whetherTable: 'Y', whetherAddUpdate: 'Y', whetherImport: 'N', whetherRequired: 'Y', whetherSortable: 'N', whetherQuery: 'Y', whetherRetract: 'N', fkDisplayColumnList: [] };
}
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => { resolve = done; });
	return { promise, resolve };
}
const boundary = () => ({ track: vi.fn(), release: vi.fn() });

describe('代码生成字段会话', () => {
	it('保存失败保留草稿并允许重试', async () => {
		const state = createFieldState();
		const server = field();
		const save = vi.fn().mockRejectedValueOnce(new Error('数据库不可达')).mockResolvedValueOnce(undefined);
		const load = vi.fn().mockImplementation(async () => [server]);
		const session = createFieldSession(state, { load, save }, boundary());
		await session.load(10);
		state.rows[0]!.columnComment = '新的说明';
		expect(await session.save()).toBe(false);
		expect(state.rows[0]?.columnComment).toBe('新的说明');
		expect(state.busy).toBe(false);
		expect(state.error).toContain('草稿已保留');
		expect(server.columnComment).toBeUndefined();
		expect(await session.save()).toBe(true);
		expect(save).toHaveBeenCalledTimes(2);
	});
	it('关闭后丢弃不响应取消的迟到加载', async () => {
		const state = createFieldState();
		const pending = deferred<CodeGenField[]>();
		let signal: AbortSignal | undefined;
		const session = createFieldSession(state, { load: (_id, current) => { signal = current; return pending.promise; }, save: vi.fn() }, boundary());
		const loading = session.load(10);
		session.close(); pending.resolve([field()]); await loading;
		expect(signal?.aborted).toBe(true);
		expect(state.rows).toEqual([]);
		expect(state.id).toBeUndefined();
	});
	it('切换记录时旧保存和重载不能覆盖新记录', async () => {
		const state = createFieldState();
		const saving = deferred<unknown>();
		const load = vi.fn().mockImplementation(async (id: number) => [field(id, id)]);
		const session = createFieldSession(state, { load, save: () => saving.promise }, boundary());
		await session.load(10);
		const pending = session.save();
		await session.load(20); saving.resolve(undefined); await pending;
		expect(state.id).toBe(20);
		expect(state.rows[0]?.codeGenId).toBe(20);
		expect(load).toHaveBeenCalledTimes(2);
	});
	it('保存成功但重载失败明确区分服务器已保存', async () => {
		const state = createFieldState();
		const load = vi.fn().mockResolvedValueOnce([field()]).mockRejectedValueOnce(new Error('连接中断'));
		const session = createFieldSession(state, { load, save: vi.fn().mockResolvedValue(undefined) }, boundary());
		await session.load(10); state.rows[0]!.orderNo = 230;
		expect(await session.save()).toBe(true);
		expect(state.error).toContain('字段已保存');
		expect(JSON.parse(state.baseline)[0].orderNo).toBe(230);
		expect(state.rows[0]?.orderNo).toBe(230);
	});
	it('身份或排序校验失败不会发送保存', async () => {
		const state = createFieldState();
		const save = vi.fn();
		const session = createFieldSession(state, { load: async () => [field()], save }, boundary());
		await session.load(10); state.rows.push(field(2, 11));
		expect(await session.save()).toBe(false);
		state.rows.pop(); state.rows[0]!.orderNo = -1;
		expect(await session.save()).toBe(false);
		expect(save).not.toHaveBeenCalled();
	});
	it('保存锁定快照并禁止同时重复提交', async () => {
		const state = createFieldState();
		const saving = deferred<unknown>();
		const save = vi.fn().mockReturnValue(saving.promise);
		const session = createFieldSession(state, { load: async () => [field()], save }, boundary());
		await session.load(10); state.rows[0]!.columnComment = '快照';
		const pending = session.save();
		state.rows[0]!.columnComment = '之后的变化';
		expect(await session.save()).toBe(false);
		expect(save.mock.calls[0]?.[0][0].columnComment).toBe('快照');
		saving.resolve(undefined); await pending;
		expect(save).toHaveBeenCalledOnce();
	});
});

describe('生成配置模型', () => {
	it('复制配置保留生成参数并清除记录和实体唯一约束', () => {
		const row: CodeGenRow = { id: 1, configId: '0', tableName: 'SysNotice', busName: '通知', nameSpace: 'Admin.NET.Application', pagePath: 'main', authorName: '开发者', generateType: '200', tableUniqueList: [{ columns: ['Title'], message: '不可重复' }] };
		const copy = copyCodeGenDraft(row);
		expect(copy).toMatchObject({ id: undefined, tableName: '', busName: '', tableUniqueList: [], configId: '0', authorName: '开发者', generateType: '200', pagePath: 'main' });
		expect(row).toMatchObject({ id: 1, tableName: 'SysNotice', tableUniqueList: [{ columns: ['Title'], message: '不可重复' }] });
		expect(validateCodeGenDraft(copy)).toContain('数据库和实体');
	});
	it('空历史标志按未勾选恢复且关联数组独立', () => {
		const original = { ...field(), whetherSortable: null, fkDisplayColumnList: ['Name'] };
		const copy = cloneFields([original]);
		copy[0]!.fkDisplayColumnList!.push('Code');
		expect(copy[0]?.whetherSortable).toBe('N');
		expect(original.fkDisplayColumnList).toEqual(['Name']);
	});
	it('唯一约束草稿深复制并按原配置校验', () => {
		const row: CodeGenRow = { id: 1, configId: '0', tableName: 'SysNotice', busName: '通知', nameSpace: 'Admin.NET.Application', tableUniqueList: [{ columns: ['Title'], message: '不可重复' }] };
		const draft = createCodeGenDraft(row);
		draft.tableUniqueList[0]!.columns!.push('Type');
		expect(row.tableUniqueList?.[0]?.columns).toEqual(['Title']);
		expect(validateCodeGenDraft(draft)).toBe('');
		draft.tableUniqueList[0]!.message = '';
		expect(validateCodeGenDraft(draft)).toContain('唯一约束');
	});
	it('树选择器必须完整配置关联与父级字段', () => {
		const tree = { ...field(), effectType: 'ApiTreeSelector', fkConfigId: '0', fkTableName: 'sysorg', fkEntityName: 'SysOrg', fkLinkColumnName: 'Id', fkDisplayColumnList: ['Name'] };
		expect(validateCodeGenFields([tree])).toContain('父级字段');
		expect(validateCodeGenFields([{ ...tree, pidColumn: 'Pid' }])).toBe('');
	});
});
