import type { OpenAccessApi, OpenAccessDraft, OpenAccessId, OpenAccessMethod, OpenAccessRow, OpenAccessSignatureInput, OpenAccessTenant, OpenAccessUser } from '../../../api/system/open-access';

export interface OpenAccessPermissions {
	page: boolean;
	add: boolean;
	update: boolean;
	delete: boolean;
}

export interface OpenAccessBoundary {
	readonly version: number;
	track: (controller: AbortController) => void;
	release: (controller: AbortController) => void;
}

export interface SignatureDraft {
	accessKey: string;
	accessSecret: string;
	method: OpenAccessMethod;
	url: string;
	timestamp: string;
	nonce: string;
}

export type FieldErrors = Partial<Record<keyof OpenAccessDraft | keyof SignatureDraft, string>>;

export const OPEN_ACCESS_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT'] as const;

export function emptyDraft(): OpenAccessDraft {
	return { accessKey: '', accessSecret: '', bindTenantId: undefined, bindUserId: undefined };
}

export function emptySignature(): SignatureDraft {
	return { accessKey: '', accessSecret: '', method: 0, url: '', timestamp: '', nonce: '' };
}

export function validateDraft(draft: OpenAccessDraft): FieldErrors {
	const errors: FieldErrors = {};
	if (!draft.accessKey.trim()) errors.accessKey = '请输入身份标识';
	if (!draft.accessSecret.trim()) errors.accessSecret = '请输入密钥';
	if (draft.bindTenantId === undefined || draft.bindTenantId === '') errors.bindTenantId = '请选择绑定租户';
	if (draft.bindUserId === undefined || draft.bindUserId === '') errors.bindUserId = '请选择绑定用户';
	return errors;
}

