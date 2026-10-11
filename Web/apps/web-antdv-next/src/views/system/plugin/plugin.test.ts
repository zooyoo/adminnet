import type { PluginRow } from '#/api/system/plugin';

import { describe, expect, it } from 'vitest';

import { createPluginDraft, pluginPayload, validatePluginDraft } from './plugin';

const row: PluginRow = {
	id: '9223372036854775806',
	tenantId: '42',
	name: '测试插件',
	csharpCode: '  // 中文代码\r\npublic class Probe {}\r\n',
	assemblyName: 'Probe',
	orderNo: 0,
	status: 2,
	remark: null,
	createUserName: '创建人',
	updateUserName: '更新人',
};

describe('插件草稿合同', () => {
	it('编辑时原文回填、保留字符串主键和租户，不携带审计字段', () => {
		const draft = createPluginDraft(row, '99');
		expect(draft.csharpCode).toBe(row.csharpCode);
		expect(draft.id).toBe(row.id);
		expect(draft.tenantId).toBe('42');
		expect(draft.orderNo).toBe(0);
		expect(draft.status).toBe(2);
		expect(draft).not.toHaveProperty('createUserName');
		expect(draft).not.toHaveProperty('updateUserName');
	});

	it('取消后编辑其他记录和新增不会复用旧代码', () => {
		const draft = createPluginDraft(row);
		draft.csharpCode = '未保存修改';
		expect(createPluginDraft(row).csharpCode).toBe(row.csharpCode);
		expect(createPluginDraft(undefined, '7')).toMatchObject({ name: '', csharpCode: '', orderNo: 100, status: 1, tenantId: '7' });
	});

	it('保存仅规范化名称，代码原文与备注保留', () => {
		const draft = createPluginDraft(row);
		draft.name = '  新名称  ';
		draft.assemblyName = '  Probe  ';
		const payload = pluginPayload({ ...draft, createUserName: '伪造' } as typeof draft);
		expect(payload).toMatchObject({ name: '新名称', assemblyName: 'Probe', csharpCode: row.csharpCode, remark: '' });
		expect(payload).not.toHaveProperty('createUserName');
	});

	it('短而有效的 C# 代码不受旧界面 100 字符限制', () => {
		const draft = createPluginDraft(row);
		draft.csharpCode = 'public class A {}';
		expect(validatePluginDraft(draft)).toEqual({});
	});

	it.each([Number.NaN, Number.POSITIVE_INFINITY, 1.5, 2_147_483_648, -2_147_483_649])('拒绝无效排序 %s', (orderNo) => {
		expect(validatePluginDraft({ ...createPluginDraft(row), orderNo })).toHaveProperty('orderNo');
	});

	it('明确反馈必填和长度边界', () => {
		const draft = createPluginDraft(row);
		draft.name = ' ';
		draft.csharpCode = '\r\n ';
		draft.assemblyName = 'a'.repeat(513);
		draft.remark = 'a'.repeat(129);
		expect(Object.keys(validatePluginDraft(draft)).sort()).toEqual(['assemblyName', 'csharpCode', 'name', 'remark']);
	});
});
