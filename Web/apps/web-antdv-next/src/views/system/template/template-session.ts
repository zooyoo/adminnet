import type { TemplateApi, TemplateDraft, TemplateId, TemplateQuery, TemplateRow, TemplateType } from '#/api/system/template';

export type TemplateContentType = 1 | 2;
export type TemplateEditorKind = 'add' | 'preview' | 'update';
export interface TemplatePermissions {
	page: boolean;
	add: boolean;
	update: boolean;
	delete: boolean;
	preview: boolean;
}
export interface TemplateBoundary {
	readonly version: number;
	track(controller: AbortController): void;
	release(controller: AbortController): void;
}
export interface TemplateParameter {
	id: number;
	key: string;
	value: string;
}

export const TEMPLATE_TYPES: { label: string; value: TemplateType }[] = [
	{ label: '通知', value: 1 },
	{ label: '短信', value: 2 },
	{ label: '邮件', value: 3 },
	{ label: '微信', value: 4 },
	{ label: '企业微信', value: 7 },
];

export function newTemplateDraft(tenantId?: TemplateId): TemplateDraft {
	return { name: '', code: '', groupName: '', type: 1, content: '', orderNo: 100, remark: '', ...(tenantId === undefined ? {} : { tenantId }) };
}

export function templateParameterKeys(content: string): string[] {
	return [...new Set([...content.matchAll(/@\((.*?)\)/g)].map((match) => match[1] ?? ''))];
}

export function mergeTemplateParameters(content: string, previous: TemplateParameter[]): TemplateParameter[] {
	const result = previous.map((parameter) => ({ ...parameter }));
	let sequence = Math.max(0, ...previous.map((parameter) => parameter.id));
	for (const key of templateParameterKeys(content)) {
		if (!result.some((parameter) => parameter.key === key)) result.push({ id: ++sequence, key, value: '参数' + String(result.length + 1) });
	}
	return result;
}

export function templateParameterData(parameters: TemplateParameter[]): Record<string, string> {
	return Object.fromEntries(parameters.map(({ key, value }) => [key, value]));
}

export function validateTemplateDraft(draft: TemplateDraft): string {
	if (!draft.name.trim()) return '请输入模板名称。';
	if (draft.name.length > 128) return '模板名称不能超过 128 个字符。';
	if (!draft.code.trim()) return '请输入模板编码。';
	if (draft.code.length > 128) return '模板编码不能超过 128 个字符。';
	if (draft.groupName.length > 32) return '模板分组不能超过 32 个字符。';
	if (draft.remark.length > 128) return '模板备注不能超过 128 个字符。';
	if (!TEMPLATE_TYPES.some(({ value }) => value === draft.type)) return '请选择有效的模板类型。';
	if (!Number.isInteger(draft.orderNo) || draft.orderNo < -2_147_483_648 || draft.orderNo > 2_147_483_647) return '模板排序必须为有效整数。';
	if (!draft.content.length) return '请输入模板内容。';
	return '';
}

export function validateTemplateParameters(parameters: TemplateParameter[]): string {
	if (parameters.some(({ key }) => !key.trim())) return '请填写预览参数名。';
	if (new Set(parameters.map(({ key }) => key)).size !== parameters.length) return '预览参数名不能重复。';
	return '';
}

function blankFilters(): Pick<TemplateQuery, 'code' | 'groupName' | 'name' | 'type'> {
	return { name: '', code: '', groupName: '', type: undefined };
}

export function createTemplateState() {
	return {
		items: [] as TemplateRow[],
		total: 0,
		page: 1,
		pageSize: 20,
		query: blankFilters(),
		applied: blankFilters(),
		pageBusy: false,
		pageError: '',
		groups: [] as string[],
		groupsBusy: false,
		groupsError: '',
		editorOpen: false,
		editorKind: 'add' as TemplateEditorKind,
		draft: newTemplateDraft(),
		contentType: 1 as TemplateContentType,
		parameters: [] as TemplateParameter[],
		editorError: '',
		saveBusy: false,
		renderBusy: false,
		renderError: '',
		rendered: undefined as string | undefined,
		renderedContentType: 1 as TemplateContentType,
		deleteTarget: undefined as TemplateRow | undefined,
		deleteBusy: false,
		deleteError: '',
	};
}

export type TemplateState = ReturnType<typeof createTemplateState>;
type Operation = 'groups' | 'page' | 'render' | 'write';
type Action = keyof TemplatePermissions;

