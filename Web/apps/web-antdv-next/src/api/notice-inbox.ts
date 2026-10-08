export interface InboxItem {
	id?: number | string;
}

interface InboxOptions<T extends InboxItem> {
	load: (signal: AbortSignal) => Promise<T[]>;
	read: (id: number | string) => Promise<unknown>;
	update: (items: T[]) => void;
	error: (message: string) => void;
	version: () => number;
	loading?: (loading: boolean) => void;
}

export class NoticeInbox<T extends InboxItem> {
	private controller?: AbortController;
	private items: T[] = [];
	private pendingReads = new Map<string, Promise<boolean>>();
	private revision = 0;

	constructor(private readonly options: InboxOptions<T>) {}

	async markAllRead() {
		return Promise.all(this.items.filter((item) => item.id !== undefined).map((item) => this.markRead(item.id!)));
	}

	markRead(id: number | string): Promise<boolean> {
		const key = String(id);
		const pending = this.pendingReads.get(key);
		if (pending) return pending;
		const version = this.options.version();
		const operation: Promise<boolean> = Promise.resolve().then(async () => {
			try {
				await this.options.read(id);
				if (version !== this.options.version() || this.pendingReads.get(key) !== operation) return false;
				// 读取开始早于已读操作的旧快照不能恢复这条未读通知。
				this.controller?.abort();
				this.revision++;
				this.items = this.items.filter((item) => String(item.id) !== key);
				this.options.update(this.items);
				await this.refresh();
				return true;
			} catch (error) {
				if (version === this.options.version() && this.pendingReads.get(key) === operation) {
					this.options.error(error instanceof Error ? error.message : '设置已读失败');
				}
				return false;
			} finally {
				if (this.pendingReads.get(key) === operation) this.pendingReads.delete(key);
			}
		});
		this.pendingReads.set(key, operation);
		return operation;
	}

	async refresh() {
		this.controller?.abort();
		const controller = new AbortController();
		this.controller = controller;
		const revision = ++this.revision;
		const version = this.options.version();
		this.options.loading?.(true);
		try {
			const items = await this.options.load(controller.signal);
			if (controller.signal.aborted || revision !== this.revision || version !== this.options.version()) return;
			const unique = new Map<string, T>();
			for (const item of items) if (item.id !== undefined && item.id !== null) unique.set(String(item.id), item);
			this.items = [...unique.values()];
			this.options.error('');
			this.options.update(this.items);
		} catch (error) {
			if (!controller.signal.aborted && revision === this.revision && version === this.options.version()) {
				this.options.error(error instanceof Error ? error.message : '未读通知加载失败');
			}
		} finally {
			if (revision === this.revision && version === this.options.version()) this.options.loading?.(false);
		}
	}

	reset() {
		this.controller?.abort();
		this.revision++;
		this.pendingReads.clear();
		this.items = [];
		this.options.update([]);
		this.options.error('');
		this.options.loading?.(false);
	}
}
