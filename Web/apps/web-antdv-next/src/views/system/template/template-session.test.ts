import type { AxiosRequestConfig } from 'axios';

import type { TemplateApi, TemplatePage, TemplateRow } from '#/api/system/template';

import { describe, expect, it, vi } from 'vitest';

import { requestClient } from '../../../api/request';
import { templateApi } from '../../../api/system/template';
import {
	createTemplateSession,
	createTemplateState,
	mergeTemplateParameters,
	newTemplateDraft,
	TEMPLATE_TYPES,
	templateParameterData,
	templateParameterKeys,
	validateTemplateDraft,
	validateTemplateParameters,
} from './template-session';

vi.mock('../../../api/request', async () => {
	const { default: axios } = await import('axios');
	const instance = axios.create({ headers: { 'Content-Type': 'application/json;charset=utf-8' } });
	return {
		requestClient: {
			instance,
			post: async (url: string, data: unknown, config?: AxiosRequestConfig) => (await instance.post<string>(url, data, config)).data,
		},
	};
});

const row: TemplateRow = {
	id: '71',
	name: '入职通知',
	code: 'welcome',
	groupName: '业务',
	type: 1,
	content: '  <p>欢迎 @(name) 😀</p>\r\n@(name)\r\n',
	orderNo: 100,
	remark: '原备注',
	tenantId: '1',
	updateTime: '旧时间',
};
const permissions = () => ({ page: true, add: true, update: true, delete: true, preview: true });
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}
function setup() {
	let identity = '777:1:1:alice';
	let grants = permissions();
	let tenantId: number | string = '1';
	const tracked = new Set<AbortController>();
	const boundary = { version: 0, track: (controller: AbortController) => tracked.add(controller), release: (controller: AbortController) => tracked.delete(controller) };
	const api = {
		page: vi.fn<TemplateApi['page']>().mockResolvedValue({ items: [{ ...row }], total: 1 }),
		groups: vi.fn<TemplateApi['groups']>().mockResolvedValue(['业务']),
		add: vi.fn<TemplateApi['add']>().mockResolvedValue(undefined),
		update: vi.fn<TemplateApi['update']>().mockResolvedValue(undefined),
		delete: vi.fn<TemplateApi['delete']>().mockResolvedValue(undefined),
		render: vi.fn<TemplateApi['render']>().mockResolvedValue('<p>欢迎 小王</p>'),
	};
	const state = createTemplateState();
	const notify = vi.fn();
	const session = createTemplateSession(state, { api, boundary, identity: () => identity, permissions: () => grants, tenantId: () => tenantId, notify });
	return {
		state,
		api,
		session,
		tracked,
		boundary,
		notify,
		identity: (value: string) => {
			identity = value;
		},
		tenant: (value: number | string) => {
			tenantId = value;
		},
		permissions: (value: typeof grants) => {
			grants = value;
		},
	};
}
async function activate(env: ReturnType<typeof setup>) {
	env.session.activate();
	await vi.waitFor(() => expect(env.state.pageBusy || env.state.groupsBusy).toBe(false));
}

describe('模板原文、类型和参数合同', () => {
	it('保留历史类型编号与新增默认值，本地内容方式不进入 DTO', () => {
		expect(TEMPLATE_TYPES.map(({ value }) => value)).toEqual([1, 2, 3, 4, 7]);
		expect(newTemplateDraft('tenant-1')).toEqual({ name: '', code: '', groupName: '', type: 1, content: '', orderNo: 100, remark: '', tenantId: 'tenant-1' });
		expect(validateTemplateDraft(Object.assign({ ...row, remark: '' }, { type: 6 }))).toBe('请选择有效的模板类型。');
	});
	it('遵循旧正则、唯一键、旧值和手动参数保留，不执行键内容', () => {
		const content = '@(name) @(name) @(city) @( spaced ) @\n(line) @(a\nb)';
		expect(templateParameterKeys(content)).toEqual(['name', 'city', ' spaced ']);
		const result = mergeTemplateParameters(content, [
			{ id: 7, key: 'name', value: '张三' },
			{ id: 8, key: 'manual', value: '保留' },
		]);
		expect(result).toEqual([
			{ id: 7, key: 'name', value: '张三' },
			{ id: 8, key: 'manual', value: '保留' },
			{ id: 9, key: 'city', value: '参数3' },
			{ id: 10, key: ' spaced ', value: '参数4' },
		]);
		expect(validateTemplateParameters([...result, { id: 11, key: 'name', value: '' }])).toBe('预览参数名不能重复。');
		expect(validateTemplateParameters([{ id: 1, key: ' ', value: 'x' }])).toBe('请填写预览参数名。');
	});
	it('使用安全普通对象保存原始键及字符串值，包括 __proto__', () => {
		const data = templateParameterData([
			{ id: 1, key: '__proto__', value: '原键' },
			{ id: 2, key: 'Model.name', value: '😀\r\n  ' },
		]);
		expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
		expect(Object.hasOwn(data, '__proto__')).toBe(true);
		expect(JSON.parse(JSON.stringify(data))).toEqual({ ['__proto__']: '原键', 'Model.name': '😀\r\n  ' });
		expect({}.toString()).toBe('[object Object]');
	});
	it.each([
		['name', 129],
		['code', 129],
		['groupName', 33],
		['remark', 129],
	] as const)('验证字段 %s 长度，不修改内容', (field, length) => {
		const draft = { ...row, remark: '', [field]: '字'.repeat(length) };
		expect(validateTemplateDraft(draft)).toContain('不能超过');
		expect(draft.content).toBe(row.content);
	});
});

