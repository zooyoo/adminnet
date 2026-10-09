import { computed, onScopeDispose, ref, shallowRef } from 'vue';

import { sessionBoundary } from '#/api/session';
import { databaseColumns, databaseConnections, databaseTables, databaseTypes } from '#/api/system/database';

export function useDatabaseSelection(loaders = { connections: databaseConnections, tables: databaseTables, types: databaseTypes, columns: databaseColumns }) {
	const connections = shallowRef<Awaited<ReturnType<typeof databaseConnections>>>([]);
	const tables = shallowRef<Awaited<ReturnType<typeof databaseTables>>>([]);
	const types = shallowRef<string[]>([]);
	const columns = shallowRef<Awaited<ReturnType<typeof databaseColumns>>>([]);
	const configId = ref('');
	const tableName = ref('');
	const loading = ref(false);
	const error = ref('');
	const ready = ref(false);
	const connection = computed(() => connections.value.find((item) => item.configId === configId.value));
	const target = computed(() => ({ configId: configId.value, tableName: tableName.value }));
	let generation = 0;
	let controller: AbortController | undefined;
	const lifetime = new AbortController();
	sessionBoundary.track(lifetime);
	function cancel() {
		generation += 1;
		controller?.abort();
		loading.value = false;
	}
	async function run(work: (signal: AbortSignal) => Promise<() => void>) {
		cancel();
		const current = generation;
		const session = sessionBoundary.version;
		controller = new AbortController();
		const signal = controller.signal;
		loading.value = true;
		error.value = '';
		const valid = () => current === generation && session === sessionBoundary.version && !signal.aborted;
		try {
			const apply = await work(signal);
			if (valid()) {
				apply();
				return true;
			}
		} catch (cause) {
			if (valid()) error.value = cause instanceof Error ? cause.message : '结构查询失败';
		} finally {
			if (valid()) loading.value = false;
		}
		return false;
	}
	async function initialize() {
		await run(async (signal) => {
			const result = await loaders.connections(signal);
			return () => {
				connections.value = result;
			};
		});
	}
	async function selectConnection(value: string, selectedTable = '') {
		configId.value = value;
		tableName.value = '';
		tables.value = [];
		types.value = [];
		columns.value = [];
		ready.value = false;
		if (!value) {
			cancel();
			return;
		}
		const loaded = await run(async (signal) => {
			const [result, supported] = await Promise.all([loaders.tables(value, signal), loaders.types(value, signal)]);
			return () => {
				tables.value = result.filter((item) => item.name && !item.name.startsWith('zero_')).sort((a, b) => a.name!.localeCompare(b.name!));
				types.value = supported;
				ready.value = true;
			};
		});
		if (loaded && configId.value === value && ready.value && tables.value.some((item) => item.name === selectedTable)) await selectTable(selectedTable);
	}
	async function selectTable(value: string) {
		tableName.value = value ?? '';
		columns.value = [];
		if (!tableName.value) {
			cancel();
			return;
		}
		const snapshot = { ...target.value };
		await run(async (signal) => {
			const result = await loaders.columns(snapshot, signal);
			return () => {
				columns.value = result;
			};
		});
	}
	lifetime.signal.addEventListener('abort', () => {
		cancel();
		connections.value = [];
		tables.value = [];
		types.value = [];
		columns.value = [];
		configId.value = '';
		tableName.value = '';
		ready.value = false;
	});
	onScopeDispose(() => {
		cancel();
		lifetime.abort();
		sessionBoundary.release(lifetime);
	});
	return { connections, tables, types, columns, configId, tableName, loading, error, ready, connection, target, initialize, selectConnection, selectTable, cancel };
}
export type DatabaseSelection = ReturnType<typeof useDatabaseSelection>;
