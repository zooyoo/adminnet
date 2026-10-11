import type { PluginApi, PluginDraft, PluginId, PluginRow } from '#/api/system/plugin';

import { createPluginDraft, pluginPayload, validatePluginDraft } from './plugin';

export interface PluginPermissions {
	page: boolean;
	add: boolean;
	update: boolean;
	delete: boolean;
}

export function createPluginState() {
	return {
		items: [] as PluginRow[],
		total: 0,
		page: 1,
		pageSize: 50,
		name: '',
		tenantId: undefined as PluginId | undefined,
		listBusy: false,
		listError: '',
		notice: '',
		editorOpen: false,
		saveBusy: false,
		editorError: '',
		draft: createPluginDraft(),
		errors: {} as Partial<Record<keyof PluginDraft, string>>,
		deleteRow: undefined as PluginRow | undefined,
		deleteBusy: false,
		deleteError: '',
	};
}

type PluginState = ReturnType<typeof createPluginState>;
interface Dependencies {
	api: PluginApi;
	boundary: { readonly version: number; track(controller: AbortController): void; release(controller: AbortController): void };
	identity(): string;
	permissions(): PluginPermissions;
}

export class PluginSession {
	private active = false;
	private generation = 0;
	private readonly pending = new Map<string, AbortController>();

	constructor(
		private readonly state: PluginState,
		private readonly deps: Dependencies
	) {}

	activate() {
		if (this.active) return;
		this.active = true;
		void this.loadPage();
	}

	cancelDelete() {
		if (!this.state.deleteBusy) this.state.deleteRow = undefined;
	}

	closeEditor() {
		if (this.state.saveBusy) return;
		this.state.editorOpen = false;
		this.state.draft = createPluginDraft();
		this.state.errors = {};
		this.state.editorError = '';
	}

	async confirmDelete() {
		const row = this.state.deleteRow;
		if (!this.active || !row || this.state.deleteBusy || !this.deps.permissions().delete) return;
		const request = this.begin('delete');
		this.state.deleteBusy = true;
		this.state.deleteError = '';
		try {
			await this.deps.api.delete(row.id, request.signal);
			if (!request.current()) return;
			this.state.deleteRow = undefined;
			this.state.notice = '插件删除成功';
			if (this.state.items.length === 1 && this.state.page > 1) this.state.page -= 1;
			await this.loadPage();
		} catch {
			if (request.current()) this.state.deleteError = '插件删除失败或结果未确认，请刷新列表核对后重试';
		} finally {
			if (request.current()) this.state.deleteBusy = false;
			request.release();
		}
	}

	contextChanged(visible: boolean) {
		this.cancelAll();
		this.clearPrivateState();
		this.state.tenantId = undefined;
		this.state.name = '';
		this.state.page = 1;
		this.active = visible;
		if (visible) void this.loadPage();
	}

	deactivate() {
		this.active = false;
		this.cancelAll();
		this.clearPrivateState();
	}

	dispose() {
		this.deactivate();
	}

	async loadPage() {
		if (!this.active || !this.deps.permissions().page) return;
		const request = this.begin('list');
		this.state.listBusy = true;
		this.state.listError = '';
		try {
			const result = await this.deps.api.page({ name: this.state.name, tenantId: this.state.tenantId, page: this.state.page, pageSize: this.state.pageSize }, request.signal);
			if (!request.current()) return;
			this.state.items = result.items;
			this.state.total = result.total;
		} catch {
			if (request.current()) this.state.listError = '插件列表加载失败，请重试';
		} finally {
			if (request.current()) this.state.listBusy = false;
			request.release();
		}
	}

	openEditor(row?: PluginRow) {
		if (!this.active || this.state.saveBusy || !(row ? this.deps.permissions().update : this.deps.permissions().add)) return;
		this.state.draft = createPluginDraft(row, this.state.tenantId);
		this.state.errors = {};
		this.state.editorError = '';
		this.state.notice = '';
		this.state.editorOpen = true;
	}

	requestDelete(row: PluginRow) {
		if (!this.active || !this.deps.permissions().delete || this.state.deleteBusy) return;
		this.state.deleteRow = row;
		this.state.deleteError = '';
		this.state.notice = '';
	}

	async save() {
		const updating = this.state.draft.id !== undefined;
		if (!this.active || !this.state.editorOpen || this.state.saveBusy || !(updating ? this.deps.permissions().update : this.deps.permissions().add)) return;
		this.state.errors = validatePluginDraft(this.state.draft);
		if (Object.keys(this.state.errors).length > 0) return;
		const payload = pluginPayload(this.state.draft);
		const request = this.begin('save');
		this.state.saveBusy = true;
		this.state.editorError = '';
		try {
			if (updating) await this.deps.api.update(payload, request.signal);
			else await this.deps.api.add(payload, request.signal);
			if (!request.current()) return;
			this.state.editorOpen = false;
			this.state.draft = createPluginDraft();
			this.state.notice = '插件保存成功';
			await this.loadPage();
		} catch (cause) {
			// 仅展示统一拦截器识别的业务诊断；网络错误仍提示核对保存结果。
			if (request.current()) {
				const diagnostic = cause instanceof Error && 'code' in cause && cause.code === 'ERR_ADMIN_RESULT' ? cause.message.trim().slice(0, 2000) : '';
				this.state.editorError = `${diagnostic ? `${diagnostic}\n` : ''}插件保存失败或结果未确认，请刷新列表核对后重试；草稿已保留`;
			}
		} finally {
			if (request.current()) this.state.saveBusy = false;
			request.release();
		}
	}

	search(reset = false) {
		if (reset) this.state.name = '';
		this.state.page = 1;
		void this.loadPage();
	}

	private begin(key: string) {
		const previous = this.pending.get(key);
		if (previous) {
			previous.abort();
			this.deps.boundary.release(previous);
		}
		const controller = new AbortController();
		this.pending.set(key, controller);
		this.deps.boundary.track(controller);
		const generation = this.generation;
		const version = this.deps.boundary.version;
		const identity = this.deps.identity();
		return {
			signal: controller.signal,
			current: () =>
				this.active &&
				!controller.signal.aborted &&
				generation === this.generation &&
				version === this.deps.boundary.version &&
				identity === this.deps.identity() &&
				this.pending.get(key) === controller,
			release: () => {
				this.deps.boundary.release(controller);
				if (this.pending.get(key) === controller) this.pending.delete(key);
			},
		};
	}

	private cancelAll() {
		this.generation += 1;
		for (const controller of this.pending.values()) {
			controller.abort();
			this.deps.boundary.release(controller);
		}
		this.pending.clear();
		this.state.listBusy = false;
		this.state.saveBusy = false;
		this.state.deleteBusy = false;
	}

	private clearPrivateState() {
		Object.assign(this.state, { items: [], total: 0, draft: createPluginDraft(), editorOpen: false, errors: {}, deleteRow: undefined, editorError: '', deleteError: '', listError: '', notice: '' });
	}
}