export function validateSignature(draft: SignatureDraft): FieldErrors {
	const errors: FieldErrors = {};
	if (!draft.accessKey.trim()) errors.accessKey = '缺少身份标识';
	if (!draft.accessSecret.trim()) errors.accessSecret = '缺少密钥';
	if (!Number.isInteger(draft.method) || !OPEN_ACCESS_METHODS[draft.method]) errors.method = '请选择请求方式';
	if (!/^\/(?!\/)[^\s?#\\]*$/.test(draft.url)) errors.url = '请输入以 / 开头的接口路径，不包含域名、查询参数或片段';
	if (!/^\d{1,10}$/.test(draft.timestamp) || Number(draft.timestamp) <= 0) errors.timestamp = '请输入以秒为单位的正整数时间戳';
	if (!/^\d+$/.test(draft.nonce)) errors.nonce = '请输入数字随机数';
	return errors;
}

export function timestampSeconds(now = Date.now()): string {
	return String(Math.floor(now / 1000));
}

export function randomNonce(random: Pick<Crypto, 'getRandomValues'> = globalThis.crypto): string {
	// 拒绝超出完整区间的样本，使六位数字在 crypto 随机源下均匀分布。
	const range = 900_000;
	const limit = Math.floor(0x1_0000_0000 / range) * range;
	const values = new Uint32Array(1);
	do {
		random.getRandomValues(values);
	} while (values[0]! >= limit);
	return String(100_000 + (values[0]! % range));
}

export function createOpenAccessState() {
	return {
		filter: '',
		page: 1,
		pageSize: 50,
		items: [] as OpenAccessRow[],
		total: 0,
		listBusy: false,
		listError: '',
		notice: '',
		editorOpen: false,
		draft: emptyDraft(),
		draftErrors: {} as FieldErrors,
		editorError: '',
		tenants: [] as OpenAccessTenant[],
		users: [] as OpenAccessUser[],
		tenantsBusy: false,
		usersBusy: false,
		secretBusy: false,
		saveBusy: false,
		deleteId: undefined as OpenAccessId | undefined,
		deleteBusy: false,
		deleteError: '',
		signatureOpen: false,
		signature: emptySignature(),
		signatureErrors: {} as FieldErrors,
		signatureBusy: false,
		signatureError: '',
		sign: '',
		helpOpen: false,
	};
}

export type OpenAccessState = ReturnType<typeof createOpenAccessState>;
type Operation = 'delete' | 'page' | 'save' | 'secret' | 'signature' | 'tenants' | 'users';
interface Ticket {
	controller: AbortController;
	current: () => boolean;
}

export class OpenAccessSession {
	private active = false;
	private context = '';
	private disposed = false;
	private editorGeneration = 0;
	private generation = 0;
	private lifetime?: AbortController;
	private requests = new Map<Operation, AbortController>();
	private signatureGeneration = 0;
	private signatureTimer?: ReturnType<typeof setTimeout>;

	constructor(
		readonly state: OpenAccessState,
		private readonly dependencies: {
			api: OpenAccessApi;
			boundary: OpenAccessBoundary;
			identity: () => string;
			permissions: () => OpenAccessPermissions;
			debounceMs?: number;
		}
	) {}

	activate(): void {
		if (this.disposed || this.active || !this.permitted('page')) return;
		this.context = this.contextKey();
		this.active = true;
		const lifetime = new AbortController();
		this.lifetime = lifetime;
		lifetime.signal.addEventListener(
			'abort',
			() => {
				if (this.lifetime === lifetime) this.deactivate();
			},
			{ once: true }
		);
		this.dependencies.boundary.track(lifetime);
		void this.loadPage();
	}

	cancelDelete(): void {
		this.cancel('delete');
		this.state.deleteId = undefined;
		this.state.deleteBusy = false;
		this.state.deleteError = '';
	}

	chooseTenant(tenantId?: OpenAccessId): void {
		if (this.state.saveBusy || !this.state.editorOpen) return;
		this.cancel('users');
		this.updateDraft({ bindTenantId: tenantId, bindUserId: undefined });
		this.state.users = [];
		this.state.usersBusy = false;
		if (tenantId !== undefined) void this.loadUsers(tenantId);
	}

	closeEditor(): void {
		this.editorGeneration += 1;
		for (const operation of ['tenants', 'users', 'secret', 'save'] as const) this.cancel(operation);
		Object.assign(this.state, {
			editorOpen: false,
			draft: emptyDraft(),
			draftErrors: {},
			editorError: '',
			tenants: [],
			users: [],
			tenantsBusy: false,
			usersBusy: false,
			secretBusy: false,
			saveBusy: false,
		});
	}

	closeSignature(): void {
		this.signatureGeneration += 1;
		clearTimeout(this.signatureTimer);
		this.signatureTimer = undefined;
		this.cancel('signature');
		Object.assign(this.state, { signatureOpen: false, signature: emptySignature(), signatureErrors: {}, signatureBusy: false, signatureError: '', sign: '' });
	}

	async confirmDelete(): Promise<void> {
		const id = this.state.deleteId;
		if (id === undefined || this.state.deleteBusy) return;
		const ticket = this.start('delete', 'delete');
		if (!ticket) return;
		this.state.deleteBusy = true;
		this.state.deleteError = '';
		try {
			await this.dependencies.api.delete({ id }, ticket.controller.signal);
			if (ticket.current() && id === this.state.deleteId) {
				this.cancelDelete();
				this.state.notice = '删除成功';
				if (this.state.items.length === 1 && this.state.page > 1) this.state.page -= 1;
				await this.loadPage();
			}
		} catch {
			if (ticket.current()) this.state.deleteError = '删除失败，请重试';
		} finally {
			if (ticket.current()) this.state.deleteBusy = false;
			this.finish('delete', ticket);
		}
	}

	contextChanged(visible: boolean): void {
		this.deactivate();
		if (visible) this.activate();
	}

	deactivate(): void {
		this.active = false;
		this.generation += 1;
		this.editorGeneration += 1;
		this.signatureGeneration += 1;
		clearTimeout(this.signatureTimer);
		this.signatureTimer = undefined;
		for (const controller of this.requests.values()) controller.abort();
		this.requests.clear();
		const lifetime = this.lifetime;
		this.lifetime = undefined;
		if (lifetime) {
			this.dependencies.boundary.release(lifetime);
			lifetime.abort();
		}
		Object.assign(this.state, createOpenAccessState());
	}

	dispose(): void {
		this.disposed = true;
		this.deactivate();
	}

	async generateSecret(): Promise<void> {
		if (!this.state.editorOpen || this.state.secretBusy || this.state.saveBusy) return;
		const ticket = this.start('secret', 'edit');
		if (!ticket) return;
		const editorGeneration = this.editorGeneration;
		this.state.secretBusy = true;
		this.state.editorError = '';
		try {
			const secret = await this.dependencies.api.secret(ticket.controller.signal);
			if (ticket.current() && editorGeneration === this.editorGeneration && this.state.editorOpen) {
				this.state.draft.accessSecret = secret;
				this.state.draftErrors.accessSecret = undefined;
			}
		} catch {
			if (ticket.current()) this.state.editorError = '密钥生成失败，请重试';
		} finally {
			if (ticket.current()) this.state.secretBusy = false;
			this.finish('secret', ticket);
		}
	}

	async generateSignature(): Promise<void> {
		if (!this.state.signatureOpen) return;
		this.state.signatureErrors = validateSignature(this.state.signature);
		if (Object.keys(this.state.signatureErrors).length) return;
		const ticket = this.start('signature', 'page');
		if (!ticket) return;
		clearTimeout(this.signatureTimer);
		this.signatureTimer = undefined;
		this.state.signatureError = '';
		this.state.sign = '';
		const signatureGeneration = this.signatureGeneration;
		const input: OpenAccessSignatureInput = { ...this.state.signature, timestamp: Number(this.state.signature.timestamp) };
		this.state.signatureBusy = true;
		try {
			const sign = await this.dependencies.api.generateSignature(input, ticket.controller.signal);
			if (ticket.current() && signatureGeneration === this.signatureGeneration && this.state.signatureOpen) this.state.sign = sign;
		} catch {
			if (ticket.current()) this.state.signatureError = '签名生成失败，已保留填写内容，请修改参数或重试';
		} finally {
			if (ticket.current()) this.state.signatureBusy = false;
			this.finish('signature', ticket);
		}
	}

	async loadPage(): Promise<void> {
		const ticket = this.start('page', 'page');
		if (!ticket) return;
		this.state.listBusy = true;
		this.state.listError = '';
		try {
			const result = await this.dependencies.api.page({ page: this.state.page, pageSize: this.state.pageSize, accessKey: this.state.filter || undefined }, ticket.controller.signal);
			if (ticket.current()) {
				this.state.items = result.items;
				this.state.total = result.total;
			}
		} catch {
			if (ticket.current()) this.state.listError = '开放接口身份加载失败，请重试';
		} finally {
			if (ticket.current()) this.state.listBusy = false;
			this.finish('page', ticket);
		}
	}

	async loadTenants(): Promise<void> {
		const ticket = this.start('tenants', 'edit');
		if (!ticket || !this.state.editorOpen) return;
		this.state.tenantsBusy = true;
		try {
			const tenants = await this.dependencies.api.tenantList(ticket.controller.signal);
			if (ticket.current() && this.state.editorOpen) this.state.tenants = tenants;
		} catch {
			if (ticket.current()) this.state.editorError = '绑定租户加载失败，请重新打开后重试';
		} finally {
			if (ticket.current()) this.state.tenantsBusy = false;
			this.finish('tenants', ticket);
		}
	}

	async loadUsers(tenantId: OpenAccessId): Promise<void> {
		const ticket = this.start('users', 'edit');
		if (!ticket || !this.state.editorOpen) return;
		this.state.usersBusy = true;
		try {
			const users = await this.dependencies.api.userList({ tenantId }, ticket.controller.signal);
			if (ticket.current() && this.state.editorOpen && String(this.state.draft.bindTenantId) === String(tenantId)) {
				this.state.users = users.filter((user) => String(user.tenantId) === String(tenantId));
				if (!this.state.users.some((user) => String(user.id) === String(this.state.draft.bindUserId))) this.state.draft.bindUserId = undefined;
			}
		} catch {
			if (ticket.current()) this.state.editorError = '绑定用户加载失败，请重新选择租户后重试';
		} finally {
			if (ticket.current()) this.state.usersBusy = false;
			this.finish('users', ticket);
		}
	}

	openEditor(row?: OpenAccessRow): void {
		if (!this.ready(row ? 'update' : 'add') || row?.status === 1) return;
		this.closeEditor();
		this.state.notice = '';
		this.state.draft = row ? { ...row } : emptyDraft();
		this.state.editorOpen = true;
		void this.loadTenants();
		if (this.state.draft.bindTenantId !== undefined) void this.loadUsers(this.state.draft.bindTenantId);
	}

	openSignature(row: OpenAccessRow): void {
		if (!this.ready('page')) return;
		this.closeSignature();
		this.state.signature = { ...emptySignature(), accessKey: row.accessKey, accessSecret: row.accessSecret };
		this.state.signatureOpen = true;
	}

	requestDelete(row: OpenAccessRow): void {
		if (!this.ready('delete') || row.status === 1 || this.state.deleteBusy) return;
		this.state.deleteId = row.id;
		this.state.deleteError = '';
	}

	async save(): Promise<void> {
		const action = this.state.draft.id === undefined ? 'add' : 'update';
		if (!this.state.editorOpen || this.state.saveBusy || this.state.secretBusy || this.state.tenantsBusy || this.state.usersBusy || !this.ready(action)) return;
		const errors = validateDraft(this.state.draft);
		if (this.state.draft.bindTenantId !== undefined && !this.state.tenants.some((tenant) => String(tenant.id) === String(this.state.draft.bindTenantId))) errors.bindTenantId = '请选择有效的绑定租户';
		if (this.state.draft.bindUserId !== undefined && !this.state.users.some((user) => String(user.id) === String(this.state.draft.bindUserId))) errors.bindUserId = '请选择当前租户的绑定用户';
		this.state.draftErrors = errors;
		if (Object.keys(errors).length) return;
		const ticket = this.start('save', action);
		if (!ticket) return;
		this.state.saveBusy = true;
		this.state.editorError = '';
		try {
			await this.dependencies.api[action]({ ...this.state.draft }, ticket.controller.signal);
			if (ticket.current() && this.state.editorOpen) {
				this.closeEditor();
				this.state.notice = '保存成功';
				await this.loadPage();
			}
		} catch {
			if (ticket.current()) this.state.editorError = '保存失败，已保留填写内容，请重试';
		} finally {
			if (ticket.current()) this.state.saveBusy = false;
			this.finish('save', ticket);
		}
	}

	search(reset = false): void {
		if (reset) {
			this.state.filter = '';
			this.state.pageSize = 50;
		}
		this.state.page = 1;
		void this.loadPage();
	}

	updateDraft(patch: Partial<OpenAccessDraft>): void {
		if (!this.state.editorOpen || this.state.saveBusy) return;
		this.editorGeneration += 1;
		this.cancel('secret');
		this.state.secretBusy = false;
		Object.assign(this.state.draft, patch);
		this.state.draftErrors = {};
		this.state.editorError = '';
	}

	updateSignature(patch: Partial<Pick<SignatureDraft, 'method' | 'nonce' | 'timestamp' | 'url'>>): void {
		if (!this.ready('page') || !this.state.signatureOpen) return;
		clearTimeout(this.signatureTimer);
		this.cancel('signature');
		this.signatureGeneration += 1;
		Object.assign(this.state.signature, patch);
		this.state.sign = '';
		this.state.signatureBusy = false;
		this.state.signatureError = '';
		this.state.signatureErrors = validateSignature(this.state.signature);
		if (Object.keys(this.state.signatureErrors).length) return;
		this.signatureTimer = setTimeout(() => {
			this.signatureTimer = undefined;
			void this.generateSignature();
		}, this.dependencies.debounceMs ?? 180);
	}

	private cancel(operation: Operation): void {
		this.requests.get(operation)?.abort();
		this.requests.delete(operation);
	}

	private contextKey(): string {
		const { page, add, update, delete: remove } = this.dependencies.permissions();
		return JSON.stringify([this.dependencies.identity(), this.dependencies.boundary.version, page, add, update, remove]);
	}

	private finish(operation: Operation, ticket: Ticket): void {
		if (this.requests.get(operation) === ticket.controller) this.requests.delete(operation);
	}

	private permitted(action: 'edit' | keyof OpenAccessPermissions): boolean {
		const permissions = this.dependencies.permissions();
		return permissions.page && (action === 'edit' ? permissions.add || permissions.update : permissions[action]);
	}

	private ready(action: 'edit' | keyof OpenAccessPermissions): boolean {
		return this.active && !this.disposed && !this.lifetime?.signal.aborted && this.contextKey() === this.context && this.permitted(action);
	}

	private start(operation: Operation, action: 'edit' | keyof OpenAccessPermissions): Ticket | undefined {
		if (!this.ready(action)) return;
		this.cancel(operation);
		const generation = this.generation;
		const controller = new AbortController();
		this.requests.set(operation, controller);
		return {
			controller,
			current: () => this.ready(action) && generation === this.generation && !controller.signal.aborted && this.requests.get(operation) === controller,
		};
	}
}
