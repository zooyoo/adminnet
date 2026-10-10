import type { RegionApi, RegionDraft, RegionId, RegionRow } from '#/api/system/region';

export interface RegionPermissions {
	page: boolean;
	add: boolean;
	update: boolean;
	delete: boolean;
}

export interface RegionBoundary {
	readonly version: number;
	track(controller: AbortController): void;
	release(controller: AbortController): void;
}

export interface RegionTreeNode {
	key: string;
	title: string;
	name: string;
	code: string;
	children?: RegionTreeNode[];
}

export const sameRegion = (left: RegionId | undefined, right: RegionId | undefined) => left !== undefined && right !== undefined && String(left) === String(right);

export function findRegionPath(rows: RegionRow[], id: RegionId): RegionRow[] {
	for (const row of rows) {
		if (sameRegion(row.id, id)) return [row];
		const childPath = findRegionPath(row.children ?? [], id);
		if (childPath.length) return [row, ...childPath];
	}
	return [];
}

export function regionTreeNodes(rows: RegionRow[], filter = ''): RegionTreeNode[] {
	const keyword = filter.trim().toLocaleLowerCase();
	return rows.flatMap((row) => {
		const matches = !keyword || row.name.toLocaleLowerCase().includes(keyword) || (row.code ?? '').toLocaleLowerCase().includes(keyword);
		const children = regionTreeNodes(row.children ?? [], matches ? '' : keyword);
		return matches || children.length ? [{ key: String(row.id), title: row.name, name: row.name, code: row.code ?? '', ...(children.length ? { children } : {}) }] : [];
	});
}

export function regionTreeKeys(nodes: RegionTreeNode[]): string[] {
	return nodes.flatMap((node) => [node.key, ...regionTreeKeys(node.children ?? [])]);
}

export function newRegionDraft(pid: RegionId = 0): RegionDraft {
	return { pid, name: '', code: '', cityCode: '', orderNo: 100, remark: '' };
}

export function createRegionState() {
	return {
		tree: [] as RegionRow[],
		treeBusy: false,
		treeError: '',
		treeFilter: '',
		expandedKeys: [] as string[],
		selectedId: undefined as RegionId | undefined,
		items: [] as RegionRow[],
		total: 0,
		page: 1,
		pageSize: 50,
		query: { name: '', code: '' },
		applied: { name: '', code: '' },
		pageBusy: false,
		pageError: '',
		editorOpen: false,
		editorKind: 'add' as 'add' | 'update',
		editorParent: '根节点',
		draft: newRegionDraft(),
		editorError: '',
		saveBusy: false,
		deleteTarget: undefined as RegionRow | undefined,
		deleteError: '',
		deleteBusy: false,
	};
}

export type RegionState = ReturnType<typeof createRegionState>;

type Operation = 'page' | 'tree' | 'write';
type Action = keyof RegionPermissions;

