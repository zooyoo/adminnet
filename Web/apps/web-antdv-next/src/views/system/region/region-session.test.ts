import type { RegionApi, RegionRow } from '#/api/system/region';

import { describe, expect, it, vi } from 'vitest';

import { createRegionSession, createRegionState, findRegionPath, regionTreeKeys, regionTreeNodes } from './region-session';

const child: RegionRow = {
	id: '9007199254740993',
	pid: '10',
	name: '成都市',
	code: '510100',
	cityCode: '028',
	orderNo: 2,
	remark: '原备注',
	shortName: '成都',
	mergerName: '中国,四川省,成都市',
	zipCode: '610000',
	level: 2,
	pinYin: 'Chengdu',
	lng: 104.06,
	lat: 30.67,
	extraField: '保留字段',
};
const root: RegionRow = { id: '10', pid: 0, name: '四川省', code: '510000', orderNo: 1, children: [child] };
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
function harness(allow: Partial<{ page: boolean; add: boolean; update: boolean; delete: boolean }> = {}) {
	const state = createRegionState();
	const permissions = { page: true, add: true, update: true, delete: true, ...allow };
	const tracked = new Set<AbortController>();
	const identity = { value: 'ordinary-777:tenant-1' };
	const boundary = {
		version: 1,
		track: (controller: AbortController) => {
			tracked.add(controller);
		},
		release: (controller: AbortController) => {
			tracked.delete(controller);
		},
	};
	const api = {
		tree: vi.fn<RegionApi['tree']>().mockResolvedValue([root]),
		page: vi.fn<RegionApi['page']>().mockResolvedValue({ items: [root, child], total: 2 }),
		add: vi.fn<RegionApi['add']>().mockResolvedValue('20'),
		update: vi.fn<RegionApi['update']>().mockResolvedValue(),
		delete: vi.fn<RegionApi['delete']>().mockResolvedValue(),
	};
	const notify = vi.fn();
	const session = createRegionSession(state, { api, boundary, identity: () => identity.value, permissions: () => permissions, notify });
	return { state, permissions, tracked, identity, boundary, api, notify, session };
}
async function open(h: ReturnType<typeof harness>) {
	h.session.activate();
	await vi.waitFor(() => expect(h.state.treeBusy || h.state.pageBusy).toBe(false));
}