export function createTemplateSession(
	state: TemplateState,
	deps: {
		api: TemplateApi;
		boundary: TemplateBoundary;
		identity(): string;
		permissions(): TemplatePermissions;
		tenantId?(): TemplateId | undefined;
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
	const ready = (action: Action = 'page') => active && !disposed && !!lifetime && !lifetime.signal.aborted && context === contextKey() && deps.permissions().page && deps.permissions()[action];

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

	async function loadPage() {
		const ticket = start('page');
		if (!ticket) return;
		state.pageBusy = true;
		state.pageError = '';
		const tenantId = deps.tenantId?.();
		const input = { ...state.applied, page: state.page, pageSize: state.pageSize, ...(tenantId === undefined ? {} : { tenantId }) };
		try {
			const result = await deps.api.page(input, ticket.signal);
			if (!ticket.current()) return;
			state.items = result.items ?? [];
			state.total = result.total ?? 0;
		} catch {
			if (!ticket.current()) return;
			state.items = [];
			state.total = 0;
			state.pageError = '模板列表加载失败，请重试。';
		} finally {
			if (ticket.current()) state.pageBusy = false;
			ticket.finish();
		}
	}

	async function loadGroups() {
		const ticket = start('groups');
		if (!ticket) return;
		state.groupsBusy = true;
		state.groupsError = '';
		try {
			const groups = await deps.api.groups(ticket.signal);
			if (ticket.current()) state.groups = groups ?? [];
		} catch {
			if (ticket.current()) state.groupsError = '模板分组加载失败，请重试。';
		} finally {
			if (ticket.current()) state.groupsBusy = false;
			ticket.finish();
		}
	}

	async function refresh() {
		await Promise.all([loadPage(), loadGroups()]);
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
		Object.assign(state, createTemplateState());
	}

	function contextChanged(visible: boolean) {
		deactivate();
		if (visible) activate();
	}

	function dispose() {
		disposed = true;
		deactivate();
	}

	function query() {
		if (!ready()) return;
		state.applied = { ...state.query };
		state.page = 1;
		void loadPage();
	}

	function reset() {
		if (!ready()) return;
		state.query = blankFilters();
		query();
	}

	function changePage(page: number, pageSize: number) {
		if (!ready()) return;
		state.page = pageSize === state.pageSize ? Math.max(1, page) : 1;
		state.pageSize = pageSize;
		void loadPage();
	}

	function showEditor(kind: TemplateEditorKind, row?: TemplateRow) {
		if (!ready(kind) || state.saveBusy || state.deleteBusy) return;
		cancel('render');
		state.editorKind = kind;
		state.draft = row
			? { ...row, name: row.name, code: row.code, groupName: row.groupName ?? '', type: row.type, content: row.content ?? '', orderNo: row.orderNo ?? 100, remark: row.remark ?? '' }
			: newTemplateDraft(deps.tenantId?.());
		state.contentType = 1;
		state.parameters = mergeTemplateParameters(state.draft.content, []);
		state.editorError = '';
		state.renderError = '';
		state.rendered = undefined;
		state.renderBusy = false;
		state.editorOpen = true;
	}

	function closeEditor() {
		if (state.saveBusy) return;
		cancel('render');
		state.editorOpen = false;
		state.draft = newTemplateDraft();
		state.parameters = [];
		state.editorError = '';
		state.renderError = '';
		state.rendered = undefined;
		state.renderBusy = false;
	}

	function contentChanged(content: string) {
		if (!state.editorOpen || state.editorKind === 'preview' || state.saveBusy || state.renderBusy) return;
		state.draft.content = content;
		state.parameters = mergeTemplateParameters(content, state.parameters);
		state.rendered = undefined;
	}

	function addParameter() {
		if (!state.editorOpen || state.renderBusy || state.saveBusy) return;
		const id = Math.max(0, ...state.parameters.map((parameter) => parameter.id)) + 1;
		state.parameters.push({ id, key: '', value: '' });
	}

	function removeParameter(id: number) {
		if (state.renderBusy || state.saveBusy) return;
		state.parameters = state.parameters.filter((parameter) => parameter.id !== id);
	}

	async function save() {
		if (!state.editorOpen || state.editorKind === 'preview' || state.saveBusy || state.renderBusy || state.deleteBusy || !ready(state.editorKind)) return;
		const payload = { ...state.draft };
		state.editorError = validateTemplateDraft(payload);
		if (state.editorError) return;
		const kind = state.editorKind;
		const ticket = start('write', kind);
		if (!ticket) return;
		state.saveBusy = true;
		try {
			await deps.api[kind](payload, ticket.signal);
			if (!ticket.current()) return;
			state.saveBusy = false;
			closeEditor();
			deps.notify?.(kind === 'add' ? '添加模板成功' : '编辑模板成功');
			await refresh();
		} catch {
			if (ticket.current()) state.editorError = '保存失败，请检查后重试。模板内容和预览参数已保留。';
		} finally {
			if (ticket.current()) state.saveBusy = false;
			ticket.finish();
		}
	}

	async function render() {
		if (!state.editorOpen || state.renderBusy || state.saveBusy) return;
		state.renderError = validateTemplateParameters(state.parameters);
		if (state.renderError) return;
		const ticket = start('render', 'preview');
		if (!ticket) return;
		const input = { content: state.draft.content, data: templateParameterData(state.parameters) };
		const contentType = state.contentType;
		state.renderBusy = true;
		state.renderError = '';
		try {
			const result = await deps.api.render(input, ticket.signal);
			if (ticket.current()) {
				state.rendered = result;
				state.renderedContentType = contentType;
			}
		} catch {
			if (ticket.current()) state.renderError = '渲染失败，请检查模板语法和参数后重试。原文和参数已保留。';
		} finally {
			if (ticket.current()) state.renderBusy = false;
			ticket.finish();
		}
	}

	function requestDelete(row: TemplateRow) {
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
		state.deleteBusy = true;
		state.deleteError = '';
		try {
			await deps.api.delete(state.deleteTarget.id, ticket.signal);
			if (!ticket.current()) return;
			state.deleteTarget = undefined;
			if (state.items.length === 1 && state.page > 1) state.page--;
			deps.notify?.('删除模板成功');
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
		loadGroups,
		refresh,
		query,
		reset,
		changePage,
		openAdd: () => showEditor('add'),
		openEdit: (row: TemplateRow) => showEditor('update', row),
		openPreview: (row: TemplateRow) => showEditor('preview', row),
		closeEditor,
		contentChanged,
		addParameter,
		removeParameter,
		save,
		render,
		requestDelete,
		cancelDelete,
		confirmDelete,
	};
}