describe('模板会话与独立权限', () => {
	it('默认分页 20，分组和四种筛选包含类型与租户', async () => {
		const env = setup();
		await activate(env);
		expect(env.api.page).toHaveBeenLastCalledWith({ name: '', code: '', groupName: '', type: undefined, page: 1, pageSize: 20, tenantId: '1' }, expect.any(AbortSignal));
		expect(env.state.groups).toEqual(['业务']);
		env.state.query = { name: '通知', code: 'wel', groupName: '业', type: 7 };
		env.session.query();
		await vi.waitFor(() => expect(env.state.pageBusy).toBe(false));
		expect(env.api.page.mock.calls.at(-1)?.[0]).toMatchObject({ name: '通知', code: 'wel', groupName: '业', type: 7, page: 1 });
		env.session.changePage(2, 20);
		expect(env.api.page.mock.calls.at(-1)?.[0]).toMatchObject({ page: 2, pageSize: 20 });
		env.session.changePage(2, 50);
		expect(env.api.page.mock.calls.at(-1)?.[0]).toMatchObject({ page: 1, pageSize: 50 });
		env.session.dispose();
	});
	it('缺少 page 时不请求列表或分组，也不能写入或渲染', async () => {
		const env = setup();
		env.permissions({ ...permissions(), page: false });
		env.session.activate();
		env.session.openAdd();
		env.session.openEdit(row);
		env.session.openPreview(row);
		await env.session.refresh();
		await env.session.save();
		await env.session.render();
		expect(env.api.page).not.toHaveBeenCalled();
		expect(env.api.groups).not.toHaveBeenCalled();
		expect(env.api.add).not.toHaveBeenCalled();
		expect(env.api.render).not.toHaveBeenCalled();
	});
	it('普通 preview 角色能预览且无保存权限', async () => {
		const env = setup();
		env.permissions({ page: true, add: false, update: false, delete: false, preview: true });
		await activate(env);
		env.session.openAdd();
		expect(env.state.editorOpen).toBe(false);
		env.session.openEdit(row);
		expect(env.state.editorOpen).toBe(false);
		env.session.requestDelete(row);
		expect(env.state.deleteTarget).toBeUndefined();
		env.session.openPreview(row);
		expect(env.state.editorOpen).toBe(true);
		await env.session.save();
		expect(env.api.update).not.toHaveBeenCalled();
		await env.session.render();
		expect(env.state.rendered).toBe('<p>欢迎 小王</p>');
		env.session.dispose();
	});
	it('add/update/delete/preview 独立，撤销任意权限即清数据', async () => {
		for (const action of ['add', 'update', 'delete', 'preview'] as const) {
			const env = setup();
			await activate(env);
			env.session.openEdit(row);
			env.permissions({ ...permissions(), [action]: false });
			env.session.contextChanged(true);
			expect(env.state.draft.content).toBe('');
			expect(env.state.parameters).toEqual([]);
			expect(env.state.editorOpen).toBe(false);
			await vi.waitFor(() => expect(env.state.pageBusy).toBe(false));
			env.session.dispose();
		}
	});
	it('保存原文及扩展字段，富纯切换后无改保存不写入本地方式', async () => {
		const env = setup();
		await activate(env);
		env.session.openEdit(row);
		env.state.contentType = 2;
		env.state.contentType = 1;
		await env.session.save();
		const payload = env.api.update.mock.calls[0]?.[0];
		expect(payload).toEqual(row);
		expect(payload?.content).toBe(row.content);
		expect(payload).not.toHaveProperty('contentType');
		expect(env.api.groups).toHaveBeenCalledTimes(2);
		env.session.dispose();
	});
	it('保存失败留全部内容和参数，防并发后可以重试', async () => {
		const env = setup();
		await activate(env);
		env.session.openEdit(row);
		env.state.parameters[0]!.value = '保存的参数';
		const hold = deferred<unknown>();
		env.api.update.mockReturnValueOnce(hold.promise);
		const saving = env.session.save();
		await env.session.save();
		expect(env.api.update).toHaveBeenCalledTimes(1);
		expect(env.state.saveBusy).toBe(true);
		hold.reject(new Error('重复编码'));
		await saving;
		expect(env.state.saveBusy).toBe(false);
		expect(env.state.editorOpen).toBe(true);
		expect(env.state.draft.content).toBe(row.content);
		expect(env.state.parameters[0]?.value).toBe('保存的参数');
		expect(env.state.editorError).toContain('保存失败');
		await env.session.save();
		expect(env.api.update).toHaveBeenCalledTimes(2);
		expect(env.state.editorOpen).toBe(false);
		env.session.dispose();
	});
	it('渲染使用原文和安全参数对象，错误后保留所有字段并恢复', async () => {
		const env = setup();
		await activate(env);
		env.session.openEdit(row);
		env.state.parameters[0]!.value = '小王😀\r\n';
		env.api.render.mockRejectedValueOnce(new Error('Razor 语法错误'));
		await env.session.render();
		expect(env.state.renderBusy).toBe(false);
		expect(env.state.renderError).toContain('原文和参数已保留');
		expect(env.state.draft.content).toBe(row.content);
		expect(env.state.parameters[0]?.value).toBe('小王😀\r\n');
		await env.session.render();
		expect(env.state.rendered).toBe('<p>欢迎 小王</p>');
		expect(env.state.renderError).toBe('');
		expect(env.api.render.mock.calls.at(-1)?.[0]).toEqual({ content: row.content, data: { name: '小王😀\r\n' } });
		env.session.dispose();
	});
	it('渲染防重并且关闭对话框 abort 后拒绝迟到', async () => {
		const env = setup();
		await activate(env);
		env.session.openEdit(row);
		const hold = deferred<string>();
		env.api.render.mockReturnValueOnce(hold.promise);
		const rendering = env.session.render();
		await env.session.render();
		expect(env.api.render).toHaveBeenCalledTimes(1);
		env.session.closeEditor();
		expect(env.api.render.mock.calls[0]?.[1].aborted).toBe(true);
		hold.resolve('迟到敏感结果');
		await rendering;
		expect(env.state.rendered).toBeUndefined();
		expect(env.state.renderBusy).toBe(false);
		env.session.dispose();
	});
	it('删除取消无请求、失败可重试、成功刷新分组', async () => {
		const env = setup();
		await activate(env);
		env.session.requestDelete(row);
		env.session.cancelDelete();
		await env.session.confirmDelete();
		expect(env.api.delete).not.toHaveBeenCalled();
		env.session.requestDelete(row);
		env.api.delete.mockRejectedValueOnce(new Error('暂时失败'));
		await env.session.confirmDelete();
		expect(env.state.deleteTarget?.id).toBe(row.id);
		expect(env.state.deleteBusy).toBe(false);
		await env.session.confirmDelete();
		expect(env.api.delete).toHaveBeenCalledTimes(2);
		expect(env.state.deleteTarget).toBeUndefined();
		expect(env.api.groups).toHaveBeenCalledTimes(2);
		env.session.dispose();
	});
	it('列表同类新请求取消旧请求并拒迟到旧页', async () => {
		const env = setup();
		await activate(env);
		const first = deferred<TemplatePage>();
		const second = deferred<TemplatePage>();
		env.api.page.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
		const oldRequest = env.session.loadPage();
		const newRequest = env.session.loadPage();
		expect(env.api.page.mock.calls.at(-2)?.[1].aborted).toBe(true);
		second.resolve({ items: [{ ...row, id: 80 }], total: 1 });
		await newRequest;
		first.resolve({ items: [{ ...row, id: 90 }], total: 1 });
		await oldRequest;
		expect(env.state.items[0]?.id).toBe(80);
		expect(env.state.pageBusy).toBe(false);
		env.session.dispose();
	});
	it.each(['deactivate', 'dispose', 'boundary', 'tenant', 'identity'] as const)('%s 边界取消所有操作并清理草稿与迟到结果', async (change) => {
		const env = setup();
		await activate(env);
		env.session.openEdit(row);
		const hold = deferred<string>();
		env.api.render.mockReturnValueOnce(hold.promise);
		const pending = env.session.render();
		const signal = env.api.render.mock.calls[0]![1];
		if (change === 'boundary') {
			env.boundary.version++;
			for (const controller of [...env.tracked]) controller.abort();
		} else if (change === 'tenant') {
			env.tenant('2');
			env.identity('777:2:2:alice');
			env.session.contextChanged(false);
		} else if (change === 'identity') {
			env.identity('777:1:1:bob');
			env.session.contextChanged(false);
		} else env.session[change]();
		expect(signal.aborted).toBe(true);
		expect(env.state.items).toEqual([]);
		expect(env.state.groups).toEqual([]);
		expect(env.state.draft.content).toBe('');
		expect(env.state.parameters).toEqual([]);
		expect(env.tracked.size).toBe(0);
		hold.resolve('迟到结果');
		await pending;
		expect(env.state.rendered).toBeUndefined();
		env.session.dispose();
	});
	it('身份已变化但监听尚未执行也拒绝迟到写回', async () => {
		const env = setup();
		await activate(env);
		env.session.openEdit(row);
		const hold = deferred<string>();
		env.api.render.mockReturnValueOnce(hold.promise);
		const pending = env.session.render();
		env.identity('777:2:2:alice');
		hold.resolve('旧租户结果');
		await pending;
		expect(env.state.rendered).toBeUndefined();
		env.session.contextChanged(false);
		expect(env.state.draft.content).toBe('');
	});
	it('分组和列表加载失败后能通过刷新恢复', async () => {
		const env = setup();
		env.api.page.mockRejectedValueOnce(new Error('暂不可用'));
		env.api.groups.mockRejectedValueOnce(new Error('暂不可用'));
		await activate(env);
		expect(env.state.pageError).toContain('加载失败');
		expect(env.state.groupsError).toContain('加载失败');
		await env.session.refresh();
		expect(env.state.items).toHaveLength(1);
		expect(env.state.pageError).toBe('');
		expect(env.state.groupsError).toBe('');
		env.session.dispose();
	});
});