describe('区域管理会话', () => {
	it('无 page 权限时 tree、page 和写操作均不请求，不依赖账号类型', async () => {
		const h = harness({ page: false });
		h.session.activate();
		h.session.openAdd();
		h.session.openEdit(child);
		h.session.requestDelete(root);
		await h.session.refresh();
		await h.session.save();
		await h.session.confirmDelete();
		expect(h.api.tree).not.toHaveBeenCalled();
		expect(h.api.page).not.toHaveBeenCalled();
		expect(h.api.add).not.toHaveBeenCalled();
		expect(h.tracked.size).toBe(0);
	});
	it('只读权限独立阻止写操作', async () => {
		const h = harness({ add: false, update: false, delete: false });
		await open(h);
		h.session.openAdd();
		h.session.openEdit(child);
		h.session.requestDelete(root);
		expect(h.state.editorOpen).toBe(false);
		expect(h.state.deleteTarget).toBeUndefined();
		expect(h.api.page).toHaveBeenCalledWith({ pid: 0, name: '', code: '', page: 1, pageSize: 50 }, expect.any(AbortSignal));
		h.session.dispose();
		expect(h.tracked.size).toBe(0);
	});
	it('选择保留 string ID，切树清查询并回第 1 页，重置回根节点', async () => {
		const h = harness();
		await open(h);
		h.state.page = 3;
		h.state.query = { name: '旧名称', code: '旧代码' };
		h.state.applied = { ...h.state.query };
		h.session.selectRegion(child.id);
		expect(h.api.page).toHaveBeenLastCalledWith({ pid: child.id, name: '', code: '', page: 1, pageSize: 50 }, expect.any(AbortSignal));
		h.state.query = { name: ' 成都 ', code: ' 510 ' };
		h.session.query();
		expect(h.api.page).toHaveBeenLastCalledWith({ pid: child.id, name: '成都', code: '510', page: 1, pageSize: 50 }, expect.any(AbortSignal));
		h.session.changePage(2, 50);
		expect(h.state.page).toBe(2);
		h.session.changePage(2, 100);
		expect(h.state.page).toBe(1);
		expect(h.state.pageSize).toBe(100);
		h.session.reset();
		expect(h.state.selectedId).toBeUndefined();
		expect(h.state.query).toEqual({ name: '', code: '' });
		expect(h.api.page).toHaveBeenLastCalledWith({ pid: 0, name: '', code: '', page: 1, pageSize: 100 }, expect.any(AbortSignal));
		h.session.dispose();
	});
	it('树和分页各自取消前一请求，迟到响应不覆盖最新列表', async () => {
		const h = harness();
		const oldPage = deferred<{ items: RegionRow[]; total: number }>();
		const oldTree = deferred<RegionRow[]>();
		h.api.page.mockImplementationOnce(() => oldPage.promise);
		h.api.tree.mockImplementationOnce(() => oldTree.promise);
		h.session.activate();
		const pageSignal = h.api.page.mock.calls[0]![1];
		const treeSignal = h.api.tree.mock.calls[0]![0];
		await h.session.loadPage();
		expect(pageSignal.aborted).toBe(true);
		expect(treeSignal.aborted).toBe(false);
		await h.session.loadTree();
		expect(treeSignal.aborted).toBe(true);
		oldPage.resolve({ items: [], total: 99 });
		oldTree.resolve([]);
		await Promise.all([oldPage.promise, oldTree.promise]);
		await Promise.resolve();
		expect(h.state.total).toBe(2);
		expect(h.state.tree[0]?.name).toBe('四川省');
		expect(h.tracked.size).toBe(1);
		h.session.dispose();
	});
	it('新增用当前节点作 pid，默认排序 100，取消不请求', async () => {
		const h = harness();
		await open(h);
		h.session.selectRegion(child.id);
		h.session.openAdd();
		expect(h.state.draft).toMatchObject({ pid: child.id, orderNo: 100 });
		expect(h.state.editorParent).toBe('四川省 / 成都市');
		h.session.closeEditor();
		expect(h.api.add).not.toHaveBeenCalled();
		h.session.dispose();
	});
	it('编辑保留原 pid、全部未编辑字段，保存后刷新树和分页', async () => {
		const h = harness();
		await open(h);
		h.session.openEdit({ ...child, children: undefined });
		h.state.draft.remark = '编辑备注';
		await h.session.save();
		expect(h.api.update).toHaveBeenCalledWith({ ...child, children: undefined, remark: '编辑备注' }, expect.any(AbortSignal));
		expect(h.api.tree).toHaveBeenCalledTimes(2);
		expect(h.api.page).toHaveBeenCalledTimes(2);
		expect(h.state.editorOpen).toBe(false);
		expect(h.notify).toHaveBeenCalledWith('编辑行政区域成功');
		h.session.dispose();
	});
	it.each(['ABCDEF', 'ABCDEF123', 'ABCDEF123456'])('按旧合同接受长度 %s 并 trim，不新增数字限制', async (code) => {
		const h = harness();
		await open(h);
		h.session.openAdd();
		Object.assign(h.state.draft, { name: '不同名称', code: ' ' + code + ' ' });
		await h.session.save();
		expect(h.api.add).toHaveBeenCalledWith(expect.objectContaining({ code, pid: 0, orderNo: 100 }), expect.any(AbortSignal));
		h.session.dispose();
	});
	it('空名称、非法长度和非整数排序均保留草稿且不发送请求', async () => {
		const h = harness();
		await open(h);
		h.session.openAdd();
		await h.session.save();
		expect(h.state.editorError).toContain('行政名称');
		Object.assign(h.state.draft, { name: '保留名称', code: '123' });
		await h.session.save();
		expect(h.state.editorError).toContain('6、9 或 12');
		Object.assign(h.state.draft, { code: '123456', orderNo: 1.2 });
		await h.session.save();
		expect(h.state.editorError).toContain('整数');
		expect(h.api.add).not.toHaveBeenCalled();
		expect(h.state.editorOpen).toBe(true);
		expect(h.state.draft.name).toBe('保留名称');
		h.session.dispose();
	});
	it('失败后仍可编辑重试，忙时只发送一次保存', async () => {
		const h = harness();
		await open(h);
		const held = deferred<string>();
		h.api.add.mockImplementationOnce(() => held.promise);
		h.session.openAdd();
		Object.assign(h.state.draft, { name: '草稿', code: '123456' });
		const saving = h.session.save();
		await h.session.save();
		h.session.closeEditor();
		expect(h.api.add).toHaveBeenCalledTimes(1);
		expect(h.state.editorOpen).toBe(true);
		held.reject(new Error('service failed'));
		await saving;
		expect(h.state.editorError).toContain('草稿已保留');
		expect(h.state.saveBusy).toBe(false);
		h.state.draft.name = '重试名称';
		await h.session.save();
		expect(h.api.add).toHaveBeenCalledTimes(2);
		h.session.dispose();
	});
	it('删除取消不请求，级联删除祖先后清除选中子孙并刷新', async () => {
		const h = harness();
		await open(h);
		h.session.selectRegion(child.id);
		h.session.requestDelete(root);
		h.session.cancelDelete();
		expect(h.api.delete).not.toHaveBeenCalled();
		h.session.requestDelete(root);
		await h.session.confirmDelete();
		expect(h.api.delete).toHaveBeenCalledWith(root.id, expect.any(AbortSignal));
		expect(h.state.selectedId).toBeUndefined();
		expect(h.api.page).toHaveBeenLastCalledWith(expect.objectContaining({ pid: 0, page: 1 }), expect.any(AbortSignal));
		expect(h.api.tree).toHaveBeenCalledTimes(2);
		h.session.dispose();
	});
	it('删除失败保留确认目标，忙时不重复删除', async () => {
		const h = harness();
		await open(h);
		const held = deferred<void>();
		h.api.delete.mockImplementationOnce(() => held.promise);
		h.session.requestDelete(root);
		const deleting = h.session.confirmDelete();
		await h.session.confirmDelete();
		h.session.cancelDelete();
		expect(h.api.delete).toHaveBeenCalledTimes(1);
		expect(h.state.deleteTarget?.id).toBe(root.id);
		held.reject(new Error('delete failed'));
		await deleting;
		expect(h.state.deleteBusy).toBe(false);
		expect(h.state.deleteError).toContain('失败');
		expect(h.state.deleteTarget?.id).toBe(root.id);
		h.session.dispose();
	});
	it('分别显示树和分页错误，并能重试和恢复空态', async () => {
		const h = harness();
		h.api.tree.mockRejectedValueOnce(new Error('tree'));
		h.api.page.mockRejectedValueOnce(new Error('page'));
		await open(h);
		expect(h.state.treeError).toContain('加载失败');
		expect(h.state.pageError).toContain('加载失败');
		expect(h.state.items).toEqual([]);
		h.api.tree.mockResolvedValueOnce([]);
		h.api.page.mockResolvedValueOnce({ items: [], total: 0 });
		await h.session.refresh();
		expect(h.state.treeError).toBe('');
		expect(h.state.pageError).toBe('');
		expect(h.state.total).toBe(0);
		h.session.dispose();
	});
	it('刷新后选中节点消失，退回根节点并重载列表', async () => {
		const h = harness();
		await open(h);
		h.session.selectRegion(child.id);
		h.api.tree.mockResolvedValueOnce([]);
		await h.session.loadTree();
		expect(h.state.selectedId).toBeUndefined();
		expect(h.api.page).toHaveBeenLastCalledWith(expect.objectContaining({ pid: 0, page: 1 }), expect.any(AbortSignal));
		h.session.dispose();
	});
	it.each(['deactivate', 'dispose', 'identity', 'permission', 'boundary'])('%s 边界中断全部请求，迟到写响应不通知或刷新', async (reason) => {
		const h = harness();
		await open(h);
		const held = deferred<string>();
		h.api.add.mockImplementationOnce(() => held.promise);
		h.session.openAdd();
		Object.assign(h.state.draft, { name: '迟到草稿', code: '123456' });
		const saving = h.session.save();
		const signal = h.api.add.mock.calls[0]![1];
		const pages = h.api.page.mock.calls.length;
		if (reason === 'identity') {
			h.identity.value = 'other';
			h.session.contextChanged(false);
		} else if (reason === 'permission') {
			h.permissions.page = false;
			h.session.contextChanged(true);
		} else if (reason === 'boundary') {
			h.boundary.version++;
			for (const controller of [...h.tracked]) controller.abort();
		} else h.session[reason === 'dispose' ? 'dispose' : 'deactivate']();
		expect(signal.aborted).toBe(true);
		expect(h.tracked.size).toBe(0);
		expect(h.state.editorOpen).toBe(false);
		expect(h.state.items).toEqual([]);
		held.resolve('99');
		await saving;
		expect(h.notify).not.toHaveBeenCalled();
		expect(h.api.page).toHaveBeenCalledTimes(pages);
		h.session.dispose();
	});
	it('KeepAlive 恢复只重载一次，卸载后不能再激活', async () => {
		const h = harness();
		await open(h);
		h.session.activate();
		expect(h.api.page).toHaveBeenCalledTimes(1);
		h.session.deactivate();
		await open(h);
		expect(h.api.page).toHaveBeenCalledTimes(2);
		h.session.dispose();
		h.session.activate();
		expect(h.api.page).toHaveBeenCalledTimes(2);
		expect(h.tracked.size).toBe(0);
	});
});

describe('区域树导航', () => {
	it('筛选名称或代码保留祖先，string ID 不经过数值转换', () => {
		const nodes = regionTreeNodes([root], '510100');
		expect(regionTreeKeys(nodes)).toEqual(['10', child.id]);
		expect(nodes[0]?.children?.[0]?.name).toBe('成都市');
		expect(findRegionPath([root], child.id).map((row) => row.name)).toEqual(['四川省', '成都市']);
		expect(regionTreeNodes([root], '不存在')).toEqual([]);
	});
});