export function createRegionSession(
	state: RegionState,
	deps: {
		api: RegionApi;
		boundary: RegionBoundary;
		identity(): string;
		permissions(): RegionPermissions;
		notify?(text: string): void;
	}
) {
	const flights = new Map<Operation, AbortController>();
	let active = false;
	let disposed = false;
	let generation = 0;
	let context = '';
	let lifetime: AbortController | undefined;
	const contextKey = () => JSON.stringify([deps.identity(), deps.boundary.version, deps.permissions()]);
	const permitted = (action: Action) => deps.permissions().page && deps.permissions()[action];
	const ready = (action: Action = 'page') => active && !disposed && !!lifetime && !lifetime.signal.aborted && context === contextKey() && permitted(action);

	function cancel(operation: Operation) {
		const controller = flights.get(operation);
		if (!controller) return;
		flights.delete(operation);
		controller.abort();
		deps.boundary.release(controller);
	}

	function start(operation: Operation, action: Action = 'page') {
		if (!ready(action)) return;
		cancel(operation);
		const controller = new AbortController();
		const stamp = generation;
		flights.set(operation, controller);
		deps.boundary.track(controller);
		return {
			signal: controller.signal,
			current: () => ready(action) && stamp === generation && !controller.signal.aborted && flights.get(operation) === controller,
			finish: () => {
				if (flights.get(operation) === controller) {
					flights.delete(operation);
					deps.boundary.release(controller);
				}
			},
		};
	}

	function parentLabel(pid: RegionId) {
		if (sameRegion(pid, 0)) return '根节点';
		const path = findRegionPath(state.tree, pid);
		return path.length ? path.map((row) => row.name).join(' / ') : '上级区域（ID：' + String(pid) + '）';
	}

	function clearSelection() {
		state.selectedId = undefined;
		state.query = { name: '', code: '' };
		state.applied = { name: '', code: '' };
		state.page = 1;
	}

	async function loadPage() {
		const ticket = start('page');
		if (!ticket) return;
		state.pageBusy = true;
		state.pageError = '';
		const input = { pid: state.selectedId ?? 0, ...state.applied, page: state.page, pageSize: state.pageSize };
		try {
			const result = await deps.api.page(input, ticket.signal);
			if (!ticket.current()) return;
			state.items = result.items ?? [];
			state.total = result.total ?? 0;
		} catch {
			if (!ticket.current()) return;
			state.items = [];
			state.total = 0;
			state.pageError = '区域列表加载失败，请重试。';
		} finally {
			if (ticket.current()) state.pageBusy = false;
			ticket.finish();
		}
	}

	async function loadTree() {
		const ticket = start('tree');
		if (!ticket) return;
		state.treeBusy = true;
		state.treeError = '';
		try {
			const rows = await deps.api.tree(ticket.signal);
			if (!ticket.current()) return;
			state.tree = rows ?? [];
			const keys = new Set(regionTreeKeys(regionTreeNodes(state.tree)));
			state.expandedKeys = state.expandedKeys.filter((key) => keys.has(key));
			if (state.selectedId !== undefined && !findRegionPath(state.tree, state.selectedId).length) {
				clearSelection();
				void loadPage();
			}
		} catch {
			if (!ticket.current()) return;
			state.treeError = '区域树加载失败，请重试。';
		} finally {
			if (ticket.current()) state.treeBusy = false;
			ticket.finish();
		}
	}

	async function refresh() {
		await Promise.all([loadTree(), loadPage()]);
	}

	function activate() {
		if (active || disposed || !deps.permissions().page) return;
		active = true;
		generation++;
		context = contextKey();
		lifetime = new AbortController();
		lifetime.signal.addEventListener('abort', deactivate, { once: true });
		deps.boundary.track(lifetime);
		if (active) void refresh();
	}

	function deactivate() {
		active = false;
		generation++;
		for (const operation of flights.keys()) cancel(operation);
		if (lifetime) {
			const previous = lifetime;
			lifetime = undefined;
			previous.signal.removeEventListener('abort', deactivate);
			previous.abort();
			deps.boundary.release(previous);
		}
		Object.assign(state, createRegionState());
	}

	function contextChanged(visible: boolean) {
		deactivate();
		if (visible) activate();
	}

	function dispose() {
		disposed = true;
		deactivate();
	}

	function selectRegion(id: RegionId | undefined) {
		if (!ready() || state.saveBusy || state.deleteBusy) return;
		const row = id === undefined ? undefined : findRegionPath(state.tree, id).at(-1);
		clearSelection();
		state.selectedId = row?.id;
		void loadPage();
	}

	function reset() {
		if (!ready() || state.saveBusy || state.deleteBusy) return;
		clearSelection();
		state.treeFilter = '';
		void loadPage();
	}

	function query() {
		if (!ready()) return;
		state.applied = { name: state.query.name.trim(), code: state.query.code.trim() };
		state.page = 1;
		void loadPage();
	}

	function changePage(page: number, pageSize: number) {
		if (!ready()) return;
		state.page = pageSize === state.pageSize ? Math.max(1, page) : 1;
		state.pageSize = pageSize;
		void loadPage();
	}

	function openAdd() {
		if (!ready('add') || state.saveBusy || state.deleteBusy) return;
		state.editorKind = 'add';
		state.draft = newRegionDraft(state.selectedId ?? 0);
		state.editorParent = parentLabel(state.draft.pid);
		state.editorError = '';
		state.editorOpen = true;
	}

	function openEdit(row: RegionRow) {
		if (!ready('update') || state.saveBusy || state.deleteBusy) return;
		const original = state.items.find((item) => sameRegion(item.id, row.id)) ?? row;
		state.editorKind = 'update';
		state.draft = {
			...original,
			pid: original.pid ?? 0,
			name: original.name,
			code: original.code ?? '',
			cityCode: original.cityCode ?? '',
			orderNo: original.orderNo ?? 100,
			remark: original.remark ?? '',
		};
		state.editorParent = parentLabel(state.draft.pid);
		state.editorError = '';
		state.editorOpen = true;
	}

	function closeEditor() {
		if (state.saveBusy) return;
		state.editorOpen = false;
		state.editorError = '';
		state.draft = newRegionDraft();
	}

	async function save() {
		if (!state.editorOpen || state.saveBusy || state.deleteBusy || !ready(state.editorKind)) return;
		const payload = { ...state.draft, name: state.draft.name.trim(), code: state.draft.code.trim() };
		if (!payload.name) {
			state.editorError = '请输入行政名称。';
			return;
		}
		if (![6, 9, 12].includes(payload.code.length)) {
			state.editorError = '行政代码长度必须为 6、9 或 12 位。';
			return;
		}
		if (!Number.isInteger(payload.orderNo)) {
			state.editorError = '排序必须为整数。';
			return;
		}
		const kind = state.editorKind;
		const ticket = start('write', kind);
		if (!ticket) return;
		state.saveBusy = true;
		state.editorError = '';
		try {
			await deps.api[kind](payload, ticket.signal);
			if (!ticket.current()) return;
			state.saveBusy = false;
			closeEditor();
			deps.notify?.(kind === 'add' ? '添加行政区域成功' : '编辑行政区域成功');
			await refresh();
		} catch {
			if (ticket.current()) state.editorError = '保存失败，请检查后重试。草稿已保留。';
		} finally {
			if (ticket.current()) state.saveBusy = false;
			ticket.finish();
		}
	}

	function requestDelete(row: RegionRow) {
		if (!ready('delete') || state.saveBusy || state.deleteBusy) return;
		state.deleteTarget = { ...row };
		state.deleteError = '';
	}

	function cancelDelete() {
		if (state.deleteBusy) return;
		state.deleteTarget = undefined;
		state.deleteError = '';
	}

	async function confirmDelete() {
		if (!state.deleteTarget || state.deleteBusy || state.saveBusy) return;
		const ticket = start('write', 'delete');
		if (!ticket) return;
		const target = state.deleteTarget;
		state.deleteBusy = true;
		state.deleteError = '';
		try {
			await deps.api.delete(target.id, ticket.signal);
			if (!ticket.current()) return;
			if (state.selectedId !== undefined && findRegionPath(state.tree, state.selectedId).some((row) => sameRegion(row.id, target.id))) clearSelection();
			else if (state.items.length === 1 && state.page > 1) state.page--;
			state.deleteTarget = undefined;
			deps.notify?.('删除行政区域成功');
			await refresh();
		} catch {
			if (ticket.current()) state.deleteError = '删除失败，请重试。';
		} finally {
			if (ticket.current()) state.deleteBusy = false;
			ticket.finish();
		}
	}

	return {
		activate,
		deactivate,
		contextChanged,
		dispose,
		loadPage,
		loadTree,
		refresh,
		selectRegion,
		reset,
		query,
		changePage,
		openAdd,
		openEdit,
		closeEditor,
		save,
		requestDelete,
		cancelDelete,
		confirmDelete,
	};
}