describe('模板渲染实际 Axios 传输', () => {
	it('以 JSON 原键发送全部字符串参数且保持内容、取消信号与静默错误选项', async () => {
		const input = {
			content: '  <p>中文😀 @(name)</p>\r\n@{ var x = "原文"; }  ',
			data: templateParameterData([
				{ id: 1, key: 'name', value: '张三' },
				{ id: 2, key: '__proto__', value: '字符串' },
				{ id: 3, key: 'constructor', value: '原构造键' },
				{ id: 4, key: 'prototype', value: '原原型键' },
			]),
		};
		const controller = new AbortController();
		let body = '';
		let contentType = '';
		let signalRetained = false;
		let silentError = false;
		requestClient.instance.defaults.adapter = async (config) => {
			body = String(config.data);
			contentType = String(config.headers.get('Content-Type'));
			signalRetained = config.signal === controller.signal;
			silentError = config.silentError === true;
			return { config, data: '<p>渲染完成</p>', headers: {}, status: 200, statusText: 'OK' };
		};
		expect(await templateApi.render(input, controller.signal)).toBe('<p>渲染完成</p>');
		const payload = JSON.parse(body) as typeof input;
		expect(payload).toEqual(input);
		expect(Object.keys(payload.data)).toEqual(['name', '__proto__', 'constructor', 'prototype']);
		expect(Object.getPrototypeOf(input.data)).toBe(Object.prototype);
		expect(contentType).toBe('application/json;charset=utf-8');
		expect(signalRetained).toBe(true);
		expect(silentError).toBe(true);
	});
});
